// Polis, membri, inviti, Oikos e rotazione delle chiavi. Il server controlla appartenenza e ruoli;
// nomi, profili e chiavi arrivano gia' cifrati dal client e qui si conservano cosi' come sono.
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  can,
  isRole,
  isUuid,
  isB64url,
  isSealedBox,
  type Role,
  type SealedBox,
  type CreatePolisRequest,
  type CreateInviteRequest,
  type AcceptInviteRequest,
  type CreateOikosRequest,
  type RotateRequest,
  type PolisDetail,
  type PolisSummary,
} from '@athenai/protocol';
import type { Sql } from '../db.ts';
import type { Auth } from '../auth.ts';

const bad = (reply: FastifyReply, error = 'bad-request', code = 400) => reply.code(code).send({ error });
const isSealedKey = (x: unknown) => isB64url(x, 256);

async function roleIn(sql: Sql, polisId: string, accountId: string): Promise<Role | null> {
  const [r] = await sql<{ role: Role }[]>`select role from polis_members where polis_id = ${polisId} and account_id = ${accountId}`;
  return r?.role ?? null;
}

export function polisRoutes(app: FastifyInstance, sql: Sql, auth: Auth) {
  const pre = { preHandler: auth.require };

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
    const rows = await sql<{ id: string; role: Role; meta: SealedBox; epoch: number; rotation_needed: boolean }[]>`
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
    const members = await sql<{ account_id: string; sign_pk: string; box_pk: string; role: Role; profile: SealedBox | null; joined_at: Date }[]>`
      select m.account_id, a.sign_pk, a.box_pk, m.role, m.profile, m.joined_at
      from polis_members m join accounts a on a.id = m.account_id where m.polis_id = ${id} order by m.joined_at`;
    const myKeys = await sql<{ epoch: number; sealed: string }[]>`select epoch, sealed from polis_keys where polis_id = ${id} and account_id = ${req.accountId} order by epoch`;
    const chain = await sql<{ epoch: number; prev: SealedBox }[]>`select epoch, prev from polis_key_chain where polis_id = ${id} order by epoch`;
    const oikos = await sql<{ id: string; meta: SealedBox; epoch: number; created_at: Date }[]>`select id, meta, epoch, created_at from oikos where polis_id = ${id} order by created_at`;
    const okeys = await sql<{ oikos_id: string; epoch: number; polis_epoch: number; wrapped: SealedBox }[]>`
      select k.oikos_id, k.epoch, k.polis_epoch, k.wrapped from oikos_keys k join oikos o on o.id = k.oikos_id where o.polis_id = ${id} order by k.epoch`;
    const invites = can.govern(role)
      ? await sql<{ id: string; role: Role; expires_at: Date; uses_left: number }[]>`
          select id, role, expires_at, uses_left from invites where polis_id = ${id} and expires_at > now() and uses_left > 0`
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
      oikos: oikos.map((o) => ({
        id: o.id,
        meta: o.meta,
        epoch: o.epoch,
        createdAt: o.created_at.toISOString(),
        keys: okeys.filter((k) => k.oikos_id === o.id).map((k) => ({ epoch: k.epoch, polisEpoch: k.polis_epoch, wrapped: k.wrapped })),
      })),
      invites: invites.map((i) => ({ id: i.id, role: i.role, expiresAt: i.expires_at.toISOString(), usesLeft: i.uses_left })),
    };
    return detail;
  });

  app.put('/v1/polis/:id/profile', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { profile?: SealedBox };
    if (!isUuid(id) || !isSealedBox(b?.profile, 4096)) return bad(reply);
    if (!(await roleIn(sql, id, req.accountId))) return bad(reply, 'not-found', 404);
    await sql`update polis_members set profile = ${sql.json(b.profile as never)} where polis_id = ${id} and account_id = ${req.accountId}`;
    return { ok: true };
  });

  // ---------------------------------------------------------------- membri

  app.patch('/v1/polis/:id/members/:accountId', pre, async (req, reply) => {
    const { id, accountId } = req.params as { id: string; accountId: string };
    const b = req.body as { role?: Role };
    if (!isUuid(id) || !isUuid(accountId) || !isRole(b?.role)) return bad(reply);
    const me = await roleIn(sql, id, req.accountId);
    if (!me || !can.govern(me)) return bad(reply, 'forbidden', 403);
    const ok = await sql.begin(async (tx) => {
      await tx`update polis_members set role = ${b.role!} where polis_id = ${id} and account_id = ${accountId}`;
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from polis_members where polis_id = ${id} and role = 'archon'`;
      if (n < 1) throw new Error('last-archon');
      return true;
    }).catch(() => false);
    return ok ? { ok: true } : bad(reply, 'last-archon', 409);
  });

  /** Allontanare un membro (Archon) o uscire (se stessi). La chiave va poi ruotata. */
  app.delete('/v1/polis/:id/members/:accountId', pre, async (req, reply) => {
    const { id, accountId } = req.params as { id: string; accountId: string };
    if (!isUuid(id) || !isUuid(accountId)) return bad(reply);
    const me = await roleIn(sql, id, req.accountId);
    if (!me || (accountId !== req.accountId && !can.govern(me))) return bad(reply, 'forbidden', 403);
    const ok = await sql.begin(async (tx) => {
      const del = await tx`delete from polis_members where polis_id = ${id} and account_id = ${accountId}`;
      if (!del.count) throw new Error('not-member');
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from polis_members where polis_id = ${id} and role = 'archon'`;
      const [{ m }] = await tx<{ m: number }[]>`select count(*)::int as m from polis_members where polis_id = ${id}`;
      if (m > 0 && n < 1) throw new Error('last-archon');
      await tx`delete from polis_keys where polis_id = ${id} and account_id = ${accountId}`;
      // gli inviti aperti portano la chiave attuale: non valgono piu'
      await tx`delete from invites where polis_id = ${id}`;
      await tx`update polis set rotation_needed = true where id = ${id}`;
      return true;
    }).catch(() => false);
    return ok ? { ok: true } : bad(reply, 'cannot-remove', 409);
  });

  /** Nuova epoca della chiave: per ogni membro rimasto, per ogni Oikos, e il nome della Polis. */
  app.post('/v1/polis/:id/rotate', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as RotateRequest;
    if (!isUuid(id) || !Number.isInteger(b?.epoch) || !Array.isArray(b.envelopes) || !Array.isArray(b.oikos) || !isSealedBox(b.prev) || !isSealedBox(b.meta)) return bad(reply);
    const me = await roleIn(sql, id, req.accountId);
    if (!me || !can.govern(me)) return bad(reply, 'forbidden', 403);
    const ok = await sql.begin(async (tx) => {
      const [p] = await tx<{ epoch: number }[]>`select epoch from polis where id = ${id} for update`;
      if (b.epoch !== p.epoch + 1 || b.prev.e !== b.epoch || b.meta.e !== b.epoch) throw new Error('epoch');
      const members = (await tx<{ account_id: string }[]>`select account_id from polis_members where polis_id = ${id}`).map((m) => m.account_id).sort();
      const given = b.envelopes.map((e) => e.accountId).sort();
      if (JSON.stringify(members) !== JSON.stringify(given) || !b.envelopes.every((e) => isSealedKey(e.sealed))) throw new Error('envelopes');
      const oikos = (await tx<{ id: string }[]>`select id from oikos where polis_id = ${id}`).map((o) => o.id).sort();
      if (JSON.stringify(oikos) !== JSON.stringify(b.oikos.map((o) => o.oikosId).sort()) || !b.oikos.every((o) => isSealedBox(o.key) && o.key.e === b.epoch)) throw new Error('oikos');
      for (const e of b.envelopes) await tx`insert into polis_keys (polis_id, epoch, account_id, sealed) values (${id}, ${b.epoch}, ${e.accountId}, ${e.sealed})`;
      await tx`insert into polis_key_chain (polis_id, epoch, prev) values (${id}, ${b.epoch}, ${tx.json(b.prev as never)})`;
      for (const o of b.oikos) {
        await tx`update oikos set epoch = epoch + 1 where id = ${o.oikosId}`;
        await tx`insert into oikos_keys (oikos_id, epoch, polis_epoch, wrapped) select ${o.oikosId}, epoch, ${b.epoch}, ${tx.json(o.key as never)} from oikos where id = ${o.oikosId}`;
      }
      await tx`update polis set epoch = ${b.epoch}, meta = ${tx.json(b.meta as never)}, rotation_needed = false where id = ${id}`;
      await tx`delete from invites where polis_id = ${id}`;
      return true;
    }).catch(() => false);
    return ok ? { ok: true } : bad(reply, 'bad-rotation', 409);
  });

  // ---------------------------------------------------------------- inviti

  app.post('/v1/polis/:id/invites', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as CreateInviteRequest;
    const role: unknown = b?.role;
    if (!isUuid(id) || !isUuid(b?.id) || !isRole(role) || role === 'archon' || !isSealedBox(b.key)) return bad(reply);
    const hours = Math.min(Math.max(Math.floor(b.hours), 1), 24 * 14);
    const uses = Math.min(Math.max(Math.floor(b.uses), 1), 100);
    const me = await roleIn(sql, id, req.accountId);
    if (!me || !can.govern(me)) return bad(reply, 'forbidden', 403);
    const [p] = await sql<{ epoch: number; rotation_needed: boolean }[]>`select epoch, rotation_needed from polis where id = ${id}`;
    if (p.rotation_needed || b.key.e !== p.epoch) return bad(reply, 'rotate-first', 409);
    await sql`insert into invites (id, polis_id, role, key, epoch, expires_at, uses_left)
      values (${b.id}, ${id}, ${b.role}, ${sql.json(b.key as never)}, ${p.epoch}, now() + make_interval(hours => ${hours}), ${uses})`;
    return { id: b.id };
  });

  app.delete('/v1/polis/:id/invites/:inviteId', pre, async (req, reply) => {
    const { id, inviteId } = req.params as { id: string; inviteId: string };
    if (!isUuid(id) || !isUuid(inviteId)) return bad(reply);
    const me = await roleIn(sql, id, req.accountId);
    if (!me || !can.govern(me)) return bad(reply, 'forbidden', 403);
    await sql`delete from invites where id = ${inviteId} and polis_id = ${id}`;
    return { ok: true };
  });

  app.get('/v1/invites/:id', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    const [i] = await sql<{ polis_id: string; role: Role; key: SealedBox; meta: SealedBox; expires_at: Date }[]>`
      select i.polis_id, i.role, i.key, p.meta, i.expires_at from invites i join polis p on p.id = i.polis_id
      where i.id = ${id} and i.expires_at > now() and i.uses_left > 0`;
    if (!i) return bad(reply, 'not-found', 404);
    return { id, polisId: i.polis_id, role: i.role, key: i.key, meta: i.meta, expiresAt: i.expires_at.toISOString() };
  });

  app.post('/v1/invites/:id/accept', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as AcceptInviteRequest;
    if (!isUuid(id) || !isSealedKey(b?.sealed) || !isSealedBox(b.profile, 4096)) return bad(reply);
    const polisId = await sql.begin(async (tx) => {
      const [i] = await tx<{ polis_id: string; role: Role; epoch: number }[]>`
        select polis_id, role, epoch from invites where id = ${id} and expires_at > now() and uses_left > 0 for update`;
      if (!i) throw new Error('not-found');
      const [already] = await tx`select 1 from polis_members where polis_id = ${i.polis_id} and account_id = ${req.accountId}`;
      if (!already) {
        await tx`insert into polis_members (polis_id, account_id, role, profile) values (${i.polis_id}, ${req.accountId}, ${i.role}, ${tx.json(b.profile as never)})`;
        await tx`insert into polis_keys (polis_id, epoch, account_id, sealed) values (${i.polis_id}, ${i.epoch}, ${req.accountId}, ${b.sealed})`;
        await tx`update invites set uses_left = uses_left - 1 where id = ${id}`;
      }
      return i.polis_id;
    }).catch(() => null);
    return polisId ? { polisId } : bad(reply, 'not-found', 404);
  });

  // ---------------------------------------------------------------- Oikos

  app.post('/v1/polis/:id/oikos', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as CreateOikosRequest;
    if (!isUuid(id) || !isUuid(b?.id) || !isSealedBox(b.meta) || !isSealedBox(b.key)) return bad(reply);
    const me = await roleIn(sql, id, req.accountId);
    if (!me || !can.write(me)) return bad(reply, 'forbidden', 403);
    const [p] = await sql<{ epoch: number }[]>`select epoch from polis where id = ${id}`;
    if (b.key.e !== p.epoch || b.meta.e !== 1) return bad(reply, 'stale-key', 409);
    try {
      await sql.begin(async (tx) => {
        await tx`insert into oikos (id, polis_id, meta) values (${b.id}, ${id}, ${tx.json(b.meta as never)})`;
        await tx`insert into oikos_keys (oikos_id, epoch, polis_epoch, wrapped) values (${b.id}, 1, ${p.epoch}, ${tx.json(b.key as never)})`;
      });
    } catch {
      return bad(reply, 'conflict', 409);
    }
    return { id: b.id };
  });
}
