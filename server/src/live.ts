// Tempo reale (/v1/live, WebSocket): registro dei documenti, presenza e avvisi di cambiamento. Il
// server inoltra solo buste cifrate; controlla chi puo' leggere e scrivere (membri e ospiti).
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { parseClientMessage, type ServerMessage, type ClientMessage } from '@athenai/protocol';
import type { Sql } from './db.ts';
import type { Auth, Principal } from './auth.ts';
import { randomToken } from './crypto.ts';
import { documentAccess, readLog, pushEntry } from './routes/documents.ts';

const AUTH_TIMEOUT = 10_000;
const MAX_SUBS = 50;

interface Conn {
  ws: WebSocket;
  cid: string;
  principal: Principal | null;
  subs: Set<string>;
}

export class Hub {
  /** connessioni per account o ospite */
  private byPrincipal = new Map<string, Set<Conn>>();
  private byDoc = new Map<string, Set<Conn>>();
  private sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  send(c: Conn, m: ServerMessage) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m));
  }

  toPrincipals(ids: Iterable<string>, m: ServerMessage) {
    for (const id of ids) for (const c of this.byPrincipal.get(id) ?? []) this.send(c, m);
  }

  toDoc(documentId: string, m: ServerMessage, except?: Conn) {
    for (const c of this.byDoc.get(documentId) ?? []) if (c !== except) this.send(c, m);
  }

  /** Avvisa membri e ospiti (e chi e' appena uscito) che la Polis e' cambiata: ricaricano da se'. */
  async polisChanged(polisId: string, also: string[] = []) {
    const rows = await this.sql<{ id: string }[]>`
      select account_id as id from polis_members where polis_id = ${polisId}
      union all select g.id from guest_sessions g join symposia s on s.id = g.symposion_id where s.polis_id = ${polisId} and g.expires_at > now()`;
    this.toPrincipals(new Set([...rows.map((r) => r.id), ...also]), { t: 'polis', polisId });
  }

  /** Chi esce da una Polis smette subito di ricevere i suoi documenti. */
  async evict(accountId: string, polisId: string) {
    const conns = this.byPrincipal.get(accountId);
    if (!conns?.size) return;
    const rows = await this.sql<{ id: string }[]>`select d.id from documents d join symposia s on s.id = d.symposion_id where s.polis_id = ${polisId}`;
    for (const c of conns) for (const r of rows) this.unsub(c, r.id);
  }

  /** Un ospite il cui link e' stato revocato: connessioni chiuse. */
  kick(id: string) {
    for (const c of this.byPrincipal.get(id) ?? []) c.ws.close(4401, 'revoked');
  }

  attach(c: Conn, p: Principal) {
    c.principal = p;
    const set = this.byPrincipal.get(p.id) ?? new Set();
    set.add(c);
    this.byPrincipal.set(p.id, set);
  }

  sub(c: Conn, documentId: string) {
    c.subs.add(documentId);
    const set = this.byDoc.get(documentId) ?? new Set();
    set.add(c);
    this.byDoc.set(documentId, set);
  }

  unsub(c: Conn, documentId: string) {
    if (!c.subs.delete(documentId)) return;
    const set = this.byDoc.get(documentId);
    set?.delete(c);
    if (set && !set.size) this.byDoc.delete(documentId);
    if (c.principal) this.toDoc(documentId, { t: 'aw', documentId, from: c.principal.id, cid: c.cid, box: null });
  }

  detach(c: Conn) {
    for (const t of [...c.subs]) this.unsub(c, t);
    if (c.principal) {
      const set = this.byPrincipal.get(c.principal.id);
      set?.delete(c);
      if (set && !set.size) this.byPrincipal.delete(c.principal.id);
    }
  }
}

export function liveRoutes(app: FastifyInstance, sql: Sql, auth: Auth, hub: Hub) {
  app.get('/v1/live', { websocket: true }, (ws) => {
    const c: Conn = { ws, cid: randomToken(9), principal: null, subs: new Set() };
    const timer = setTimeout(() => c.principal || ws.close(4401, 'unauthorized'), AUTH_TIMEOUT);
    // i messaggi di una connessione si gestiscono in ordine
    let queue = Promise.resolve();
    ws.on('message', (data: unknown) => {
      const m = parseClientMessage(String(data));
      queue = queue.then(() => (m ? handle(m) : hub.send(c, { t: 'err', error: 'bad-message' }))).catch(() => hub.send(c, { t: 'err', error: 'server' }));
    });
    ws.on('close', () => {
      clearTimeout(timer);
      hub.detach(c);
    });

    async function handle(m: ClientMessage) {
      if (m.t === 'auth') {
        const p = await auth.principalFor(m.token);
        if (!p) return ws.close(4401, 'unauthorized');
        if (!c.principal) hub.attach(c, p);
        return hub.send(c, { t: 'ready' });
      }
      const p = c.principal;
      if (!p) return ws.close(4401, 'unauthorized');
      switch (m.t) {
        case 'sub': {
          if (c.subs.size >= MAX_SUBS) return hub.send(c, { t: 'err', error: 'too-many' });
          if (!(await documentAccess(sql, m.documentId, p))) return hub.send(c, { t: 'err', error: 'not-found' });
          hub.sub(c, m.documentId);
          return hub.send(c, { t: 'log', documentId: m.documentId, entries: await readLog(sql, m.documentId) });
        }
        case 'unsub':
          return hub.unsub(c, m.documentId);
        case 'aw':
          if (c.subs.has(m.documentId)) hub.toDoc(m.documentId, { t: 'aw', documentId: m.documentId, from: p.id, cid: c.cid, box: m.box }, c);
          return;
        case 'push': {
          const r = await pushEntry(sql, p, m);
          if ('error' in r) return hub.send(c, { t: 'err', ref: m.ref, error: r.error });
          hub.send(c, { t: 'ack', ref: m.ref, seq: r.entry.seq });
          hub.toDoc(m.documentId, { t: 'entry', documentId: m.documentId, entry: r.entry }, c);
          return;
        }
      }
    }
  });
}
