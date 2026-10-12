// Tempo reale (/v1/live, WebSocket): registro dei Tomos, presenza (Symposion) e avvisi di
// cambiamento. Il server inoltra solo buste cifrate; controlla chi puo' leggere e scrivere.
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { parseClientMessage, type ServerMessage, type ClientMessage } from '@athenai/protocol';
import type { Sql } from './db.ts';
import type { Auth } from './auth.ts';
import { randomToken } from './crypto.ts';
import { tomosAccess, readLog, pushEntry } from './routes/tomos.ts';

const AUTH_TIMEOUT = 10_000;
const MAX_SUBS = 50;

interface Conn {
  ws: WebSocket;
  cid: string;
  accountId: string | null;
  subs: Set<string>;
}

export class Hub {
  private byAccount = new Map<string, Set<Conn>>();
  private byTomos = new Map<string, Set<Conn>>();
  private sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  send(c: Conn, m: ServerMessage) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m));
  }

  toAccounts(ids: Iterable<string>, m: ServerMessage) {
    for (const id of ids) for (const c of this.byAccount.get(id) ?? []) this.send(c, m);
  }

  toTomos(tomosId: string, m: ServerMessage, except?: Conn) {
    for (const c of this.byTomos.get(tomosId) ?? []) if (c !== except) this.send(c, m);
  }

  /** Avvisa i membri (e chi e' appena uscito) che la Polis e' cambiata: ricaricano da se'. */
  async polisChanged(polisId: string, also: string[] = []) {
    const rows = await this.sql<{ account_id: string }[]>`select account_id from polis_members where polis_id = ${polisId}`;
    this.toAccounts(new Set([...rows.map((r) => r.account_id), ...also]), { t: 'polis', polisId });
  }

  /** Chi esce da una Polis smette subito di ricevere i suoi Tomos. */
  async evict(accountId: string, polisId: string) {
    const conns = this.byAccount.get(accountId);
    if (!conns?.size) return;
    const rows = await this.sql<{ id: string }[]>`select t.id from tomos t join oikos o on o.id = t.oikos_id where o.polis_id = ${polisId}`;
    for (const c of conns) for (const r of rows) this.unsub(c, r.id);
  }

  attach(c: Conn, accountId: string) {
    c.accountId = accountId;
    const set = this.byAccount.get(accountId) ?? new Set();
    set.add(c);
    this.byAccount.set(accountId, set);
  }

  sub(c: Conn, tomosId: string) {
    c.subs.add(tomosId);
    const set = this.byTomos.get(tomosId) ?? new Set();
    set.add(c);
    this.byTomos.set(tomosId, set);
  }

  unsub(c: Conn, tomosId: string) {
    if (!c.subs.delete(tomosId)) return;
    const set = this.byTomos.get(tomosId);
    set?.delete(c);
    if (set && !set.size) this.byTomos.delete(tomosId);
    if (c.accountId) this.toTomos(tomosId, { t: 'aw', tomosId, from: c.accountId, cid: c.cid, box: null });
  }

  detach(c: Conn) {
    for (const t of [...c.subs]) this.unsub(c, t);
    if (c.accountId) {
      const set = this.byAccount.get(c.accountId);
      set?.delete(c);
      if (set && !set.size) this.byAccount.delete(c.accountId);
    }
  }
}

export function liveRoutes(app: FastifyInstance, sql: Sql, auth: Auth, hub: Hub) {
  app.get('/v1/live', { websocket: true }, (ws) => {
    const c: Conn = { ws, cid: randomToken(9), accountId: null, subs: new Set() };
    const timer = setTimeout(() => c.accountId || ws.close(4401, 'unauthorized'), AUTH_TIMEOUT);
    // i messaggi di una connessione si gestiscono in ordine
    let queue = Promise.resolve();
    ws.on('message', (data) => {
      const m = parseClientMessage(String(data));
      queue = queue.then(() => (m ? handle(m) : hub.send(c, { t: 'err', error: 'bad-message' }))).catch(() => hub.send(c, { t: 'err', error: 'server' }));
    });
    ws.on('close', () => {
      clearTimeout(timer);
      hub.detach(c);
    });

    async function handle(m: ClientMessage) {
      if (m.t === 'auth') {
        const account = await auth.accountFor(m.token);
        if (!account) return ws.close(4401, 'unauthorized');
        if (!c.accountId) hub.attach(c, account);
        return hub.send(c, { t: 'ready' });
      }
      const me = c.accountId;
      if (!me) return ws.close(4401, 'unauthorized');
      switch (m.t) {
        case 'sub': {
          if (c.subs.size >= MAX_SUBS) return hub.send(c, { t: 'err', error: 'too-many' });
          if (!(await tomosAccess(sql, m.tomosId, me))) return hub.send(c, { t: 'err', error: 'not-found' });
          hub.sub(c, m.tomosId);
          return hub.send(c, { t: 'log', tomosId: m.tomosId, entries: await readLog(sql, m.tomosId) });
        }
        case 'unsub':
          return hub.unsub(c, m.tomosId);
        case 'aw':
          if (c.subs.has(m.tomosId)) hub.toTomos(m.tomosId, { t: 'aw', tomosId: m.tomosId, from: me, cid: c.cid, box: m.box }, c);
          return;
        case 'push': {
          const r = await pushEntry(sql, me, m);
          if ('error' in r) return hub.send(c, { t: 'err', ref: m.ref, error: r.error });
          hub.send(c, { t: 'ack', ref: m.ref, seq: r.entry.seq });
          hub.toTomos(m.tomosId, { t: 'entry', tomosId: m.tomosId, entry: r.entry }, c);
          return;
        }
      }
    }
  });
}
