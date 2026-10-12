// Account e sessioni: registrazione delle chiavi pubbliche, ricerca per account d'accesso, sfida.
import type { FastifyInstance } from 'fastify';
import { isB64url, isSealedBox, isWrappedMaster, registerMessage, authMessage, type RegisterRequest, type LookupRequest, type LookupResponse, type PasskeyWrap, type SealedBox } from '@athenai/protocol';
import type { Sql } from '../db.ts';
import type { Auth } from '../auth.ts';
import { verifySignature } from '../crypto.ts';

export function accountRoutes(app: FastifyInstance, sql: Sql, auth: Auth) {
  app.post('/v1/accounts', async (req, reply) => {
    const b = req.body as RegisterRequest;
    if (!isB64url(b?.signPk, 64) || !isB64url(b.boxPk, 64) || !isB64url(b.signature, 128)) return reply.code(400).send({ error: 'bad-request' });
    const binding = await auth.binding(b.idToken, b.trialId);
    if (!binding) return reply.code(401).send({ error: 'unauthorized' });
    if (!(await verifySignature(registerMessage(b.signPk, b.boxPk, binding), b.signature, b.signPk))) return reply.code(400).send({ error: 'bad-signature' });
    const [existing] = await sql<{ id: string; sign_pk: string; box_pk: string }[]>`select id, sign_pk, box_pk from accounts where binding = ${binding}`;
    if (existing) {
      // lo stesso account con le stesse chiavi (secondo dispositivo): va bene; con chiavi diverse no
      if (existing.sign_pk !== b.signPk || existing.box_pk !== b.boxPk) return reply.code(409).send({ error: 'identity-mismatch' });
      return { accountId: existing.id };
    }
    const [row] = await sql<{ id: string }[]>`insert into accounts (sign_pk, box_pk, binding) values (${b.signPk}, ${b.boxPk}, ${binding}) returning id`;
    return { accountId: row.id };
  });

  /** L'identita' gia' legata a questo account d'accesso (per controllare un nuovo dispositivo). */
  app.post('/v1/accounts/lookup', async (req, reply) => {
    const b = req.body as LookupRequest;
    const binding = await auth.binding(b?.idToken, b?.trialId);
    if (!binding) return reply.code(401).send({ error: 'unauthorized' });
    const [row] = await sql<{ id: string; sign_pk: string; box_pk: string; prefs: SealedBox | null }[]>`select id, sign_pk, box_pk, prefs from accounts where binding = ${binding}`;
    if (!row) return reply.code(404).send({ error: 'not-found' });
    const passkeys = await sql<{ credential_id: string; salt: string; wrapped: PasskeyWrap['wrapped'] }[]>`
      select credential_id, salt, wrapped from account_passkeys where account_id = ${row.id} order by created_at`;
    const out: LookupResponse = {
      accountId: row.id,
      signPk: row.sign_pk,
      boxPk: row.box_pk,
      passkeys: passkeys.map((p) => ({ credentialId: p.credential_id, salt: p.salt, wrapped: p.wrapped })),
      prefs: row.prefs,
    };
    return out;
  });

  // ---------------------------------------------------------------- passkey e preferenze (con sessione)

  app.put('/v1/me/passkeys/:credentialId', { preHandler: auth.require }, async (req, reply) => {
    const { credentialId } = req.params as { credentialId: string };
    const b = req.body as { salt?: string; wrapped?: unknown };
    if (!isB64url(credentialId, 512) || !isB64url(b?.salt, 64) || !isWrappedMaster(b.wrapped)) return reply.code(400).send({ error: 'bad-request' });
    await sql`insert into account_passkeys (account_id, credential_id, salt, wrapped) values (${req.accountId}, ${credentialId}, ${b.salt}, ${sql.json(b.wrapped as never)})
      on conflict (account_id, credential_id) do update set salt = excluded.salt, wrapped = excluded.wrapped`;
    return { ok: true };
  });

  app.delete('/v1/me/passkeys/:credentialId', { preHandler: auth.require }, async (req, reply) => {
    const { credentialId } = req.params as { credentialId: string };
    if (!isB64url(credentialId, 512)) return reply.code(400).send({ error: 'bad-request' });
    await sql`delete from account_passkeys where account_id = ${req.accountId} and credential_id = ${credentialId}`;
    return { ok: true };
  });

  app.put('/v1/me/prefs', { preHandler: auth.require }, async (req, reply) => {
    const b = req.body as { prefs?: unknown };
    if (!isSealedBox(b?.prefs, 2048)) return reply.code(400).send({ error: 'bad-request' });
    await sql`update accounts set prefs = ${sql.json(b.prefs as never)} where id = ${req.accountId}`;
    return { ok: true };
  });

  app.post('/v1/auth/challenge', async (req, reply) => {
    const b = req.body as { signPk?: string };
    if (!isB64url(b?.signPk, 64)) return reply.code(400).send({ error: 'bad-request' });
    return { challenge: auth.newChallenge(b.signPk) };
  });

  app.post('/v1/auth/session', async (req, reply) => {
    const b = req.body as { signPk?: string; challenge?: string; signature?: string };
    if (!isB64url(b?.signPk, 64) || !isB64url(b.challenge, 64) || !isB64url(b.signature, 128)) return reply.code(400).send({ error: 'bad-request' });
    if (!auth.takeChallenge(b.challenge, b.signPk)) return reply.code(401).send({ error: 'bad-challenge' });
    if (!(await verifySignature(authMessage(b.challenge), b.signature, b.signPk))) return reply.code(401).send({ error: 'bad-signature' });
    const [acc] = await sql<{ id: string }[]>`select id from accounts where sign_pk = ${b.signPk}`;
    if (!acc) return reply.code(404).send({ error: 'not-registered' });
    return { accountId: acc.id, ...(await auth.newSession(acc.id)) };
  });
}
