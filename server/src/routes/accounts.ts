// Account: registrazione con email e password, accesso, codice di recupero, preferenze.
// La password resta nel browser: da li' arriva una chiave d'accesso (Argon2id), di cui il server
// conserva solo lo sha256, e la chiave principale avvolta con un'altra chiave che il server non vede.
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  isB64url,
  isEmail,
  isKdfParams,
  isSealedBox,
  normalizeEmail,
  registerMessage,
  authMessage,
  KDF_DEFAULT,
  type RegisterRequest,
  type LoginRequest,
  type ChangePasswordRequest,
  type SetRecoveryRequest,
  type RecoverRequest,
  type AccountView,
  type KdfParams,
  type SealedBox,
} from '@athenai/protocol';
import type { Sql } from '../db.ts';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import { verifySignature, sha256, hmac, sameHash } from '../crypto.ts';

const bad = (reply: FastifyReply, error = 'bad-request', code = 400) => reply.code(code).send({ error });
const isKey = (x: unknown): x is string => isB64url(x, 64);

interface Row {
  id: string;
  email: string;
  auth_hash: string;
  kdf: KdfParams;
  wrapped: SealedBox;
  sign_pk: string;
  box_pk: string;
  prefs: SealedBox | null;
  recovery_auth_hash: string | null;
  recovery_wrapped: SealedBox | null;
}

const view = (r: Row): AccountView => ({
  accountId: r.id,
  email: r.email,
  signPk: r.sign_pk,
  boxPk: r.box_pk,
  kdf: r.kdf,
  wrapped: r.wrapped,
  prefs: r.prefs,
  hasRecovery: !!r.recovery_auth_hash,
});

export function accountRoutes(app: FastifyInstance, sql: Sql, auth: Auth, cfg: Config) {
  const byEmail = async (email: string) => (await sql<Row[]>`select * from accounts where email = ${email}`)[0];
  const byId = async (id: string) => (await sql<Row[]>`select * from accounts where id = ${id}`)[0];

  app.post('/v1/auth/register', async (req, reply) => {
    if (!cfg.allowSignup) return bad(reply, 'signup-closed', 403);
    const b = req.body as RegisterRequest;
    if (!isEmail(b?.email) || !isKey(b.authKey) || !isKdfParams(b.kdf) || !isSealedBox(b.wrapped, 256) || !isKey(b.signPk) || !isKey(b.boxPk) || !isB64url(b.signature, 128)) return bad(reply);
    const email = normalizeEmail(b.email);
    if (!(await verifySignature(registerMessage(b.signPk, b.boxPk, email), b.signature, b.signPk))) return bad(reply, 'bad-signature');
    try {
      const [row] = await sql<Row[]>`
        insert into accounts (email, auth_hash, kdf, wrapped, sign_pk, box_pk)
        values (${email}, ${sha256(b.authKey)}, ${sql.json(b.kdf as never)}, ${sql.json(b.wrapped as never)}, ${b.signPk}, ${b.boxPk})
        returning *`;
      return { ...(await auth.newSession(row.id)), account: view(row) };
    } catch {
      return bad(reply, 'email-taken', 409);
    }
  });

  /** Parametri per ricavare le chiavi dalla password. Per un'email sconosciuta, parametri finti ma stabili. */
  app.post('/v1/auth/prelogin', async (req, reply) => {
    const b = req.body as { email?: string };
    if (!isEmail(b?.email)) return bad(reply);
    const email = normalizeEmail(b.email);
    const row = await byEmail(email);
    return { kdf: row?.kdf ?? { salt: hmac(cfg.secret, `kdf:${email}`, 16), ...KDF_DEFAULT } };
  });

  app.post('/v1/auth/login', async (req, reply) => {
    const b = req.body as LoginRequest;
    if (!isEmail(b?.email) || !isKey(b.authKey)) return bad(reply);
    const email = normalizeEmail(b.email);
    if (!auth.allowAttempt(email)) return bad(reply, 'too-many-attempts', 429);
    const row = await byEmail(email);
    // stessa risposta per email sconosciuta e password sbagliata
    if (!row || !sameHash(sha256(b.authKey), row.auth_hash)) {
      auth.failedAttempt(email);
      return bad(reply, 'bad-credentials', 401);
    }
    return { ...(await auth.newSession(row.id)), account: view(row) };
  });

  /** Accesso con il codice di recupero: restituisce la chiave principale avvolta dal codice. */
  app.post('/v1/auth/recover', async (req, reply) => {
    const b = req.body as RecoverRequest;
    if (!isEmail(b?.email) || !isKey(b.recoveryAuth)) return bad(reply);
    const email = normalizeEmail(b.email);
    if (!auth.allowAttempt(`recover:${email}`)) return bad(reply, 'too-many-attempts', 429);
    const row = await byEmail(email);
    if (!row?.recovery_auth_hash || !row.recovery_wrapped || !sameHash(sha256(b.recoveryAuth), row.recovery_auth_hash)) {
      auth.failedAttempt(`recover:${email}`);
      return bad(reply, 'bad-credentials', 401);
    }
    return { ...(await auth.newSession(row.id)), account: view(row), recoveryWrapped: row.recovery_wrapped };
  });

  // ---------------------------------------------------------------- "resta connesso": firma di una sfida

  app.post('/v1/auth/challenge', async (req, reply) => {
    const b = req.body as { signPk?: string };
    if (!isKey(b?.signPk)) return bad(reply);
    return { challenge: auth.newChallenge(b.signPk) };
  });

  app.post('/v1/auth/session', async (req, reply) => {
    const b = req.body as { signPk?: string; challenge?: string; signature?: string };
    if (!isKey(b?.signPk) || !isB64url(b.challenge, 64) || !isB64url(b.signature, 128)) return bad(reply);
    if (!auth.takeChallenge(b.challenge, b.signPk)) return bad(reply, 'bad-challenge', 401);
    if (!(await verifySignature(authMessage(b.challenge), b.signature, b.signPk))) return bad(reply, 'bad-signature', 401);
    const [row] = await sql<Row[]>`select * from accounts where sign_pk = ${b.signPk}`;
    if (!row) return bad(reply, 'not-registered', 404);
    return { ...(await auth.newSession(row.id)), account: view(row) };
  });

  // ---------------------------------------------------------------- con sessione

  const pre = { preHandler: auth.require };

  app.get('/v1/me', pre, async (req) => view(await byId(req.accountId)));

  app.post('/v1/me/logout', pre, async (req) => {
    const t = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (t) await sql`delete from sessions where token_hash = ${sha256(t)}`;
    return { ok: true };
  });

  /** Nuova password: nuova chiave d'accesso e chiave principale riavvolta. Le altre sessioni si chiudono. */
  app.put('/v1/me/password', pre, async (req, reply) => {
    const b = req.body as ChangePasswordRequest;
    if (!isKey(b?.authKey) || !isKdfParams(b.kdf) || !isSealedBox(b.wrapped, 256)) return bad(reply);
    await sql.begin(async (tx) => {
      await tx`update accounts set auth_hash = ${sha256(b.authKey)}, kdf = ${tx.json(b.kdf as never)}, wrapped = ${tx.json(b.wrapped as never)} where id = ${req.accountId}`;
      const t = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      await tx`delete from sessions where account_id = ${req.accountId} and token_hash <> ${sha256(t)}`;
    });
    return { ok: true };
  });

  app.put('/v1/me/recovery', pre, async (req, reply) => {
    const b = req.body as SetRecoveryRequest;
    if (!isKey(b?.recoveryAuth) || !isSealedBox(b.wrapped, 256)) return bad(reply);
    await sql`update accounts set recovery_auth_hash = ${sha256(b.recoveryAuth)}, recovery_wrapped = ${sql.json(b.wrapped as never)} where id = ${req.accountId}`;
    return { ok: true };
  });

  app.delete('/v1/me/recovery', pre, async (req) => {
    await sql`update accounts set recovery_auth_hash = null, recovery_wrapped = null where id = ${req.accountId}`;
    return { ok: true };
  });

  app.put('/v1/me/prefs', pre, async (req, reply) => {
    const b = req.body as { prefs?: unknown };
    if (!isSealedBox(b?.prefs, 2048)) return bad(reply);
    await sql`update accounts set prefs = ${sql.json(b.prefs as never)} where id = ${req.accountId}`;
    return { ok: true };
  });
}
