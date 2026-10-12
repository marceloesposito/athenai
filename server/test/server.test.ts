// Test d'integrazione del server con Postgres vero (deploy/compose.yml, servizio postgres) e un client
// simulato che fa la crittografia come l'app: chiavi libsodium, firme, buste cifrate.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import _sodium from 'libsodium-wrappers-sumo';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import { authMessage, registerMessage, AD, type SealedBox, type PolisDetail } from '@athenai/protocol';
import { buildApp } from '../src/app.ts';
import { migrate, type Sql } from '../src/db.ts';

const BASE = process.env.DATABASE_URL_TEST ?? 'postgres://athenai:athenai-dev@127.0.0.1:55432/athenai';
const TEST_DB = 'athenai_test';
let s: typeof _sodium;
let sql: Sql;
let app: FastifyInstance;

const b64 = (b: Uint8Array) => s.to_base64(b, s.base64_variants.URLSAFE_NO_PADDING);
const unb64 = (t: string) => s.from_base64(t, s.base64_variants.URLSAFE_NO_PADDING);

function seal(key: Uint8Array, plaintext: string | Uint8Array, ad: string, epoch: number): SealedBox {
  const n = s.randombytes_buf(24);
  const c = s.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, ad, null, n, key);
  return { v: 1, e: epoch, n: b64(n), c: b64(c) };
}
function open(key: Uint8Array, box: SealedBox, ad: string): Uint8Array {
  return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, unb64(box.c), ad, unb64(box.n), key);
}

type KeyPair = { publicKey: Uint8Array; privateKey: Uint8Array };

interface User {
  sign: KeyPair;
  box: KeyPair;
  trialId: string;
  token: string;
  accountId: string;
}

async function call<T = Record<string, unknown>>(method: string, url: string, body?: unknown, token?: string): Promise<{ status: number; json: T }> {
  const r = await app.inject({ method: method as never, url, payload: body as never, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, json: (r.body ? JSON.parse(r.body) : null) as T };
}

async function newUser(): Promise<User> {
  const sign = s.crypto_sign_keypair();
  const box = s.crypto_box_keypair();
  const trialId = `trial-${crypto.randomUUID()}`;
  const signPk = b64(sign.publicKey);
  const boxPk = b64(box.publicKey);
  const signature = b64(s.crypto_sign_detached(registerMessage(signPk, boxPk, `trial:${trialId}`), sign.privateKey));
  const reg = await call<{ accountId: string }>('POST', '/v1/accounts', { signPk, boxPk, signature, trialId });
  expect(reg.status).toBe(200);
  const { json: ch } = await call<{ challenge: string }>('POST', '/v1/auth/challenge', { signPk });
  const sess = await call<{ token: string; accountId: string }>('POST', '/v1/auth/session', {
    signPk,
    challenge: ch.challenge,
    signature: b64(s.crypto_sign_detached(authMessage(ch.challenge), sign.privateKey)),
  });
  expect(sess.status).toBe(200);
  return { sign, box, trialId, token: sess.json.token, accountId: sess.json.accountId };
}

const MARKER = 'Polis-segreta-dei-filosofi';

async function newPolis(owner: User, name = MARKER) {
  const id = crypto.randomUUID();
  const key = s.crypto_aead_xchacha20poly1305_ietf_keygen();
  const r = await call('POST', '/v1/polis', {
    id,
    meta: seal(key, JSON.stringify({ name }), AD.polisMeta(id), 1),
    sealed: b64(s.crypto_box_seal(key, owner.box.publicKey)),
    profile: seal(key, JSON.stringify({ name: 'Pericle' }), AD.profile(id, owner.accountId), 1),
  }, owner.token);
  expect(r.status).toBe(200);
  return { id, key };
}

async function invite(owner: User, polisId: string, key: Uint8Array, epoch: number, role = 'polites') {
  const id = crypto.randomUUID();
  const secret = s.crypto_aead_xchacha20poly1305_ietf_keygen();
  const r = await call('POST', `/v1/polis/${polisId}/invites`, { id, role, key: seal(secret, key, AD.invite(id), epoch), hours: 24, uses: 1 }, owner.token);
  return { status: r.status, id, secret };
}

async function accept(user: User, inviteId: string, secret: Uint8Array) {
  const { json: inv } = await call<{ polisId: string; key: SealedBox }>('GET', `/v1/invites/${inviteId}`, undefined, user.token);
  const key = open(secret, inv.key, AD.invite(inviteId));
  const r = await call('POST', `/v1/invites/${inviteId}/accept`, {
    sealed: b64(s.crypto_box_seal(key, user.box.publicKey)),
    profile: seal(key, JSON.stringify({ name: 'Aspasia' }), AD.profile(inv.polisId, user.accountId), inv.key.e),
  }, user.token);
  return { status: r.status, key };
}

beforeAll(async () => {
  await _sodium.ready;
  s = _sodium;
  const admin = postgres(BASE, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`drop database if exists ${TEST_DB} with (force)`);
  await admin.unsafe(`create database ${TEST_DB}`);
  await admin.end();
  sql = postgres(BASE.replace(/\/[^/]+$/, `/${TEST_DB}`), { max: 5, onnotice: () => undefined });
  await migrate(sql);
  app = await buildApp({ port: 0, databaseUrl: BASE, allowTrial: true }, sql);
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
});

describe('account e accesso', () => {
  it('registrazione e sessione con la firma della chiave', async () => {
    const u = await newUser();
    expect(u.token.length).toBeGreaterThan(20);
    const me = await call('GET', '/v1/polis', undefined, u.token);
    expect(me.status).toBe(200);
  });

  it('firma sbagliata, sfida riusata, nessuna sessione: rifiutati', async () => {
    const u = await newUser();
    const signPk = b64(u.sign.publicKey);
    const { json: ch } = await call<{ challenge: string }>('POST', '/v1/auth/challenge', { signPk });
    const other = s.crypto_sign_keypair();
    const wrong = await call('POST', '/v1/auth/session', { signPk, challenge: ch.challenge, signature: b64(s.crypto_sign_detached(authMessage(ch.challenge), other.privateKey)) });
    expect(wrong.status).toBe(401);
    // la sfida e' gia' stata consumata
    const reused = await call('POST', '/v1/auth/session', { signPk, challenge: ch.challenge, signature: b64(s.crypto_sign_detached(authMessage(ch.challenge), u.sign.privateKey)) });
    expect(reused.status).toBe(401);
    expect((await call('GET', '/v1/polis')).status).toBe(401);
    expect((await call('GET', '/v1/polis', undefined, 'x'.repeat(43))).status).toBe(401);
  });

  it('stesso account d\'accesso: stesse chiavi ok (nuovo dispositivo), chiavi diverse no', async () => {
    const u = await newUser();
    const signPk = b64(u.sign.publicKey);
    const boxPk = b64(u.box.publicKey);
    const again = await call('POST', '/v1/accounts', { signPk, boxPk, trialId: u.trialId, signature: b64(s.crypto_sign_detached(registerMessage(signPk, boxPk, `trial:${u.trialId}`), u.sign.privateKey)) });
    expect(again.status).toBe(200);
    const k2 = s.crypto_sign_keypair();
    const sp2 = b64(k2.publicKey);
    const clash = await call('POST', '/v1/accounts', { signPk: sp2, boxPk, trialId: u.trialId, signature: b64(s.crypto_sign_detached(registerMessage(sp2, boxPk, `trial:${u.trialId}`), k2.privateKey)) });
    expect(clash.status).toBe(409);
    const look = await call<{ signPk: string }>('POST', '/v1/accounts/lookup', { trialId: u.trialId });
    expect(look.json.signPk).toBe(signPk);
  });
});

describe('nulla in locale: sblocco e preferenze dal server', () => {
  it('la chiave avvolta dalla passkey e le preferenze cifrate tornano a chi ha l\'accesso; il server non le apre', async () => {
    const u = await newUser();
    const wrapped = { v: 1, kind: 'passkey', nonce: b64(s.randombytes_buf(24)), ct: b64(s.randombytes_buf(48)) };
    const cred = b64(s.randombytes_buf(32));
    expect((await call('PUT', `/v1/me/passkeys/${cred}`, { salt: b64(s.randombytes_buf(32)), wrapped })).status).toBe(401);
    expect((await call('PUT', `/v1/me/passkeys/${cred}`, { salt: b64(s.randombytes_buf(32)), wrapped }, u.token)).status).toBe(200);
    expect((await call('PUT', `/v1/me/passkeys/${cred}`, { salt: 'x', wrapped: { v: 1, kind: 'altro' } }, u.token)).status).toBe(400);
    const prefsKey = s.crypto_aead_xchacha20poly1305_ietf_keygen();
    expect((await call('PUT', '/v1/me/prefs', { prefs: seal(prefsKey, JSON.stringify({ theme: 'dark' }), AD.prefs(u.accountId), 1) }, u.token)).status).toBe(200);
    const look = await call<{ passkeys: { credentialId: string; wrapped: unknown }[]; prefs: SealedBox }>('POST', '/v1/accounts/lookup', { trialId: u.trialId });
    expect(look.json.passkeys).toHaveLength(1);
    expect(look.json.passkeys[0].wrapped).toEqual(wrapped);
    expect(JSON.parse(s.to_string(open(prefsKey, look.json.prefs, AD.prefs(u.accountId)))).theme).toBe('dark');
    expect((await call('DELETE', `/v1/me/passkeys/${cred}`, undefined, u.token)).status).toBe(200);
    expect((await call<{ passkeys: unknown[] }>('POST', '/v1/accounts/lookup', { trialId: u.trialId })).json.passkeys).toHaveLength(0);
  });
});

describe('Polis, inviti, ruoli', () => {
  it('l\'Archon fonda una Polis; chi non e\' membro non la vede', async () => {
    const a = await newUser();
    const x = await newUser();
    const { id, key } = await newPolis(a);
    const list = await call<{ id: string; meta: SealedBox }[]>('GET', '/v1/polis', undefined, a.token);
    expect(list.json.map((p) => p.id)).toContain(id);
    expect(JSON.parse(s.to_string(open(key, list.json.find((p) => p.id === id)!.meta, AD.polisMeta(id)))).name).toBe(MARKER);
    expect((await call('GET', `/v1/polis/${id}`, undefined, x.token)).status).toBe(404);
  });

  it('invito: solo l\'Archon invita; chi accetta riceve la chiave e il ruolo; l\'invito si consuma', async () => {
    const a = await newUser();
    const b = await newUser();
    const c = await newUser();
    const { id, key } = await newPolis(a);
    const inv = await invite(a, id, key, 1, 'polites');
    expect(inv.status).toBe(200);
    const acc = await accept(b, inv.id, inv.secret);
    expect(acc.status).toBe(200);
    expect(acc.key).toEqual(key);
    const detail = await call<PolisDetail>('GET', `/v1/polis/${id}`, undefined, b.token);
    expect(detail.json.role).toBe('polites');
    expect(detail.json.invites).toEqual([]); // solo l'Archon li vede
    expect(s.crypto_box_seal_open(unb64(detail.json.myKeys[0].sealed), b.box.publicKey, b.box.privateKey)).toEqual(key);
    // invito da un Polites: no; invito gia' usato: non c'e' piu'
    expect((await invite(b, id, key, 1)).status).toBe(403);
    expect((await call('GET', `/v1/invites/${inv.id}`, undefined, c.token)).status).toBe(404);
  });

  it('Mentore e Xenos non creano Oikos; Polites si', async () => {
    const a = await newUser();
    const m = await newUser();
    const { id, key } = await newPolis(a);
    const inv = await invite(a, id, key, 1, 'mentore');
    await accept(m, inv.id, inv.secret);
    const oikosId = crypto.randomUUID();
    const oikosKey = s.crypto_aead_xchacha20poly1305_ietf_keygen();
    const body = { id: oikosId, meta: seal(oikosKey, JSON.stringify({ name: 'Simposio' }), AD.oikosMeta(oikosId), 1), key: seal(key, oikosKey, AD.oikosKey(oikosId, 1), 1) };
    expect((await call('POST', `/v1/polis/${id}/oikos`, body, m.token)).status).toBe(403);
    expect((await call('POST', `/v1/polis/${id}/oikos`, body, a.token)).status).toBe(200);
    const d = await call<PolisDetail>('GET', `/v1/polis/${id}`, undefined, m.token);
    expect(d.json.oikos).toHaveLength(1);
    expect(open(key, d.json.oikos[0].keys[0].wrapped, AD.oikosKey(oikosId, 1))).toEqual(oikosKey);
  });

  it('non si puo\' togliere l\'ultimo Archon', async () => {
    const a = await newUser();
    const { id } = await newPolis(a);
    expect((await call('PATCH', `/v1/polis/${id}/members/${a.accountId}`, { role: 'polites' }, a.token)).status).toBe(409);
  });
});

describe('rotazione delle chiavi', () => {
  it('chi esce non riceve la chiave nuova; gli altri si; gli Oikos ruotano; gli inviti decadono', async () => {
    const a = await newUser();
    const b = await newUser();
    const c = await newUser();
    const { id, key } = await newPolis(a);
    for (const u of [b, c]) {
      const inv = await invite(a, id, key, 1);
      await accept(u, inv.id, inv.secret);
    }
    const oikosId = crypto.randomUUID();
    const oikosKey = s.crypto_aead_xchacha20poly1305_ietf_keygen();
    await call('POST', `/v1/polis/${id}/oikos`, { id: oikosId, meta: seal(oikosKey, '{}', AD.oikosMeta(oikosId), 1), key: seal(key, oikosKey, AD.oikosKey(oikosId, 1), 1) }, a.token);
    const pending = await invite(a, id, key, 1);

    // b se ne va (allontanato dall'Archon)
    expect((await call('DELETE', `/v1/polis/${id}/members/${b.accountId}`, undefined, a.token)).status).toBe(200);
    let d = (await call<PolisDetail>('GET', `/v1/polis/${id}`, undefined, a.token)).json;
    expect(d.rotationNeeded).toBe(true);
    expect(d.invites).toEqual([]);
    expect((await call('GET', `/v1/invites/${pending.id}`, undefined, c.token)).status).toBe(404);
    expect((await call('GET', `/v1/polis/${id}`, undefined, b.token)).status).toBe(404);
    // finche' non si ruota, niente inviti nuovi
    expect((await invite(a, id, key, 1)).status).toBe(409);

    const key2 = s.crypto_aead_xchacha20poly1305_ietf_keygen();
    const oikosKey2 = s.crypto_aead_xchacha20poly1305_ietf_keygen();
    const rotation = (members: User[]) => ({
      epoch: 2,
      envelopes: members.map((u) => ({ accountId: u.accountId, sealed: b64(s.crypto_box_seal(key2, u.box.publicKey)) })),
      prev: seal(key2, key, AD.keyChain(id, 2), 2),
      oikos: [{ oikosId, key: seal(key2, oikosKey2, AD.oikosKey(oikosId, 2), 2) }],
      meta: seal(key2, JSON.stringify({ name: MARKER }), AD.polisMeta(id), 2),
    });
    // includere chi e' uscito: rifiutato
    expect((await call('POST', `/v1/polis/${id}/rotate`, rotation([a, b, c]), a.token)).status).toBe(409);
    // un Polites non governa
    expect((await call('POST', `/v1/polis/${id}/rotate`, rotation([a, c]), c.token)).status).toBe(403);
    expect((await call('POST', `/v1/polis/${id}/rotate`, rotation([a, c]), a.token)).status).toBe(200);

    d = (await call<PolisDetail>('GET', `/v1/polis/${id}`, undefined, c.token)).json;
    expect(d.epoch).toBe(2);
    expect(d.rotationNeeded).toBe(false);
    // c ha la chiave nuova e, dalla catena, risale alla vecchia
    const cKey2 = s.crypto_box_seal_open(unb64(d.myKeys.find((k) => k.epoch === 2)!.sealed), c.box.publicKey, c.box.privateKey);
    expect(cKey2).toEqual(key2);
    expect(open(cKey2, d.chain.find((x) => x.epoch === 2)!.prev, AD.keyChain(id, 2))).toEqual(key);
    expect(d.oikos[0].epoch).toBe(2);
    expect(open(cKey2, d.oikos[0].keys.find((k) => k.epoch === 2)!.wrapped, AD.oikosKey(oikosId, 2))).toEqual(oikosKey2);
    // per b nessuna busta dell'epoca 2
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from polis_keys where polis_id = ${id} and account_id = ${b.accountId}`;
    expect(n).toBe(0);
  });
});

describe('il server non vede contenuti in chiaro', () => {
  it('nessun nome di Polis, Oikos o profilo in chiaro in tutto il database', async () => {
    const a = await newUser();
    await newPolis(a, MARKER);
    const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
    for (const { tablename } of tables) {
      const rows = await sql.unsafe(`select * from ${tablename}`);
      const dump = JSON.stringify(rows);
      expect(dump.includes(MARKER), tablename).toBe(false);
      expect(dump.includes('Pericle'), tablename).toBe(false);
      expect(dump.includes('Aspasia'), tablename).toBe(false);
    }
  });
});

describe('relay del collegamento', () => {
  it('messaggio lasciato e poi ritirato, una volta sola', async () => {
    const ch = b64(s.randombytes_buf(16));
    expect((await call('POST', `/v1/link/${ch}`, { message: 'cifrato' })).status).toBe(200);
    expect((await call<{ message: string }>('GET', `/v1/link/${ch}`)).json.message).toBe('cifrato');
  });
  it('attesa lunga: chi aspetta riceve appena arriva', async () => {
    const ch = b64(s.randombytes_buf(16));
    const waiting = call<{ message: string }>('GET', `/v1/link/${ch}`);
    await new Promise((r) => setTimeout(r, 50));
    await call('POST', `/v1/link/${ch}`, { message: 'ciao' });
    expect((await waiting).json.message).toBe('ciao');
  });
});
