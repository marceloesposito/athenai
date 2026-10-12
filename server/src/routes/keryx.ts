// Keryx: notifiche fra membri di una Polis (per ora le @menzioni negli Scholia). Ognuna e' una sealed
// box verso la chiave del destinatario, firmata dentro dal mittente: il server sa solo a chi e quando.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { can, isUuid, isB64url, type Role, type KeryxItem, type SendKeryxRequest } from '@athenai/protocol';
import type { Sql } from '../db.ts';
import type { Auth } from '../auth.ts';
import type { Hub } from '../live.ts';

const bad = (reply: FastifyReply, error = 'bad-request', code = 400) => reply.code(code).send({ error });
const KEEP_DAYS = 30;
const MAX_KEPT = 200;

export function keryxRoutes(app: FastifyInstance, sql: Sql, auth: Auth, hub: Hub) {
  const pre = { preHandler: auth.require };

  app.post('/v1/polis/:id/keryx', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as SendKeryxRequest;
    if (!isUuid(id) || !Array.isArray(b?.to) || b.to.length < 1 || b.to.length > 50) return bad(reply);
    if (!b.to.every((x) => isUuid(x?.accountId) && isB64url(x.sealed, 4096))) return bad(reply);
    const members = await sql<{ account_id: string; role: Role }[]>`select account_id, role from polis_members where polis_id = ${id}`;
    const me = members.find((m) => m.account_id === req.accountId);
    if (!me) return bad(reply, 'not-found', 404);
    if (!can.comment(me.role)) return bad(reply, 'forbidden', 403);
    const ids = new Set(members.map((m) => m.account_id));
    if (!b.to.every((x) => ids.has(x.accountId) && x.accountId !== req.accountId)) return bad(reply, 'not-member');
    await sql`insert into keryx ${sql(b.to.map((x) => ({ account_id: x.accountId, sealed: x.sealed })))}`;
    hub.toAccounts(new Set(b.to.map((x) => x.accountId)), { t: 'keryx' });
    return { ok: true };
  });

  app.get('/v1/me/keryx', pre, async (req): Promise<KeryxItem[]> => {
    await sql`delete from keryx where account_id = ${req.accountId} and created_at < now() - make_interval(days => ${KEEP_DAYS})`;
    const rows = await sql<{ id: string; sealed: string; created_at: Date }[]>`
      select id, sealed, created_at from keryx where account_id = ${req.accountId} order by created_at desc limit ${MAX_KEPT}`;
    return rows.map((r) => ({ id: r.id, sealed: r.sealed, createdAt: r.created_at.toISOString() }));
  });

  /** Letta = cancellata: sul server non resta nulla. */
  app.delete('/v1/me/keryx/:id', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    await sql`delete from keryx where id = ${id} and account_id = ${req.accountId}`;
    return { ok: true };
  });

  app.delete('/v1/me/keryx', pre, async (req) => {
    await sql`delete from keryx where account_id = ${req.accountId}`;
    return { ok: true };
  });
}
