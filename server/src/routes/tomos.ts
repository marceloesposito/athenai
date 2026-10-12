// Tomos (documenti) di un Oikos e il loro registro cifrato. Titoli e contenuti arrivano gia' cifrati
// con la chiave dell'Oikos; il server controlla ruoli, firme ed epoche, e conserva le buste cosi'.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { can, canPush, isUuid, isSealedBox, logMessage, type Role, type SealedBox, type LogEntry, type TomosView, type CreateTomosRequest, type ClientMessage } from '@athenai/protocol';
import type { Sql } from '../db.ts';
import type { Auth } from '../auth.ts';
import type { Hub } from '../live.ts';
import { verifySignature } from '../crypto.ts';

const bad = (reply: FastifyReply, error = 'bad-request', code = 400) => reply.code(code).send({ error });

interface Access {
  role: Role;
  polisId: string;
  oikosId: string;
  /** epoca attuale della chiave dell'Oikos */
  epoch: number;
}

async function oikosAccess(sql: Sql, oikosId: string, accountId: string): Promise<Access | null> {
  const [r] = await sql<{ role: Role; polis_id: string; epoch: number }[]>`
    select m.role, o.polis_id, o.epoch from oikos o join polis_members m on m.polis_id = o.polis_id
    where o.id = ${oikosId} and m.account_id = ${accountId}`;
  return r ? { role: r.role, polisId: r.polis_id, oikosId, epoch: r.epoch } : null;
}

export async function tomosAccess(sql: Sql, tomosId: string, accountId: string): Promise<Access | null> {
  const [r] = await sql<{ role: Role; polis_id: string; oikos_id: string; epoch: number }[]>`
    select m.role, o.polis_id, o.id as oikos_id, o.epoch from tomos t
    join oikos o on o.id = t.oikos_id join polis_members m on m.polis_id = o.polis_id
    where t.id = ${tomosId} and m.account_id = ${accountId}`;
  return r ? { role: r.role, polisId: r.polis_id, oikosId: r.oikos_id, epoch: r.epoch } : null;
}

type Row = { seq: string; stream: LogEntry['stream']; kind: LogEntry['kind']; author: string; author_pk: string | null; box: SealedBox; sig: string };
const toEntry = (r: Row): LogEntry => ({ seq: Number(r.seq), stream: r.stream, kind: r.kind, author: r.author, authorPk: r.author_pk ?? '', box: r.box, sig: r.sig });

export async function readLog(sql: Sql, tomosId: string): Promise<LogEntry[]> {
  const rows = await sql<Row[]>`
    select l.seq, l.stream, l.kind, l.author, a.sign_pk as author_pk, l.box, l.sig
    from tomos_log l left join accounts a on a.id = l.author where l.tomos_id = ${tomosId} order by l.seq`;
  return rows.map(toEntry);
}

/** Una voce nuova nel registro: diritto di scrivere in quel flusso, firma dell'autore, epoca attuale. */
export async function pushEntry(sql: Sql, accountId: string, m: Extract<ClientMessage, { t: 'push' }>): Promise<{ entry: LogEntry } | { error: string }> {
  const a = await tomosAccess(sql, m.tomosId, accountId);
  if (!a) return { error: 'not-found' };
  if (!canPush(a.role, m.stream)) return { error: 'forbidden' };
  if (m.box.e !== a.epoch) return { error: 'stale-key' };
  const [acc] = await sql<{ sign_pk: string }[]>`select sign_pk from accounts where id = ${accountId}`;
  if (!(await verifySignature(logMessage(m.tomosId, m.stream, m.kind, m.box), m.sig, acc.sign_pk))) return { error: 'bad-signature' };
  const entry = await sql.begin(async (tx) => {
    const [r] = await tx<Row[]>`
      insert into tomos_log (tomos_id, stream, kind, author, box, sig)
      values (${m.tomosId}, ${m.stream}, ${m.kind}, ${accountId}, ${tx.json(m.box as never)}, ${m.sig})
      returning seq, stream, kind, author, ${acc.sign_pk}::text as author_pk, box, sig`;
    // uno stato intero sostituisce le voci (dello stesso flusso) che il client aveva gia' unito
    if (m.kind === 'snapshot') await tx`delete from tomos_log where tomos_id = ${m.tomosId} and stream = ${m.stream} and seq <= ${m.covers!} and seq <> ${r.seq}`;
    await tx`update tomos set updated_at = now() where id = ${m.tomosId}`;
    return toEntry(r);
  });
  return { entry };
}

export function tomosRoutes(app: FastifyInstance, sql: Sql, auth: Auth, hub: Hub) {
  const pre = { preHandler: auth.require };

  app.get('/v1/oikos/:id/tomos', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    if (!(await oikosAccess(sql, id, req.accountId))) return bad(reply, 'not-found', 404);
    const rows = await sql<{ id: string; meta: SealedBox; created_at: Date; updated_at: Date }[]>`
      select id, meta, created_at, updated_at from tomos where oikos_id = ${id} order by created_at`;
    return rows.map((r): TomosView => ({ id: r.id, oikosId: id, meta: r.meta, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() }));
  });

  app.post('/v1/oikos/:id/tomos', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as CreateTomosRequest;
    if (!isUuid(id) || !isUuid(b?.id) || !isSealedBox(b.meta, 4096)) return bad(reply);
    const a = await oikosAccess(sql, id, req.accountId);
    if (!a) return bad(reply, 'not-found', 404);
    if (!can.write(a.role)) return bad(reply, 'forbidden', 403);
    if (b.meta.e !== a.epoch) return bad(reply, 'stale-key', 409);
    try {
      await sql`insert into tomos (id, oikos_id, meta) values (${b.id}, ${id}, ${sql.json(b.meta as never)})`;
    } catch {
      return bad(reply, 'conflict', 409);
    }
    await hub.polisChanged(a.polisId);
    return { id: b.id };
  });

  app.put('/v1/tomos/:id/meta', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { meta?: SealedBox };
    if (!isUuid(id) || !isSealedBox(b?.meta, 4096)) return bad(reply);
    const a = await tomosAccess(sql, id, req.accountId);
    if (!a) return bad(reply, 'not-found', 404);
    if (!can.write(a.role)) return bad(reply, 'forbidden', 403);
    if (b.meta.e !== a.epoch) return bad(reply, 'stale-key', 409);
    await sql`update tomos set meta = ${sql.json(b.meta as never)}, updated_at = now() where id = ${id}`;
    await hub.polisChanged(a.polisId);
    return { ok: true };
  });

  app.delete('/v1/tomos/:id', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    const a = await tomosAccess(sql, id, req.accountId);
    if (!a) return bad(reply, 'not-found', 404);
    if (!can.write(a.role)) return bad(reply, 'forbidden', 403);
    await sql`delete from tomos where id = ${id}`;
    await hub.polisChanged(a.polisId);
    return { ok: true };
  });

  /** Il registro intero (per la ricerca locale e per chi non e' collegato in tempo reale). */
  app.get('/v1/tomos/:id/log', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    if (!(await tomosAccess(sql, id, req.accountId))) return bad(reply, 'not-found', 404);
    return readLog(sql, id);
  });
}
