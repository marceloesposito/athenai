// Accesso al server: chi possiede la chiave Ed25519 dell'account firma una sfida e riceve un token
// di sessione (12 ore, salvato solo come hash). OIDC (Zitadel) serve una volta sola, a legare le
// chiavi all'account d'accesso; le chiavi restano la prova d'identita' verso il server.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import type { Sql } from './db.ts';
import { randomToken, sha256 } from './crypto.ts';

const CHALLENGE_TTL = 2 * 60_000;
const SESSION_HOURS = 12;

export class Auth {
  private challenges = new Map<string, { signPk: string; expires: number }>();
  private jwks: ReturnType<typeof createRemoteJWKSet> | null;
  private cfg: Config;
  private sql: Sql;

  constructor(cfg: Config, sql: Sql) {
    this.cfg = cfg;
    this.sql = sql;
    this.jwks = cfg.oidcIssuer ? createRemoteJWKSet(new URL(`${cfg.oidcIssuer.replace(/\/$/, '')}/oauth/v2/keys`)) : null;
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

  /** A chi appartiene l'account: dal token OIDC verificato, o dall'id di prova se ammesso. */
  async binding(idToken: unknown, trialId: unknown): Promise<string | null> {
    if (typeof idToken === 'string' && this.jwks) {
      try {
        const { payload } = await jwtVerify(idToken, this.jwks, { issuer: this.cfg.oidcIssuer, audience: this.cfg.oidcAudience });
        return payload.sub ? `oidc:${payload.sub}` : null;
      } catch {
        return null;
      }
    }
    if (this.cfg.allowTrial && typeof trialId === 'string' && /^trial-[0-9a-f-]{36}$/.test(trialId)) return `trial:${trialId}`;
    return null;
  }

  async newSession(accountId: string): Promise<{ token: string; expiresAt: string }> {
    const token = randomToken();
    const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
    await this.sql`delete from sessions where expires_at < now()`;
    await this.sql`insert into sessions (token_hash, account_id, expires_at) values (${sha256(token)}, ${accountId}, ${expires})`;
    return { token, expiresAt: expires.toISOString() };
  }

  /** preHandler: richiede una sessione valida e mette l'account nella richiesta */
  require = async (req: FastifyRequest, reply: FastifyReply) => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? '');
    if (!m) return reply.code(401).send({ error: 'unauthorized' });
    const [row] = await this.sql<{ account_id: string }[]>`select account_id from sessions where token_hash = ${sha256(m[1])} and expires_at > now()`;
    if (!row) return reply.code(401).send({ error: 'unauthorized' });
    req.accountId = row.account_id;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    accountId: string;
  }
}
