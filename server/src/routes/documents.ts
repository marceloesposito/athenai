// Documenti di un Symposion e il loro registro cifrato. Titoli e contenuti arrivano gia' cifrati con
// la chiave del Symposion; il server controlla ruoli (anche degli ospiti), firme ed epoche, e
// conserva le buste cosi' come sono.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { can, canPush, isUuid, isSealedBox, logMessage, type Role, type GuestMode, type SealedBox, type LogEntry, type DocumentView, type CreateDocumentRequest, type ClientMessage } from '@athenai/protocol';
import type { Sql } from '../db.ts';
import type { Auth, Principal } from '../auth.ts';
import type { Hub } from '../live.ts';
import { verifySignature } from '../crypto.ts';

const bad = (reply: FastifyReply, error = 'bad-request', code = 400) => reply.code(code).send({ error });

export interface Access {
  role: Role;
  mode?: GuestMode;
  polisId: string;
  symposionId: string;
  /** epoca attuale della chiave del Symposion */
  epoch: number;
}

/** Che cosa puo' fare chi chiede, in un Symposion: membro della Polis, o ospite di quel Symposion. */
export async function symposionAccess(sql: Sql, symposionId: string, p: Principal): Promise<Access | null> {
  if (p.kind === 'guest') {
    if (p.symposionId !== symposionId) return null;
    const [s] = await sql<{ polis_id: string; epoch: number }[]>`select polis_id, epoch from symposia where id = ${symposionId}`;
    return s ? { role: 'xenos', mode: p.mode, polisId: s.polis_id, symposionId, epoch: s.epoch } : null;
  }
  const [r] = await sql<{ role: Role; polis_id: string; epoch: number }[]>`
    select m.role, s.polis_id, s.epoch from symposia s join polis_members m on m.polis_id = s.polis_id
    where s.id = ${symposionId} and m.account_id = ${p.id}`;
  return r ? { role: r.role, polisId: r.polis_id, symposionId, epoch: r.epoch } : null;
}

export async function documentAccess(sql: Sql, documentId: string, p: Principal): Promise<Access | null> {
  const [d] = await sql<{ symposion_id: string }[]>`select symposion_id from documents where id = ${documentId}`;
  return d ? symposionAccess(sql, d.symposion_id, p) : null;
}

type Row = { seq: string; stream: LogEntry['stream']; kind: LogEntry['kind']; author: string; author_pk: string | null; box: SealedBox; sig: string };
const toEntry = (r: Row): LogEntry => ({ seq: Number(r.seq), stream: r.stream, kind: r.kind, author: r.author, authorPk: r.author_pk ?? '', box: r.box, sig: r.sig });

export async function readLog(sql: Sql, documentId: string): Promise<LogEntry[]> {
  const rows = await sql<Row[]>`
    select l.seq, l.stream, l.kind, l.author, coalesce(a.sign_pk, g.sign_pk) as author_pk, l.box, l.sig
    from doc_log l left join accounts a on a.id = l.author left join guest_sessions g on g.id = l.author
    where l.document_id = ${documentId} order by l.seq`;
  return rows.map(toEntry);
}

async function signPkOf(sql: Sql, p: Principal): Promise<string | null> {
  const [r] = p.kind === 'account' ? await sql<{ pk: string }[]>`select sign_pk as pk from accounts where id = ${p.id}` : await sql<{ pk: string }[]>`select sign_pk as pk from guest_sessions where id = ${p.id}`;
  return r?.pk ?? null;
}

/** Una voce nuova nel registro: diritto di scrivere in quel flusso, firma dell'autore, epoca attuale. */
export async function pushEntry(sql: Sql, p: Principal, m: Extract<ClientMessage, { t: 'push' }>): Promise<{ entry: LogEntry } | { error: string }> {
  const a = await documentAccess(sql, m.documentId, p);
  if (!a) return { error: 'not-found' };
  if (!canPush(a.role, m.stream, a.mode)) return { error: 'forbidden' };
  if (m.box.e !== a.epoch) return { error: 'stale-key' };
  const pk = await signPkOf(sql, p);
  if (!pk || !(await verifySignature(logMessage(m.documentId, m.stream, m.kind, m.box), m.sig, pk))) return { error: 'bad-signature' };
  const entry = await sql.begin(async (tx) => {
    const [r] = await tx<Row[]>`
      insert into doc_log (document_id, stream, kind, author, box, sig)
      values (${m.documentId}, ${m.stream}, ${m.kind}, ${p.id}, ${tx.json(m.box as never)}, ${m.sig})
      returning seq, stream, kind, author, ${pk}::text as author_pk, box, sig`;
    // uno stato intero sostituisce le voci (dello stesso flusso) che il client aveva gia' unito
    if (m.kind === 'snapshot') await tx`delete from doc_log where document_id = ${m.documentId} and stream = ${m.stream} and seq <= ${m.covers!} and seq <> ${r.seq}`;
    await tx`update documents set updated_at = now() where id = ${m.documentId}`;
    return toEntry(r);
  });
  return { entry };
}

export function documentRoutes(app: FastifyInstance, sql: Sql, auth: Auth, hub: Hub) {
  const pre = { preHandler: auth.requireAny };

  app.get('/v1/symposia/:id/documents', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    if (!(await symposionAccess(sql, id, req.principal))) return bad(reply, 'not-found', 404);
    const rows = await sql<{ id: string; meta: SealedBox; created_at: Date; updated_at: Date }[]>`
      select id, meta, created_at, updated_at from documents where symposion_id = ${id} order by created_at`;
    return rows.map((r): DocumentView => ({ id: r.id, symposionId: id, meta: r.meta, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() }));
  });

  app.post('/v1/symposia/:id/documents', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as CreateDocumentRequest;
    if (!isUuid(id) || !isUuid(b?.id) || !isSealedBox(b.meta, 4096)) return bad(reply);
    const a = await symposionAccess(sql, id, req.principal);
    if (!a) return bad(reply, 'not-found', 404);
    if (!can.write(a.role, a.mode)) return bad(reply, 'forbidden', 403);
    if (b.meta.e !== a.epoch) return bad(reply, 'stale-key', 409);
    try {
      await sql`insert into documents (id, symposion_id, meta) values (${b.id}, ${id}, ${sql.json(b.meta as never)})`;
    } catch {
      return bad(reply, 'conflict', 409);
    }
    await hub.polisChanged(a.polisId);
    return { id: b.id };
  });

  app.put('/v1/documents/:id/meta', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { meta?: SealedBox };
    if (!isUuid(id) || !isSealedBox(b?.meta, 4096)) return bad(reply);
    const a = await documentAccess(sql, id, req.principal);
    if (!a) return bad(reply, 'not-found', 404);
    if (!can.write(a.role, a.mode)) return bad(reply, 'forbidden', 403);
    if (b.meta.e !== a.epoch) return bad(reply, 'stale-key', 409);
    await sql`update documents set meta = ${sql.json(b.meta as never)}, updated_at = now() where id = ${id}`;
    await hub.polisChanged(a.polisId);
    return { ok: true };
  });

  /** Eliminare un documento: chi puo' scrivere, ma non gli ospiti. */
  app.delete('/v1/documents/:id', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    const a = await documentAccess(sql, id, req.principal);
    if (!a) return bad(reply, 'not-found', 404);
    if (a.role === 'xenos' || !can.write(a.role)) return bad(reply, 'forbidden', 403);
    await sql`delete from documents where id = ${id}`;
    await hub.polisChanged(a.polisId);
    return { ok: true };
  });

  /** Il registro intero (per la ricerca locale e per chi non e' collegato in tempo reale). */
  app.get('/v1/documents/:id/log', pre, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return bad(reply);
    if (!(await documentAccess(sql, id, req.principal))) return bad(reply, 'not-found', 404);
    return readLog(sql, id);
  });
}
