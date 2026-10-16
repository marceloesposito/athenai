// Ospiti (Xenoi): chi ha un link privato di un Symposion entra senza account, per una sessione. Le
// sue chiavi nascono nella scheda e non lasciano il browser; il server gli da' un token, un nome di
// personaggio greco (diverso da quelli presenti) e accesso a quel solo Symposion.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { isUuid, isB64url, pickGuestName, type GuestMode, type SealedBox, type GuestLinkDetail, type GuestContext, type JoinGuestRequest } from '@athenai/protocol';
import { randomInt } from 'node:crypto';
import type { Sql } from '../db.ts';
import type { Auth } from '../auth.ts';
import type { Hub } from '../live.ts';
import { randomToken, sha256 } from '../crypto.ts';

const bad = (reply: FastifyReply, error = 'bad-request', code = 400) => reply.code(code).send({ error });
/** al massimo cosi' a lungo vale una sessione da ospite (entro la scadenza del link) */
const GUEST_HOURS = 24;
const MAX_GUESTS = 200;

export function guestRoutes(app: FastifyInstance, sql: Sql, auth: Auth, hub: Hub) {
  const link = async (id: string) =>
    (
      await sql<{ id: string; symposion_id: string; polis_id: string; mode: GuestMode; key: SealedBox; meta: SealedBox; expires_at: Date }[]>`
        select l.id, l.symposion_id, s.polis_id, l.mode, l.key, l.meta, l.expires_at
        from guest_links l join symposia s on s.id = l.symposion_id where l.id = ${id} and l.expires_at > now()`
    )[0];

  /** Senza sessione: il link (le chiavi restano cifrate con il segreto del frammento). */
  app.get('/v1/links/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    const l = await link(id);
    if (!l) return bad(reply, 'not-found', 404);
    const out: GuestLinkDetail = { id, polisId: l.polis_id, symposionId: l.symposion_id, mode: l.mode, key: l.key, meta: l.meta, expiresAt: l.expires_at.toISOString() };
    return out;
  });

  app.post('/v1/links/:id/join', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as JoinGuestRequest;
    if (!isUuid(id) || !isB64url(b?.signPk, 64) || !isB64url(b.boxPk, 64)) return bad(reply);
    const l = await link(id);
    if (!l) return bad(reply, 'not-found', 404);
    const present = await sql<{ name: string }[]>`
      select g.name from guest_sessions g join guest_links k on k.id = g.link_id
      where g.symposion_id = ${l.symposion_id} and g.expires_at > now() and k.expires_at > now()`;
    if (present.length >= MAX_GUESTS) return bad(reply, 'too-many-guests', 429);
    const name = pickGuestName(present.map((p) => p.name), () => randomInt(0, 1_000_000) / 1_000_000);
    const token = randomToken();
    const expires = new Date(Math.min(l.expires_at.getTime(), Date.now() + GUEST_HOURS * 3600_000));
    try {
      const [g] = await sql<{ id: string }[]>`
        insert into guest_sessions (link_id, symposion_id, name, sign_pk, box_pk, token_hash, expires_at)
        values (${id}, ${l.symposion_id}, ${name}, ${b.signPk}, ${b.boxPk}, ${sha256(token)}, ${expires}) returning id`;
      await hub.polisChanged(l.polis_id);
      return { token, guestId: g.id, name, expiresAt: expires.toISOString() };
    } catch {
      return bad(reply, 'conflict', 409);
    }
  });

  /** Per l'ospite: chi e', dove si trova, e le chiavi pubbliche delle persone del Symposion. */
  app.get('/v1/guest/me', { preHandler: auth.requireAny }, async (req, reply) => {
    const p = req.principal;
    if (p.kind !== 'guest') return bad(reply, 'not-guest', 403);
    const [g] = await sql<{ link_id: string; polis_id: string; expires_at: Date }[]>`
      select g.link_id, s.polis_id, g.expires_at from guest_sessions g join symposia s on s.id = g.symposion_id where g.id = ${p.id}`;
    const members = await sql<{ id: string; sign_pk: string; box_pk: string }[]>`
      select a.id, a.sign_pk, a.box_pk from polis_members m join accounts a on a.id = m.account_id where m.polis_id = ${g.polis_id}`;
    // anche gli ospiti di prima: le loro chiavi servono a verificare quello che hanno scritto
    const guests = await sql<{ id: string; sign_pk: string; box_pk: string; name: string }[]>`
      select id, sign_pk, box_pk, name from guest_sessions where symposion_id = ${p.symposionId}`;
    const out: GuestContext = {
      guestId: p.id,
      name: p.name,
      mode: p.mode,
      polisId: g.polis_id,
      symposionId: p.symposionId,
      linkId: g.link_id,
      expiresAt: g.expires_at.toISOString(),
      people: [...members.map((m) => ({ id: m.id, signPk: m.sign_pk, boxPk: m.box_pk })), ...guests.map((x) => ({ id: x.id, signPk: x.sign_pk, boxPk: x.box_pk, guestName: x.name }))],
    };
    return out;
  });
}
