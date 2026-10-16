// Sessioni. Un account entra con la chiave d'accesso ricavata dalla password (o, con "resta
// connesso", firmando una sfida con la propria chiave); un ospite con la sessione aperta dal suo
// link. I token valgono 12 ore (gli ospiti fino alla scadenza del link) e si salvano solo come hash.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GuestMode } from '@athenai/protocol';
import type { Sql } from './db.ts';
import { randomToken, sha256 } from './crypto.ts';

const CHALLENGE_TTL = 2 * 60_000;
const SESSION_HOURS = 12;
/** tentativi di accesso per email in 15 minuti */
const MAX_ATTEMPTS = 10;

export type Principal =
  | { kind: 'account'; id: string }
  | { kind: 'guest'; id: string; symposionId: string; mode: GuestMode; name: string };

export class Auth {
  private challenges = new Map<string, { signPk: string; expires: number }>();
  private attempts = new Map<string, { n: number; until: number }>();
  private sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  newChallenge(signPk: string): string {
    const now = Date.now();
    for (const [k, v] of this.challenges) if (v.expires < now) this.challenges.delete(k);
    if (this.challenges.size > 10_000) throw new Error('troppe sfide');
    const challenge = randomToken();
    this.challenges.set(challenge, { signPk, expires: now + CHALLENGE_TTL });
    return challenge;
  }

  /** la sfida vale una volta sola e solo per quella chiave */
  takeChallenge(challenge: string, signPk: string): boolean {
    const c = this.challenges.get(challenge);
    this.challenges.delete(challenge);
    return !!c && c.signPk === signPk && c.expires >= Date.now();
  }

  /** Limite ai tentativi falliti per email: false se bisogna aspettare. */
  allowAttempt(key: string): boolean {
    const a = this.attempts.get(key);
    return !a || a.until < Date.now() || a.n < MAX_ATTEMPTS;
  }

  failedAttempt(key: string) {
    const now = Date.now();
    const a = this.attempts.get(key);
    if (!a || a.until < now) this.attempts.set(key, { n: 1, until: now + 15 * 60_000 });
    else a.n++;
    if (this.attempts.size > 100_000) this.attempts.clear();
  }

  async newSession(accountId: string): Promise<{ token: string; expiresAt: string }> {
    const token = randomToken();
    const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
    await this.sql`delete from sessions where expires_at < now()`;
    await this.sql`insert into sessions (token_hash, account_id, expires_at) values (${sha256(token)}, ${accountId}, ${expires})`;
    return { token, expiresAt: expires.toISOString() };
  }

  /** Chi c'e' dietro un token: un account o un ospite. */
  async principalFor(token: string): Promise<Principal | null> {
    const h = sha256(token);
    const [acc] = await this.sql<{ account_id: string }[]>`select account_id from sessions where token_hash = ${h} and expires_at > now()`;
    if (acc) return { kind: 'account', id: acc.account_id };
    const [g] = await this.sql<{ id: string; symposion_id: string; mode: GuestMode; name: string }[]>`
      select g.id, g.symposion_id, l.mode, g.name from guest_sessions g join guest_links l on l.id = g.link_id
      where g.token_hash = ${h} and g.expires_at > now() and l.expires_at > now()`;
    return g ? { kind: 'guest', id: g.id, symposionId: g.symposion_id, mode: g.mode, name: g.name } : null;
  }

  private token(req: FastifyRequest): string | null {
    return /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
  }

  /** preHandler: solo account (non ospiti); mette l'account nella richiesta */
  require = async (req: FastifyRequest, reply: FastifyReply) => {
    const t = this.token(req);
    const p = t ? await this.principalFor(t) : null;
    if (!p || p.kind !== 'account') return reply.code(401).send({ error: 'unauthorized' });
    req.accountId = p.id;
    req.principal = p;
  };

  /** preHandler: account o ospite */
  requireAny = async (req: FastifyRequest, reply: FastifyReply) => {
    const t = this.token(req);
    const p = t ? await this.principalFor(t) : null;
    if (!p) return reply.code(401).send({ error: 'unauthorized' });
    if (p.kind === 'account') req.accountId = p.id;
    req.principal = p;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    accountId: string;
    principal: Principal;
  }
}
