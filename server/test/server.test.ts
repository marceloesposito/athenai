// Test d'integrazione del server con Postgres vero (deploy/compose.yml, servizio postgres) e un client
// simulato che fa la crittografia come l'app: chiavi libsodium, firme, buste cifrate.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import _sodium from 'libsodium-wrappers-sumo';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import { authMessage, registerMessage, logMessage, AD, type SealedBox, type PolisDetail, type Stream, type EntryKind, type ServerMessage, type TomosView, type LogEntry, type KeryxItem } from '@athenai/protocol';
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

// ---------------------------------------------------------------- P3: Tomos, tempo reale, Keryx

const SECRET_TEXT = 'Testo-segreto-del-Tomos';

async function newOikos(owner: User, polisId: string, polisKey: Uint8Array, epoch = 1) {
  const id = crypto.randomUUID();
  const key = s.crypto_aead_xchacha20poly1305_ietf_keygen();
  const r = await call('POST', `/v1/polis/${polisId}/oikos`, { id, meta: seal(key, '{}', AD.oikosMeta(id), 1), key: seal(polisKey, key, AD.oikosKey(id, 1), epoch) }, owner.token);
  expect(r.status).toBe(200);
  return { id, key };
}

async function newTomos(u: User, oikosId: string, key: Uint8Array, epoch = 1) {
  const id = crypto.randomUUID();
  const r = await call('POST', `/v1/oikos/${oikosId}/tomos`, { id, meta: seal(key, JSON.stringify({ title: SECRET_TEXT }), AD.tomosMeta(id), epoch) }, u.token);
  return { id, status: r.status };
}

function entry(u: User, key: Uint8Array, tomosId: string, stream: Stream, kind: EntryKind, data: string, epoch = 1) {
  const box = seal(key, data, AD.tomosLog(tomosId, stream, kind, u.accountId), epoch);
  return { box, sig: b64(s.crypto_sign_detached(logMessage(tomosId, stream, kind, box), u.sign.privateKey)) };
}

/** Una connessione /v1/live con la coda dei messaggi ricevuti. */
async function live(u: User) {
  const ws = await app.injectWS('/v1/live');
  const inbox: ServerMessage[] = [];
  ws.on('message', (d: Buffer) => inbox.push(JSON.parse(String(d))));
  const next = async <T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 3000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = inbox.findIndex((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
      if (i >= 0) return inbox.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>;
      if (Date.now() > deadline) throw new Error(`nessun messaggio ${t}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const send = (m: object) => ws.send(JSON.stringify(m));
  send({ t: 'auth', token: u.token });
  await next('ready');
  return { ws, inbox, next, send };
}

async function polisWith(roles: string[]) {
  const a = await newUser();
  const { id, key } = await newPolis(a);
  const others: User[] = [];
  for (const role of roles) {
    const u = await newUser();
    const inv = await invite(a, id, key, 1, role);
    await accept(u, inv.id, inv.secret);
    others.push(u);
  }
  const oikos = await newOikos(a, id, key);
  return { a, others, polisId: id, polisKey: key, oikos };
}

describe('Tomos', () => {
  it('Polites crea, Mentore e Xenos no; chi non e\' membro non vede nulla; epoca vecchia rifiutata', async () => {
    const { a, others: [p, m, x], oikos } = await polisWith(['polites', 'mentore', 'xenos']);
    const outsider = await newUser();
    expect((await newTomos(p, oikos.id, oikos.key)).status).toBe(200);
    expect((await newTomos(m, oikos.id, oikos.key)).status).toBe(403);
    expect((await newTomos(x, oikos.id, oikos.key)).status).toBe(403);
    expect((await newTomos(outsider, oikos.id, oikos.key)).status).toBe(404);
    expect((await newTomos(a, oikos.id, oikos.key, 2)).status).toBe(409);
    const list = await call<TomosView[]>('GET', `/v1/oikos/${oikos.id}/tomos`, undefined, x.token);
    expect(list.json).toHaveLength(1);
    expect(JSON.parse(s.to_string(open(oikos.key, list.json[0].meta, AD.tomosMeta(list.json[0].id)))).title).toBe(SECRET_TEXT);
    expect((await call('GET', `/v1/oikos/${oikos.id}/tomos`, undefined, outsider.token)).status).toBe(404);
    expect((await call('DELETE', `/v1/tomos/${list.json[0].id}`, undefined, x.token)).status).toBe(403);
    expect((await call('DELETE', `/v1/tomos/${list.json[0].id}`, undefined, p.token)).status).toBe(200);
  });
});

describe('tempo reale', () => {
  it('modifiche firmate inoltrate agli altri; firme false e ruoli sbagliati rifiutati', async () => {
    const { a, others: [m, x], oikos } = await polisWith(['mentore', 'xenos']);
    const t = await newTomos(a, oikos.id, oikos.key);
    const la = await live(a);
    const lm = await live(m);
    const lx = await live(x);
    for (const l of [la, lm, lx]) {
      l.send({ t: 'sub', tomosId: t.id });
      expect((await l.next('log')).entries).toEqual([]);
    }
    la.send({ t: 'push', ref: 1, tomosId: t.id, stream: 'text', kind: 'update', ...entry(a, oikos.key, t.id, 'text', 'update', SECRET_TEXT) });
    expect((await la.next('ack')).ref).toBe(1);
    const got = await lx.next('entry');
    expect(got.entry.author).toBe(a.accountId);
    expect(s.to_string(open(oikos.key, got.entry.box, AD.tomosLog(t.id, 'text', 'update', a.accountId)))).toBe(SECRET_TEXT);
    // il Mentore non scrive nel testo, ma negli Scholia si'
    lm.send({ t: 'push', ref: 2, tomosId: t.id, stream: 'text', kind: 'update', ...entry(m, oikos.key, t.id, 'text', 'update', 'x') });
    expect((await lm.next('err')).error).toBe('forbidden');
    lm.send({ t: 'push', ref: 3, tomosId: t.id, stream: 'scholia', kind: 'update', ...entry(m, oikos.key, t.id, 'scholia', 'update', 'nota') });
    expect((await lm.next('ack')).ref).toBe(3);
    // lo Xenos legge soltanto
    lx.send({ t: 'push', ref: 4, tomosId: t.id, stream: 'scholia', kind: 'update', ...entry(x, oikos.key, t.id, 'scholia', 'update', 'x') });
    expect((await lx.next('err')).error).toBe('forbidden');
    // una voce firmata da altri (il Mentore che si spaccia per l'Archon) non passa
    const forged = entry(a, oikos.key, t.id, 'scholia', 'update', 'x');
    lm.send({ t: 'push', ref: 5, tomosId: t.id, stream: 'scholia', kind: 'update', box: forged.box, sig: forged.sig });
    expect((await lm.next('err')).error).toBe('bad-signature');
    // presenza: arriva agli altri con l'id della connessione, e sparisce quando si chiude
    lm.send({ t: 'aw', tomosId: t.id, box: seal(oikos.key, 'cursore', AD.awareness(t.id, m.accountId), 1) });
    const aw = await la.next('aw', (x) => x.box !== null);
    expect(aw.from).toBe(m.accountId);
    lm.ws.terminate();
    expect((await la.next('aw', (x) => x.cid === aw.cid && x.box === null)).from).toBe(m.accountId);
    for (const l of [la, lx]) l.ws.close();
  });

  it('uno stato intero sostituisce le voci che copre', async () => {
    const { a, oikos } = await polisWith([]);
    const t = await newTomos(a, oikos.id, oikos.key);
    const la = await live(a);
    la.send({ t: 'sub', tomosId: t.id });
    await la.next('log');
    const seqs: number[] = [];
    for (let i = 1; i <= 3; i++) {
      la.send({ t: 'push', ref: i, tomosId: t.id, stream: 'text', kind: 'update', ...entry(a, oikos.key, t.id, 'text', 'update', `u${i}`) });
      seqs.push((await la.next('ack', (m) => m.ref === i)).seq);
    }
    la.send({ t: 'push', ref: 9, tomosId: t.id, stream: 'scholia', kind: 'update', ...entry(a, oikos.key, t.id, 'scholia', 'update', 's') });
    await la.next('ack', (m) => m.ref === 9);
    la.send({ t: 'push', ref: 10, tomosId: t.id, stream: 'text', kind: 'snapshot', covers: seqs[1], ...entry(a, oikos.key, t.id, 'text', 'snapshot', 'u1+u2') });
    await la.next('ack', (m) => m.ref === 10);
    const log = (await call<LogEntry[]>('GET', `/v1/tomos/${t.id}/log`, undefined, a.token)).json;
    // restano: la terza modifica, lo Scholion e lo stato intero
    expect(log.map((e) => `${e.stream}:${e.kind}`)).toEqual(['text:update', 'scholia:update', 'text:snapshot']);
    expect(log[0].seq).toBe(seqs[2]);
    la.ws.close();
  });

  it('avvisi della Polis al posto del ricaricamento; chi esce smette di ricevere; dopo la rotazione serve la chiave nuova', async () => {
    const { a, others: [b], polisId, polisKey, oikos } = await polisWith(['polites']);
    const t = await newTomos(a, oikos.id, oikos.key);
    const la = await live(a);
    const lb = await live(b);
    lb.send({ t: 'sub', tomosId: t.id });
    await lb.next('log');
    // un Oikos nuovo: tutti i membri lo sanno subito
    await newOikos(a, polisId, polisKey);
    expect((await lb.next('polis')).polisId).toBe(polisId);
    await la.next('polis');
    // b viene allontanato: riceve l'avviso e non riceve piu' le modifiche
    expect((await call('DELETE', `/v1/polis/${polisId}/members/${b.accountId}`, undefined, a.token)).status).toBe(200);
    await lb.next('polis');
    la.send({ t: 'push', ref: 1, tomosId: t.id, stream: 'text', kind: 'update', ...entry(a, oikos.key, t.id, 'text', 'update', 'dopo') });
    await la.next('ack');
    await expect(lb.next('entry', () => true, 300)).rejects.toThrow();
    lb.send({ t: 'sub', tomosId: t.id });
    expect((await lb.next('err')).error).toBe('not-found');
    // rotazione: l'Oikos passa all'epoca 2 e le voci con la chiave vecchia sono rifiutate
    const key2 = s.crypto_aead_xchacha20poly1305_ietf_keygen();
    const d = (await call<PolisDetail>('GET', `/v1/polis/${polisId}`, undefined, a.token)).json;
    const rot = await call('POST', `/v1/polis/${polisId}/rotate`, {
      epoch: 2,
      envelopes: [{ accountId: a.accountId, sealed: b64(s.crypto_box_seal(key2, a.box.publicKey)) }],
      prev: seal(key2, polisKey, AD.keyChain(polisId, 2), 2),
      oikos: d.oikos.map((o) => ({ oikosId: o.id, key: seal(key2, s.crypto_aead_xchacha20poly1305_ietf_keygen(), AD.oikosKey(o.id, 2), 2) })),
      meta: seal(key2, '{}', AD.polisMeta(polisId), 2),
    }, a.token);
    expect(rot.status).toBe(200);
    la.send({ t: 'push', ref: 2, tomosId: t.id, stream: 'text', kind: 'update', ...entry(a, oikos.key, t.id, 'text', 'update', 'vecchia') });
    expect((await la.next('err', (m) => m.ref === 2)).error).toBe('stale-key');
    la.ws.close();
    lb.ws.close();
  });

  it('senza autenticazione la connessione si chiude', async () => {
    const ws = await app.injectWS('/v1/live');
    const closed = new Promise<number>((r) => ws.on('close', (code: number) => r(code)));
    ws.send(JSON.stringify({ t: 'sub', tomosId: crypto.randomUUID() }));
    expect(await closed).toBe(4401);
  });
});

describe('Keryx', () => {
  it('notifica cifrata solo verso membri; il destinatario la riceve subito e la cancella', async () => {
    const { a, others: [b], polisId } = await polisWith(['polites']);
    const outsider = await newUser();
    const lb = await live(b);
    const sealed = b64(s.crypto_box_seal(SECRET_TEXT, b.box.publicKey));
    expect((await call('POST', `/v1/polis/${polisId}/keryx`, { to: [{ accountId: outsider.accountId, sealed }] }, a.token)).status).toBe(400);
    expect((await call('POST', `/v1/polis/${polisId}/keryx`, { to: [{ accountId: b.accountId, sealed }] }, outsider.token)).status).toBe(404);
    expect((await call('POST', `/v1/polis/${polisId}/keryx`, { to: [{ accountId: b.accountId, sealed }] }, a.token)).status).toBe(200);
    await lb.next('keryx');
    const list = (await call<KeryxItem[]>('GET', '/v1/me/keryx', undefined, b.token)).json;
    expect(list).toHaveLength(1);
    expect(s.to_string(s.crypto_box_seal_open(unb64(list[0].sealed), b.box.publicKey, b.box.privateKey))).toBe(SECRET_TEXT);
    expect((await call<KeryxItem[]>('GET', '/v1/me/keryx', undefined, a.token)).json).toHaveLength(0);
    await call('DELETE', `/v1/me/keryx/${list[0].id}`, undefined, b.token);
    expect((await call<KeryxItem[]>('GET', '/v1/me/keryx', undefined, b.token)).json).toHaveLength(0);
    lb.ws.close();
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
      expect(dump.includes(SECRET_TEXT), tablename).toBe(false);
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
