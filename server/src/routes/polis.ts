// Polis, membri, inviti, Symposia, link per gli ospiti e rotazione delle chiavi. Il server controlla
// appartenenza e ruoli; nomi, profili e chiavi arrivano gia' cifrati dal client e si conservano cosi'.
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  can,
  isMemberRole,
  isGuestMode,
  isUuid,
  isB64url,
  isSealedBox,
  type MemberRole,
  type GuestMode,
  type SealedBox,
  type CreatePolisRequest,
  type CreateInviteRequest,
  type AcceptInviteRequest,
  type CreateSymposionRequest,
  type CreateGuestLinkRequest,
  type RotateRequest,
  type PolisDetail,
  type PolisSummary,
} from '@athenai/protocol';
import type { Sql } from '../db.ts';
import type { Auth } from '../auth.ts';
import type { Hub } from '../live.ts';

const bad = (reply: FastifyReply, error = 'bad-request', code = 400) => reply.code(code).send({ error });
const isSealedKey = (x: unknown) => isB64url(x, 256);
const hoursIn = (h: unknown, max: number) => Math.min(Math.max(Math.floor(Number(h) || 0), 1), max);

export async function roleIn(sql: Sql, polisId: string, accountId: string): Promise<MemberRole | null> {
  const [r] = await sql<{ role: MemberRole }[]>`select role from polis_members where polis_id = ${polisId} and account_id = ${accountId}`;
  return r?.role ?? null;
}

export function polisRoutes(app: FastifyInstance, sql: Sql, auth: Auth, hub: Hub) {
  const pre = { preHandler: auth.require };
  const archonOf = async (polisId: string, accountId: string) => can.govern((await roleIn(sql, polisId, accountId)) ?? 'xenos');
  /** gli ospiti senza piu' un link valido: connessioni chiuse */
  const kickGuests = async (polisId: string) => {
    const rows = await sql<{ id: string }[]>`
      select g.id from guest_sessions g join symposia s on s.id = g.symposion_id
      where s.polis_id = ${polisId} and (g.link_id is null or not exists (select 1 from guest_links l where l.id = g.link_id and l.expires_at > now()))`;
    for (const r of rows) hub.kick(r.id);
  };

  // ---------------------------------------------------------------- Polis

  app.post('/v1/polis', pre, async (req, reply) => {
    const b = req.body as CreatePolisRequest;
    if (!isUuid(b?.id) || !isSealedBox(b.meta) || b.meta.e !== 1 || !isSealedKey(b.sealed) || !isSealedBox(b.profile)) return bad(reply);
    try {
      await sql.begin(async (tx) => {
        await tx`insert into polis (id, meta) values (${b.id}, ${tx.json(b.meta as never)})`;
        await tx`insert into polis_members (polis_id, account_id, role, profile) values (${b.id}, ${req.accountId}, 'archon', ${tx.json(b.profile as never)})`;
        await tx`insert into polis_keys (polis_id, epoch, account_id, sealed) values (${b.id}, 1, ${req.accountId}, ${b.sealed})`;
      });
    } catch {
      return bad(reply, 'conflict', 409);
    }
    return { id: b.id };
  });

  app.get('/v1/polis', pre, async (req): Promise<PolisSummary[]> => {
    const rows = await sql<{ id: string; role: MemberRole; meta: SealedBox; epoch: number; rotation_needed: boolean }[]>`
      select p.id, m.role, p.meta, p.epoch, p.rotation_needed
      from polis p join polis_members m on m.polis_id = p.id
      where m.account_id = ${req.accountId} order by p.created_at`;
    return rows.map((r) => ({ id: r.id, role: r.role, meta: r.meta, epoch: r.epoch, rotationNeeded: r.rotation_needed }));
  });

  app.get('/v1/polis/:id', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    const role = await roleIn(sql, id, req.accountId);
    if (!role) return bad(reply, 'not-found', 404);
    const [p] = await sql<{ meta: SealedBox; epoch: number; rotation_needed: boolean }[]>`select meta, epoch, rotation_needed from polis where id = ${id}`;
    const members = await sql<{ account_id: string; sign_pk: string; box_pk: string; role: MemberRole; profile: SealedBox | null; joined_at: Date }[]>`
      select m.account_id, a.sign_pk, a.box_pk, m.role, m.profile, m.joined_at
      from polis_members m join accounts a on a.id = m.account_id where m.polis_id = ${id} order by m.joined_at`;
    const myKeys = await sql<{ epoch: number; sealed: string }[]>`select epoch, sealed from polis_keys where polis_id = ${id} and account_id = ${req.accountId} order by epoch`;
    const chain = await sql<{ epoch: number; prev: SealedBox }[]>`select epoch, prev from polis_key_chain where polis_id = ${id} order by epoch`;
    const symposia = await sql<{ id: string; meta: SealedBox; epoch: number; created_at: Date }[]>`select id, meta, epoch, created_at from symposia where polis_id = ${id} order by created_at`;
    const skeys = await sql<{ symposion_id: string; epoch: number; polis_epoch: number; wrapped: SealedBox }[]>`
      select k.symposion_id, k.epoch, k.polis_epoch, k.wrapped from symposion_keys k join symposia s on s.id = k.symposion_id where s.polis_id = ${id} order by k.epoch`;
    const guests = await sql<{ id: string; symposion_id: string; name: string; sign_pk: string; box_pk: string; mode: GuestMode; expires_at: Date }[]>`
      select g.id, g.symposion_id, g.name, g.sign_pk, g.box_pk, l.mode, g.expires_at from guest_sessions g
      join guest_links l on l.id = g.link_id join symposia s on s.id = g.symposion_id
      where s.polis_id = ${id} and g.expires_at > now() and l.expires_at > now() order by g.expires_at`;
    const govern = can.govern(role);
    const invites = govern
      ? await sql<{ id: string; expires_at: Date; uses_left: number }[]>`select id, expires_at, uses_left from invites where polis_id = ${id} and expires_at > now() and uses_left > 0`
      : [];
    const links = govern
      ? await sql<{ id: string; symposion_id: string; mode: GuestMode; expires_at: Date }[]>`
          select l.id, l.symposion_id, l.mode, l.expires_at from guest_links l join symposia s on s.id = l.symposion_id
          where s.polis_id = ${id} and l.expires_at > now() order by l.created_at`
      : [];
    const detail: PolisDetail = {
      id,
      role,
      meta: p.meta,
      epoch: p.epoch,
      rotationNeeded: p.rotation_needed,
      members: members.map((m) => ({ accountId: m.account_id, signPk: m.sign_pk, boxPk: m.box_pk, role: m.role, profile: m.profile, joinedAt: m.joined_at.toISOString() })),
      myKeys,
      chain,
      symposia: symposia.map((s) => ({
        id: s.id,
        meta: s.meta,
        epoch: s.epoch,
        createdAt: s.created_at.toISOString(),
        keys: skeys.filter((k) => k.symposion_id === s.id).map((k) => ({ epoch: k.epoch, polisEpoch: k.polis_epoch, wrapped: k.wrapped })),
      })),
      guests: guests.map((g) => ({ id: g.id, symposionId: g.symposion_id, name: g.name, signPk: g.sign_pk, boxPk: g.box_pk, mode: g.mode, expiresAt: g.expires_at.toISOString() })),
      invites: invites.map((i) => ({ id: i.id, expiresAt: i.expires_at.toISOString(), usesLeft: i.uses_left })),
      links: links.map((l) => ({ id: l.id, symposionId: l.symposion_id, mode: l.mode, expiresAt: l.expires_at.toISOString() })),
    };
    return detail;
  });

  app.put('/v1/polis/:id/meta', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { meta?: SealedBox };
    if (!isUuid(id) || !isSealedBox(b?.meta, 4096)) return bad(reply);
    if (!(await archonOf(id, req.accountId))) return bad(reply, 'forbidden', 403);
    const [p] = await sql<{ epoch: number }[]>`select epoch from polis where id = ${id}`;
    if (b.meta.e !== p.epoch) return bad(reply, 'stale-key', 409);
    await sql`update polis set meta = ${sql.json(b.meta as never)} where id = ${id}`;
    await hub.polisChanged(id);
    return { ok: true };
  });

  app.put('/v1/polis/:id/profile', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { profile?: SealedBox };
    if (!isUuid(id) || !isSealedBox(b?.profile, 4096)) return bad(reply);
    if (!(await roleIn(sql, id, req.accountId))) return bad(reply, 'not-found', 404);
    await sql`update polis_members set profile = ${sql.json(b.profile as never)} where polis_id = ${id} and account_id = ${req.accountId}`;
    await hub.polisChanged(id);
    return { ok: true };
  });

  // ---------------------------------------------------------------- membri

  app.patch('/v1/polis/:id/members/:accountId', pre, async (req, reply) => {
    const { id, accountId } = req.params as { id: string; accountId: string };
    const b = req.body as { role?: MemberRole };
    if (!isUuid(id) || !isUuid(accountId) || !isMemberRole(b?.role)) return bad(reply);
    if (!(await archonOf(id, req.accountId))) return bad(reply, 'forbidden', 403);
    const ok = await sql
      .begin(async (tx) => {
        await tx`update polis_members set role = ${b.role!} where polis_id = ${id} and account_id = ${accountId}`;
        const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from polis_members where polis_id = ${id} and role = 'archon'`;
        if (n < 1) throw new Error('last-archon');
        return true;
      })
      .catch(() => false);
    if (ok) await hub.polisChanged(id);
    return ok ? { ok: true } : bad(reply, 'last-archon', 409);
  });

  /** Allontanare un membro (Archon) o uscire (se stessi). La chiave va poi ruotata. */
  app.delete('/v1/polis/:id/members/:accountId', pre, async (req, reply) => {
    const { id, accountId } = req.params as { id: string; accountId: string };
    if (!isUuid(id) || !isUuid(accountId)) return bad(reply);
    const me = await roleIn(sql, id, req.accountId);
    if (!me || (accountId !== req.accountId && !can.govern(me))) return bad(reply, 'forbidden', 403);
    const ok = await sql
      .begin(async (tx) => {
        const del = await tx`delete from polis_members where polis_id = ${id} and account_id = ${accountId}`;
        if (!del.count) throw new Error('not-member');
        const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from polis_members where polis_id = ${id} and role = 'archon'`;
        const [{ m }] = await tx<{ m: number }[]>`select count(*)::int as m from polis_members where polis_id = ${id}`;
        if (m > 0 && n < 1) throw new Error('last-archon');
        await tx`delete from polis_keys where polis_id = ${id} and account_id = ${accountId}`;
        // inviti aperti e link degli ospiti portano le chiavi attuali: non valgono piu'
        await tx`delete from invites where polis_id = ${id}`;
        await tx`delete from guest_links where symposion_id in (select id from symposia where polis_id = ${id})`;
        await tx`update polis set rotation_needed = true where id = ${id}`;
        return true;
      })
      .catch(() => false);
    if (ok) {
      await hub.evict(accountId, id);
      await hub.polisChanged(id, [accountId]);
      await kickGuests(id);
    }
    return ok ? { ok: true } : bad(reply, 'cannot-remove', 409);
  });

  /** Nuova epoca della chiave: per ogni membro rimasto, per ogni Symposion, e il nome della Polis. */
  app.post('/v1/polis/:id/rotate', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as RotateRequest;
    if (!isUuid(id) || !Number.isInteger(b?.epoch) || !Array.isArray(b.envelopes) || !Array.isArray(b.symposia) || !isSealedBox(b.prev) || !isSealedBox(b.meta)) return bad(reply);
    if (!(await archonOf(id, req.accountId))) return bad(reply, 'forbidden', 403);
    const ok = await sql
      .begin(async (tx) => {
        const [p] = await tx<{ epoch: number }[]>`select epoch from polis where id = ${id} for update`;
        if (b.epoch !== p.epoch + 1 || b.prev.e !== b.epoch || b.meta.e !== b.epoch) throw new Error('epoch');
        const members = (await tx<{ account_id: string }[]>`select account_id from polis_members where polis_id = ${id}`).map((m) => m.account_id).sort();
        const given = b.envelopes.map((e) => e.accountId).sort();
        if (JSON.stringify(members) !== JSON.stringify(given) || !b.envelopes.every((e) => isSealedKey(e.sealed))) throw new Error('envelopes');
        const symposia = (await tx<{ id: string }[]>`select id from symposia where polis_id = ${id}`).map((o) => o.id).sort();
        if (JSON.stringify(symposia) !== JSON.stringify(b.symposia.map((o) => o.symposionId).sort()) || !b.symposia.every((o) => isSealedBox(o.key) && o.key.e === b.epoch)) throw new Error('symposia');
        for (const e of b.envelopes) await tx`insert into polis_keys (polis_id, epoch, account_id, sealed) values (${id}, ${b.epoch}, ${e.accountId}, ${e.sealed})`;
        await tx`insert into polis_key_chain (polis_id, epoch, prev) values (${id}, ${b.epoch}, ${tx.json(b.prev as never)})`;
        for (const o of b.symposia) {
          await tx`update symposia set epoch = epoch + 1 where id = ${o.symposionId}`;
          await tx`insert into symposion_keys (symposion_id, epoch, polis_epoch, wrapped) select ${o.symposionId}, epoch, ${b.epoch}, ${tx.json(o.key as never)} from symposia where id = ${o.symposionId}`;
        }
        await tx`update polis set epoch = ${b.epoch}, meta = ${tx.json(b.meta as never)}, rotation_needed = false where id = ${id}`;
        await tx`delete from invites where polis_id = ${id}`;
        await tx`delete from guest_links where symposion_id in (select id from symposia where polis_id = ${id})`;
        return true;
      })
      .catch(() => false);
    if (ok) {
      await hub.polisChanged(id);
      await kickGuests(id);
    }
    return ok ? { ok: true } : bad(reply, 'bad-rotation', 409);
  });

  // ---------------------------------------------------------------- inviti nella Polis (con account)

  app.post('/v1/polis/:id/invites', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as CreateInviteRequest;
    if (!isUuid(id) || !isUuid(b?.id) || !isSealedBox(b.key)) return bad(reply);
    if (!(await archonOf(id, req.accountId))) return bad(reply, 'forbidden', 403);
    const [p] = await sql<{ epoch: number; rotation_needed: boolean }[]>`select epoch, rotation_needed from polis where id = ${id}`;
    if (p.rotation_needed || b.key.e !== p.epoch) return bad(reply, 'rotate-first', 409);
    const hours = hoursIn(b.hours, 24 * 14);
    const uses = Math.min(Math.max(Math.floor(b.uses), 1), 100);
    await sql`insert into invites (id, polis_id, key, epoch, expires_at, uses_left)
      values (${b.id}, ${id}, ${sql.json(b.key as never)}, ${p.epoch}, now() + make_interval(hours => ${hours}), ${uses})`;
    await hub.polisChanged(id);
    return { id: b.id };
  });

  app.delete('/v1/polis/:id/invites/:inviteId', pre, async (req, reply) => {
    const { id, inviteId } = req.params as { id: string; inviteId: string };
    if (!isUuid(id) || !isUuid(inviteId)) return bad(reply);
    if (!(await archonOf(id, req.accountId))) return bad(reply, 'forbidden', 403);
    await sql`delete from invites where id = ${inviteId} and polis_id = ${id}`;
    await hub.polisChanged(id);
    return { ok: true };
  });

  app.get('/v1/invites/:id', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    const [i] = await sql<{ polis_id: string; key: SealedBox; meta: SealedBox; expires_at: Date }[]>`
      select i.polis_id, i.key, p.meta, i.expires_at from invites i join polis p on p.id = i.polis_id
      where i.id = ${id} and i.expires_at > now() and i.uses_left > 0`;
    if (!i) return bad(reply, 'not-found', 404);
    return { id, polisId: i.polis_id, key: i.key, meta: i.meta, expiresAt: i.expires_at.toISOString() };
  });

  app.post('/v1/invites/:id/accept', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as AcceptInviteRequest;
    if (!isUuid(id) || !isSealedKey(b?.sealed) || !isSealedBox(b.profile, 4096)) return bad(reply);
    const polisId = await sql
      .begin(async (tx) => {
        const [i] = await tx<{ polis_id: string; epoch: number }[]>`
          select polis_id, epoch from invites where id = ${id} and expires_at > now() and uses_left > 0 for update`;
        if (!i) throw new Error('not-found');
        const [already] = await tx`select 1 from polis_members where polis_id = ${i.polis_id} and account_id = ${req.accountId}`;
        if (!already) {
          await tx`insert into polis_members (polis_id, account_id, role, profile) values (${i.polis_id}, ${req.accountId}, 'polites', ${tx.json(b.profile as never)})`;
          await tx`insert into polis_keys (polis_id, epoch, account_id, sealed) values (${i.polis_id}, ${i.epoch}, ${req.accountId}, ${b.sealed})`;
          await tx`update invites set uses_left = uses_left - 1 where id = ${id}`;
        }
        return i.polis_id;
      })
      .catch(() => null);
    if (polisId) await hub.polisChanged(polisId);
    return polisId ? { polisId } : bad(reply, 'not-found', 404);
  });

  // ---------------------------------------------------------------- Symposia

  app.post('/v1/polis/:id/symposia', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as CreateSymposionRequest;
    if (!isUuid(id) || !isUuid(b?.id) || !isSealedBox(b.meta) || !isSealedBox(b.key)) return bad(reply);
    if (!(await archonOf(id, req.accountId))) return bad(reply, 'forbidden', 403);
    const [p] = await sql<{ epoch: number }[]>`select epoch from polis where id = ${id}`;
    if (b.key.e !== p.epoch || b.meta.e !== 1) return bad(reply, 'stale-key', 409);
    try {
      await sql.begin(async (tx) => {
        await tx`insert into symposia (id, polis_id, meta) values (${b.id}, ${id}, ${tx.json(b.meta as never)})`;
        await tx`insert into symposion_keys (symposion_id, epoch, polis_epoch, wrapped) values (${b.id}, 1, ${p.epoch}, ${tx.json(b.key as never)})`;
      });
    } catch {
      return bad(reply, 'conflict', 409);
    }
    await hub.polisChanged(id);
    return { id: b.id };
  });

  /** Rinominare un Symposion: il nome e' cifrato con la sua chiave dell'epoca 1 (come alla creazione). */
  app.put('/v1/symposia/:id/meta', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { meta?: SealedBox };
    if (!isUuid(id) || !isSealedBox(b?.meta, 4096) || b.meta.e !== 1) return bad(reply);
    const [s] = await sql<{ polis_id: string }[]>`select polis_id from symposia where id = ${id}`;
    if (!s || !(await archonOf(s.polis_id, req.accountId))) return bad(reply, 'forbidden', 403);
    await sql`update symposia set meta = ${sql.json(b.meta as never)} where id = ${id}`;
    await hub.polisChanged(s.polis_id);
    return { ok: true };
  });

  app.delete('/v1/symposia/:id', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    const [s] = await sql<{ polis_id: string }[]>`select polis_id from symposia where id = ${id}`;
    if (!s || !(await archonOf(s.polis_id, req.accountId))) return bad(reply, 'forbidden', 403);
    await sql`delete from symposia where id = ${id}`;
    await hub.polisChanged(s.polis_id);
    return { ok: true };
  });

  // ---------------------------------------------------------------- link per gli ospiti (Xenoi)

  app.post('/v1/symposia/:id/links', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as CreateGuestLinkRequest;
    if (!isUuid(id) || !isUuid(b?.id) || !isGuestMode(b.mode) || !isSealedBox(b.key, 16384) || !isSealedBox(b.meta, 4096)) return bad(reply);
    const [s] = await sql<{ polis_id: string; epoch: number; rotation_needed: boolean }[]>`
      select s.polis_id, s.epoch, p.rotation_needed from symposia s join polis p on p.id = s.polis_id where s.id = ${id}`;
    if (!s || !(await archonOf(s.polis_id, req.accountId))) return bad(reply, 'forbidden', 403);
    if (s.rotation_needed || b.key.e !== s.epoch) return bad(reply, 'rotate-first', 409);
    const hours = hoursIn(b.hours, 24 * 30);
    await sql`insert into guest_links (id, symposion_id, mode, key, meta, epoch, expires_at)
      values (${b.id}, ${id}, ${b.mode}, ${sql.json(b.key as never)}, ${sql.json(b.meta as never)}, ${s.epoch}, now() + make_interval(hours => ${hours}))`;
    await hub.polisChanged(s.polis_id);
    return { id: b.id };
  });

  /** Revoca: gli ospiti di quel link escono subito; la chiave del Symposion va ruotata (la conoscevano). */
  app.delete('/v1/links/:id', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    const [l] = await sql<{ polis_id: string }[]>`select s.polis_id from guest_links l join symposia s on s.id = l.symposion_id where l.id = ${id}`;
    if (!l || !(await archonOf(l.polis_id, req.accountId))) return bad(reply, 'forbidden', 403);
    const guests = await sql<{ id: string }[]>`select id from guest_sessions where link_id = ${id} and expires_at > now()`;
    await sql.begin(async (tx) => {
      await tx`delete from guest_links where id = ${id}`;
      if (guests.length) await tx`update polis set rotation_needed = true where id = ${l.polis_id}`;
    });
    for (const g of guests) hub.kick(g.id);
    await hub.polisChanged(l.polis_id);
    return { ok: true };
  });
}
