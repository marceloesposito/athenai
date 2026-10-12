// Notifiche fra membri di una Polis (per ora le @menzioni nei commenti). Ognuna e' una sealed box
// verso la chiave del destinatario, firmata dentro dal mittente: il server sa solo a chi e quando.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { isUuid, isB64url, type NoticeItem, type SendNoticesRequest } from '@athenai/protocol';
import type { Sql } from '../db.ts';
import type { Auth } from '../auth.ts';
import type { Hub } from '../live.ts';

const bad = (reply: FastifyReply, error = 'bad-request', code = 400) => reply.code(code).send({ error });
const KEEP_DAYS = 30;
const MAX_KEPT = 200;

export function noticeRoutes(app: FastifyInstance, sql: Sql, auth: Auth, hub: Hub) {
  const pre = { preHandler: auth.require };

  app.post('/v1/polis/:id/notices', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as SendNoticesRequest;
    if (!isUuid(id) || !Array.isArray(b?.to) || b.to.length < 1 || b.to.length > 50) return bad(reply);
    if (!b.to.every((x) => isUuid(x?.accountId) && isB64url(x.sealed, 4096))) return bad(reply);
    const members = await sql<{ account_id: string }[]>`select account_id from polis_members where polis_id = ${id}`;
    if (!members.some((m) => m.account_id === req.accountId)) return bad(reply, 'not-found', 404);
    const ids = new Set(members.map((m) => m.account_id));
    if (!b.to.every((x) => ids.has(x.accountId) && x.accountId !== req.accountId)) return bad(reply, 'not-member');
    await sql`insert into notices ${sql(b.to.map((x) => ({ account_id: x.accountId, sealed: x.sealed })))}`;
    hub.toPrincipals(new Set(b.to.map((x) => x.accountId)), { t: 'notice' });
    return { ok: true };
  });

  app.get('/v1/me/notices', pre, async (req): Promise<NoticeItem[]> => {
    await sql`delete from notices where account_id = ${req.accountId} and created_at < now() - make_interval(days => ${KEEP_DAYS})`;
    const rows = await sql<{ id: string; sealed: string; created_at: Date }[]>`
      select id, sealed, created_at from notices where account_id = ${req.accountId} order by created_at desc limit ${MAX_KEPT}`;
    return rows.map((r) => ({ id: r.id, sealed: r.sealed, createdAt: r.created_at.toISOString() }));
  });

  /** Letta = cancellata: sul server non resta nulla. */
  app.delete('/v1/me/notices/:id', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    await sql`delete from notices where id = ${id} and account_id = ${req.accountId}`;
    return { ok: true };
  });

  app.delete('/v1/me/notices', pre, async (req) => {
    await sql`delete from notices where account_id = ${req.accountId}`;
    return { ok: true };
  });
}
