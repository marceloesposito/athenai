// Test d'integrazione del server con Postgres vero (deploy/compose.yml, servizio postgres) e un client
// simulato che fa la crittografia come l'app: chiavi libsodium, firme, buste cifrate.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import _sodium from 'libsodium-wrappers-sumo';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import {
  authMessage,
  registerMessage,
  logMessage,
  AD,
  GUEST_NAMES,
  type SealedBox,
  type PolisDetail,
  type Stream,
  type EntryKind,
  type ServerMessage,
  type DocumentView,
  type LogEntry,
  type NoticeItem,
  type GuestLinkDetail,
  type GuestContext,
  type SessionResponse,
} from '@athenai/protocol';
import { buildApp } from '../src/app.ts';
import { migrate, type Sql } from '../src/db.ts';

const BASE = process.env.DATABASE_URL_TEST ?? 'postgres://athenai:athenai-dev@127.0.0.1:55432/athenai';
const TEST_DB = 'athenai_test';
const KDF = { ops: 3, mem: 64 * 1024 * 1024 };
let s: typeof _sodium;
let sql: Sql;
let app: FastifyInstance;

const b64 = (b: Uint8Array) => s.to_base64(b, s.base64_variants.URLSAFE_NO_PADDING);
const unb64 = (t: string) => s.from_base64(t, s.base64_variants.URLSAFE_NO_PADDING);
const key = () => s.crypto_aead_xchacha20poly1305_ietf_keygen();

function seal(k: Uint8Array, plaintext: string | Uint8Array, ad: string, epoch: number): SealedBox {
  const n = s.randombytes_buf(24);
  const c = s.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, ad, null, n, k);
  return { v: 1, e: epoch, n: b64(n), c: b64(c) };
}
function open(k: Uint8Array, box: SealedBox, ad: string): Uint8Array {
  return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, unb64(box.c), ad, unb64(box.n), k);
}

type KeyPair = { publicKey: Uint8Array; privateKey: Uint8Array };

/** Account o ospite: chi firma e con quale token. */
interface Who {
  id: string;
  sign: KeyPair;
  box: KeyPair;
  token: string;
}
interface User extends Who {
  email: string;
  authKey: string;
}

async function call<T = Record<string, unknown>>(method: string, url: string, body?: unknown, token?: string): Promise<{ status: number; json: T }> {
  const r = await app.inject({ method: method as never, url, payload: body as never, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, json: (r.body ? JSON.parse(r.body) : null) as T };
}

function registerBody(email: string) {
  const sign = s.crypto_sign_keypair();
  const box = s.crypto_box_keypair();
  const signPk = b64(sign.publicKey);
  const boxPk = b64(box.publicKey);
  return {
    sign,
    box,
    body: {
      email,
      authKey: b64(s.randombytes_buf(32)),
      kdf: { salt: b64(s.randombytes_buf(16)), ...KDF },
      wrapped: seal(key(), s.randombytes_buf(32), AD.masterWrap('password'), 1),
      signPk,
      boxPk,
      signature: b64(s.crypto_sign_detached(registerMessage(signPk, boxPk, email), sign.privateKey)),
    },
  };
}

async function newUser(email = `${crypto.randomUUID()}@atene.gr`): Promise<User> {
  const { sign, box, body } = registerBody(email);
  const r = await call<SessionResponse>('POST', '/v1/auth/register', body);
  expect(r.status).toBe(200);
  return { id: r.json.account.accountId, sign, box, token: r.json.token, email, authKey: body.authKey };
}

const MARKER = 'Polis-segreta-dei-filosofi';
const SECRET_TEXT = 'Testo-segreto-del-documento';

async function newPolis(owner: User, name = MARKER) {
  const id = crypto.randomUUID();
  const k = key();
  const r = await call('POST', '/v1/polis', {
    id,
    meta: seal(k, JSON.stringify({ name }), AD.polisMeta(id), 1),
    sealed: b64(s.crypto_box_seal(k, owner.box.publicKey)),
    profile: seal(k, JSON.stringify({ name: 'Profilo-segreto-Archon' }), AD.profile(id, owner.id), 1),
  }, owner.token);
  expect(r.status).toBe(200);
  return { id, key: k };
}

async function invite(owner: User, polisId: string, k: Uint8Array, epoch: number) {
  const id = crypto.randomUUID();
  const secret = key();
  const r = await call('POST', `/v1/polis/${polisId}/invites`, { id, key: seal(secret, k, AD.invite(id), epoch), hours: 24, uses: 1 }, owner.token);
  return { status: r.status, id, secret };
}

async function accept(user: User, inviteId: string, secret: Uint8Array) {
  const { json: inv } = await call<{ polisId: string; key: SealedBox }>('GET', `/v1/invites/${inviteId}`, undefined, user.token);
  const k = open(secret, inv.key, AD.invite(inviteId));
  const r = await call('POST', `/v1/invites/${inviteId}/accept`, {
    sealed: b64(s.crypto_box_seal(k, user.box.publicKey)),
    profile: seal(k, JSON.stringify({ name: 'Profilo-segreto-Polites' }), AD.profile(inv.polisId, user.id), inv.key.e),
  }, user.token);
  return { status: r.status, key: k };
}

async function newSymposion(owner: User, polisId: string, polisKey: Uint8Array, epoch = 1) {
  const id = crypto.randomUUID();
  const k = key();
  const r = await call('POST', `/v1/polis/${polisId}/symposia`, { id, meta: seal(k, '{}', AD.symposionMeta(id), 1), key: seal(polisKey, k, AD.symposionKey(id, 1), epoch) }, owner.token);
  return { id, key: k, status: r.status };
}

async function newDocument(u: Who, symposionId: string, k: Uint8Array, epoch = 1) {
  const id = crypto.randomUUID();
  const r = await call('POST', `/v1/symposia/${symposionId}/documents`, { id, meta: seal(k, JSON.stringify({ title: SECRET_TEXT }), AD.docMeta(id), epoch) }, u.token);
  return { id, status: r.status };
}

function entry(u: Who, k: Uint8Array, documentId: string, stream: Stream, kind: EntryKind, data: string, epoch = 1) {
  const box = seal(k, data, AD.docLog(documentId, stream, kind, u.id), epoch);
  return { box, sig: b64(s.crypto_sign_detached(logMessage(documentId, stream, kind, box), u.sign.privateKey)) };
}

/** Una connessione /v1/live con la coda dei messaggi ricevuti. */
async function live(u: Who) {
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

async function polisWith(n: number) {
  const a = await newUser();
  const { id, key: k } = await newPolis(a);
  const others: User[] = [];
  for (let i = 0; i < n; i++) {
    const u = await newUser();
    const inv = await invite(a, id, k, 1);
    await accept(u, inv.id, inv.secret);
    others.push(u);
  }
  const symposion = await newSymposion(a, id, k);
  return { a, others, polisId: id, polisKey: k, symposion };
}

/** Link per gli ospiti e ingresso di un ospite con chiavi usa e getta. */
async function guestLink(owner: User, symposionId: string, symposionKey: Uint8Array, mode: 'edit' | 'comment', epoch = 1) {
  const id = crypto.randomUUID();
  const secret = key();
  const r = await call('POST', `/v1/symposia/${symposionId}/links`, {
    id,
    mode,
    key: seal(secret, JSON.stringify({ [epoch]: b64(symposionKey) }), AD.guestLink(id), epoch),
    meta: seal(secret, JSON.stringify({ name: 'Simposio' }), AD.guestLink(id), epoch),
    hours: 24,
  }, owner.token);
  return { id, secret, status: r.status };
}

async function joinGuest(linkId: string): Promise<Who & { name: string }> {
  const sign = s.crypto_sign_keypair();
  const box = s.crypto_box_keypair();
  const r = await call<{ token: string; guestId: string; name: string }>('POST', `/v1/links/${linkId}/join`, { signPk: b64(sign.publicKey), boxPk: b64(box.publicKey) });
  expect(r.status).toBe(200);
  return { id: r.json.guestId, sign, box, token: r.json.token, name: r.json.name };
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
  app = await buildApp({ port: 0, databaseUrl: BASE, allowSignup: true, secret: 'segreto-di-prova' }, sql);
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
});

describe('account con email e password', () => {
  it('registrazione, parametri della password, accesso; email gia\' usata e firma sbagliata rifiutate', async () => {
    const u = await newUser('Saffo@Lesbo.gr');
    const [row] = await sql<{ email: string; kdf: { salt: string } }[]>`select email, kdf from accounts where id = ${u.id}`;
    expect(row.email).toBe('saffo@lesbo.gr');
    const pre = await call<{ kdf: { salt: string } }>('POST', '/v1/auth/prelogin', { email: ' saffo@lesbo.GR ' });
    expect(pre.json.kdf.salt).toBe(row.kdf.salt);
    const ok = await call<SessionResponse>('POST', '/v1/auth/login', { email: 'saffo@lesbo.gr', authKey: u.authKey });
    expect(ok.status).toBe(200);
    expect(ok.json.account.wrapped).toBeTruthy();
    expect((await call('GET', '/v1/me', undefined, ok.json.token)).status).toBe(200);
    expect((await call('POST', '/v1/auth/register', registerBody('saffo@lesbo.gr').body)).status).toBe(409);
    // firma fatta per un'altra email
    expect((await call('POST', '/v1/auth/register', { ...registerBody('x@y.zz').body, email: 'altra@y.zz' })).status).toBe(400);
  });

  it('il server non rivela se un\'email esiste; i tentativi sbagliati si fermano', async () => {
    const u = await newUser();
    const ghost = 'nessuno@atene.gr';
    const p1 = await call<{ kdf: { salt: string } }>('POST', '/v1/auth/prelogin', { email: ghost });
    const p2 = await call<{ kdf: { salt: string } }>('POST', '/v1/auth/prelogin', { email: ghost });
    expect(p1.status).toBe(200);
    expect(p1.json.kdf.salt).toBe(p2.json.kdf.salt); // finti ma stabili
    const wrong = await call<{ error: string }>('POST', '/v1/auth/login', { email: u.email, authKey: b64(s.randombytes_buf(32)) });
    const unknown = await call<{ error: string }>('POST', '/v1/auth/login', { email: ghost, authKey: b64(s.randombytes_buf(32)) });
    expect([wrong.status, wrong.json.error]).toEqual([401, 'bad-credentials']);
    expect([unknown.status, unknown.json.error]).toEqual([401, 'bad-credentials']);
    for (let i = 0; i < 10; i++) await call('POST', '/v1/auth/login', { email: u.email, authKey: b64(s.randombytes_buf(32)) });
    expect((await call('POST', '/v1/auth/login', { email: u.email, authKey: u.authKey })).status).toBe(429);
  });

  it('cambio della password: le altre sessioni si chiudono; codice di recupero; "resta connesso" con la firma', async () => {
    const u = await newUser();
    const other = (await call<SessionResponse>('POST', '/v1/auth/login', { email: u.email, authKey: u.authKey })).json.token;
    const newAuth = b64(s.randombytes_buf(32));
    const wrapped = seal(key(), s.randombytes_buf(32), AD.masterWrap('password'), 1);
    expect((await call('PUT', '/v1/me/password', { authKey: newAuth, kdf: { salt: b64(s.randombytes_buf(16)), ...KDF }, wrapped }, u.token)).status).toBe(200);
    expect((await call('GET', '/v1/me', undefined, other)).status).toBe(401);
    expect((await call('GET', '/v1/me', undefined, u.token)).status).toBe(200);
    expect((await call('POST', '/v1/auth/login', { email: u.email, authKey: u.authKey })).status).toBe(401);
    expect((await call('POST', '/v1/auth/login', { email: u.email, authKey: newAuth })).status).toBe(200);
    const recoveryAuth = b64(s.randombytes_buf(32));
    const recWrapped = seal(key(), s.randombytes_buf(32), AD.masterWrap('recovery'), 1);
    expect((await call('PUT', '/v1/me/recovery', { recoveryAuth, wrapped: recWrapped }, u.token)).status).toBe(200);
    expect((await call<{ hasRecovery: boolean }>('GET', '/v1/me', undefined, u.token)).json.hasRecovery).toBe(true);
    const rec = await call<{ recoveryWrapped: SealedBox }>('POST', '/v1/auth/recover', { email: u.email, recoveryAuth });
    expect(rec.json.recoveryWrapped).toEqual(recWrapped);
    expect((await call('POST', '/v1/auth/recover', { email: u.email, recoveryAuth: b64(s.randombytes_buf(32)) })).status).toBe(401);
    const signPk = b64(u.sign.publicKey);
    const { json: ch } = await call<{ challenge: string }>('POST', '/v1/auth/challenge', { signPk });
    const sess = await call<SessionResponse>('POST', '/v1/auth/session', { signPk, challenge: ch.challenge, signature: b64(s.crypto_sign_detached(authMessage(ch.challenge), u.sign.privateKey)) });
    expect(sess.json.account.accountId).toBe(u.id);
    // la sfida vale una volta sola
    expect((await call('POST', '/v1/auth/session', { signPk, challenge: ch.challenge, signature: b64(s.crypto_sign_detached(authMessage(ch.challenge), u.sign.privateKey)) })).status).toBe(401);
  });
});

describe('Polis, inviti, ruoli', () => {
  it('l\'Archon fonda una Polis; chi non e\' membro non la vede; chi accetta l\'invito e\' Polites', async () => {
    const a = await newUser();
    const b = await newUser();
    const x = await newUser();
    const { id, key: k } = await newPolis(a);
    expect((await call('GET', `/v1/polis/${id}`, undefined, x.token)).status).toBe(404);
    const inv = await invite(a, id, k, 1);
    expect(inv.status).toBe(200);
    expect((await accept(b, inv.id, inv.secret)).key).toEqual(k);
    const d = (await call<PolisDetail>('GET', `/v1/polis/${id}`, undefined, b.token)).json;
    expect(d.role).toBe('polites');
    expect(d.invites).toEqual([]);
    expect((await invite(b, id, k, 1)).status).toBe(403);
    expect((await newSymposion(b, id, k)).status).toBe(403);
    expect((await newSymposion(a, id, k)).status).toBe(200);
    expect((await call('GET', `/v1/invites/${inv.id}`, undefined, x.token)).status).toBe(404);
    expect((await call('PATCH', `/v1/polis/${id}/members/${a.id}`, { role: 'polites' }, a.token)).status).toBe(409);
    expect((await call('PATCH', `/v1/polis/${id}/members/${b.id}`, { role: 'mentore' }, a.token)).status).toBe(400);
  });

  it('rotazione: chi esce non riceve la chiave nuova; i Symposia ruotano; inviti e link decadono', async () => {
    const { a, others: [b, c], polisId, polisKey, symposion } = await polisWith(2);
    const link = await guestLink(a, symposion.id, symposion.key, 'edit');
    expect(link.status).toBe(200);
    expect((await call('DELETE', `/v1/polis/${polisId}/members/${b.id}`, undefined, a.token)).status).toBe(200);
    let d = (await call<PolisDetail>('GET', `/v1/polis/${polisId}`, undefined, a.token)).json;
    expect(d.rotationNeeded).toBe(true);
    expect(d.links).toEqual([]);
    expect((await call('GET', `/v1/links/${link.id}`)).status).toBe(404);
    const key2 = key();
    const sk2 = key();
    const rotation = (members: User[]) => ({
      epoch: 2,
      envelopes: members.map((u) => ({ accountId: u.id, sealed: b64(s.crypto_box_seal(key2, u.box.publicKey)) })),
      prev: seal(key2, polisKey, AD.keyChain(polisId, 2), 2),
      symposia: [{ symposionId: symposion.id, key: seal(key2, sk2, AD.symposionKey(symposion.id, 2), 2) }],
      meta: seal(key2, JSON.stringify({ name: MARKER }), AD.polisMeta(polisId), 2),
    });
    expect((await call('POST', `/v1/polis/${polisId}/rotate`, rotation([a, b, c]), a.token)).status).toBe(409);
    expect((await call('POST', `/v1/polis/${polisId}/rotate`, rotation([a, c]), c.token)).status).toBe(403);
    expect((await call('POST', `/v1/polis/${polisId}/rotate`, rotation([a, c]), a.token)).status).toBe(200);
    d = (await call<PolisDetail>('GET', `/v1/polis/${polisId}`, undefined, c.token)).json;
    expect(d.epoch).toBe(2);
    expect(d.symposia[0].epoch).toBe(2);
    const cKey2 = s.crypto_box_seal_open(unb64(d.myKeys.find((k) => k.epoch === 2)!.sealed), c.box.publicKey, c.box.privateKey);
    expect(open(cKey2, d.chain.find((x) => x.epoch === 2)!.prev, AD.keyChain(polisId, 2))).toEqual(polisKey);
    expect(open(cKey2, d.symposia[0].keys.find((k) => k.epoch === 2)!.wrapped, AD.symposionKey(symposion.id, 2))).toEqual(sk2);
  });
});

describe('documenti', () => {
  it('i Politai creano; chi non e\' membro non vede nulla; epoca vecchia rifiutata', async () => {
    const { a, others: [p], symposion } = await polisWith(1);
    const outsider = await newUser();
    expect((await newDocument(p, symposion.id, symposion.key)).status).toBe(200);
    expect((await newDocument(outsider, symposion.id, symposion.key)).status).toBe(404);
    expect((await newDocument(a, symposion.id, symposion.key, 2)).status).toBe(409);
    const list = await call<DocumentView[]>('GET', `/v1/symposia/${symposion.id}/documents`, undefined, a.token);
    expect(list.json).toHaveLength(1);
    expect(JSON.parse(s.to_string(open(symposion.key, list.json[0].meta, AD.docMeta(list.json[0].id)))).title).toBe(SECRET_TEXT);
    expect((await call('GET', `/v1/symposia/${symposion.id}/documents`, undefined, outsider.token)).status).toBe(404);
    expect((await call('DELETE', `/v1/documents/${list.json[0].id}`, undefined, p.token)).status).toBe(200);
  });
});

describe('ospiti (Xenoi)', () => {
  it('link: solo l\'Archon lo crea; si legge senza account; ogni ospite ha un nome greco diverso', async () => {
    const { a, others: [p], polisId, symposion } = await polisWith(1);
    expect((await guestLink(p, symposion.id, symposion.key, 'edit')).status).toBe(403);
    const link = await guestLink(a, symposion.id, symposion.key, 'edit');
    const detail = await call<GuestLinkDetail>('GET', `/v1/links/${link.id}`);
    expect(detail.json.mode).toBe('edit');
    expect(JSON.parse(s.to_string(open(link.secret, detail.json.key, AD.guestLink(link.id))))['1']).toBe(b64(symposion.key));
    const g1 = await joinGuest(link.id);
    const g2 = await joinGuest(link.id);
    expect(GUEST_NAMES).toContain(g1.name as never);
    expect(g1.name).not.toBe(g2.name);
    const ctx = (await call<GuestContext>('GET', '/v1/guest/me', undefined, g1.token)).json;
    expect(ctx.symposionId).toBe(symposion.id);
    expect(ctx.people.map((x) => x.id)).toEqual(expect.arrayContaining([a.id, p.id, g2.id]));
    const d = (await call<PolisDetail>('GET', `/v1/polis/${polisId}`, undefined, a.token)).json;
    expect(d.guests.map((g) => g.name).sort()).toEqual([g1.name, g2.name].sort());
    // un ospite non entra nelle rotte della Polis
    expect((await call('GET', `/v1/polis/${polisId}`, undefined, g1.token)).status).toBe(401);
  });

  it('"puo\' modificare" scrive nel testo; "puo\' commentare" solo nei commenti; mai in altri Symposia', async () => {
    const { a, polisId, polisKey, symposion } = await polisWith(0);
    const other = await newSymposion(a, polisId, polisKey);
    const doc = await newDocument(a, symposion.id, symposion.key);
    const otherDoc = await newDocument(a, other.id, other.key);
    const editor = await joinGuest((await guestLink(a, symposion.id, symposion.key, 'edit')).id);
    const commenter = await joinGuest((await guestLink(a, symposion.id, symposion.key, 'comment')).id);
    expect((await newDocument(editor, symposion.id, symposion.key)).status).toBe(200);
    expect((await newDocument(commenter, symposion.id, symposion.key)).status).toBe(403);
    expect((await call('GET', `/v1/symposia/${other.id}/documents`, undefined, editor.token)).status).toBe(404);
    const le = await live(editor);
    const lc = await live(commenter);
    const la = await live(a);
    la.send({ t: 'sub', documentId: doc.id });
    await la.next('log');
    le.send({ t: 'push', ref: 1, documentId: doc.id, stream: 'text', kind: 'update', ...entry(editor, symposion.key, doc.id, 'text', 'update', 'ospite') });
    expect((await le.next('ack')).ref).toBe(1);
    const got = await la.next('entry');
    expect(got.entry.author).toBe(editor.id);
    expect(got.entry.authorPk).toBe(b64(editor.sign.publicKey));
    lc.send({ t: 'push', ref: 2, documentId: doc.id, stream: 'text', kind: 'update', ...entry(commenter, symposion.key, doc.id, 'text', 'update', 'x') });
    expect((await lc.next('err')).error).toBe('forbidden');
    lc.send({ t: 'push', ref: 3, documentId: doc.id, stream: 'scholia', kind: 'update', ...entry(commenter, symposion.key, doc.id, 'scholia', 'update', 'nota') });
    expect((await lc.next('ack')).ref).toBe(3);
    le.send({ t: 'sub', documentId: otherDoc.id });
    expect((await le.next('err')).error).toBe('not-found');
    const log = (await call<LogEntry[]>('GET', `/v1/documents/${doc.id}/log`, undefined, a.token)).json;
    expect(log.find((e) => e.author === editor.id)?.authorPk).toBe(b64(editor.sign.publicKey));
    for (const l of [le, lc, la]) l.ws.terminate();
  });

  it('revoca del link: gli ospiti escono subito, la chiave va ruotata, quello che hanno scritto resta verificabile', async () => {
    const { a, polisId, symposion } = await polisWith(0);
    const doc = await newDocument(a, symposion.id, symposion.key);
    const link = await guestLink(a, symposion.id, symposion.key, 'edit');
    const g = await joinGuest(link.id);
    const lg = await live(g);
    lg.send({ t: 'push', ref: 1, documentId: doc.id, stream: 'text', kind: 'update', ...entry(g, symposion.key, doc.id, 'text', 'update', 'ospite') });
    await lg.next('ack');
    const closed = new Promise<number>((r) => lg.ws.on('close', (code: number) => r(code)));
    expect((await call('DELETE', `/v1/links/${link.id}`, undefined, a.token)).status).toBe(200);
    expect(await closed).toBe(4401);
    expect((await call('GET', '/v1/guest/me', undefined, g.token)).status).toBe(401);
    const d = (await call<PolisDetail>('GET', `/v1/polis/${polisId}`, undefined, a.token)).json;
    expect(d.rotationNeeded).toBe(true);
    expect(d.guests).toEqual([]);
    const log = (await call<LogEntry[]>('GET', `/v1/documents/${doc.id}/log`, undefined, a.token)).json;
    expect(log[0].authorPk).toBe(b64(g.sign.publicKey));
  });
});

describe('tempo reale', () => {
  it('modifiche firmate inoltrate agli altri; firme false rifiutate; presenza', async () => {
    const { a, others: [m], symposion } = await polisWith(1);
    const t = await newDocument(a, symposion.id, symposion.key);
    const la = await live(a);
    const lm = await live(m);
    for (const l of [la, lm]) {
      l.send({ t: 'sub', documentId: t.id });
      expect((await l.next('log')).entries).toEqual([]);
    }
    la.send({ t: 'push', ref: 1, documentId: t.id, stream: 'text', kind: 'update', ...entry(a, symposion.key, t.id, 'text', 'update', SECRET_TEXT) });
    expect((await la.next('ack')).ref).toBe(1);
    const got = await lm.next('entry');
    expect(s.to_string(open(symposion.key, got.entry.box, AD.docLog(t.id, 'text', 'update', a.id)))).toBe(SECRET_TEXT);
    // m si spaccia per a: la firma non torna
    const forged = entry(a, symposion.key, t.id, 'scholia', 'update', 'x');
    lm.send({ t: 'push', ref: 5, documentId: t.id, stream: 'scholia', kind: 'update', box: forged.box, sig: forged.sig });
    expect((await lm.next('err')).error).toBe('bad-signature');
    lm.send({ t: 'aw', documentId: t.id, box: seal(symposion.key, 'cursore', AD.awareness(t.id, m.id), 1) });
    const aw = await la.next('aw', (x) => x.box !== null);
    expect(aw.from).toBe(m.id);
    lm.ws.terminate();
    expect((await la.next('aw', (x) => x.cid === aw.cid && x.box === null)).from).toBe(m.id);
    la.ws.terminate();
  });

  it('uno stato intero sostituisce le voci che copre', async () => {
    const { a, symposion } = await polisWith(0);
    const t = await newDocument(a, symposion.id, symposion.key);
    const la = await live(a);
    la.send({ t: 'sub', documentId: t.id });
    await la.next('log');
    const seqs: number[] = [];
    for (let i = 1; i <= 3; i++) {
      la.send({ t: 'push', ref: i, documentId: t.id, stream: 'text', kind: 'update', ...entry(a, symposion.key, t.id, 'text', 'update', `u${i}`) });
      seqs.push((await la.next('ack', (m) => m.ref === i)).seq);
    }
    la.send({ t: 'push', ref: 9, documentId: t.id, stream: 'scholia', kind: 'update', ...entry(a, symposion.key, t.id, 'scholia', 'update', 's') });
    await la.next('ack', (m) => m.ref === 9);
    la.send({ t: 'push', ref: 10, documentId: t.id, stream: 'text', kind: 'snapshot', covers: seqs[1], ...entry(a, symposion.key, t.id, 'text', 'snapshot', 'u1+u2') });
    await la.next('ack', (m) => m.ref === 10);
    const log = (await call<LogEntry[]>('GET', `/v1/documents/${t.id}/log`, undefined, a.token)).json;
    expect(log.map((e) => `${e.stream}:${e.kind}`)).toEqual(['text:update', 'scholia:update', 'text:snapshot']);
    expect(log[0].seq).toBe(seqs[2]);
    la.ws.terminate();
  });

  it('avvisi della Polis; chi esce smette di ricevere; dopo la rotazione serve la chiave nuova', async () => {
    const { a, others: [b], polisId, polisKey, symposion } = await polisWith(1);
    const t = await newDocument(a, symposion.id, symposion.key);
    const la = await live(a);
    const lb = await live(b);
    lb.send({ t: 'sub', documentId: t.id });
    await lb.next('log');
    await newSymposion(a, polisId, polisKey);
    expect((await lb.next('polis')).polisId).toBe(polisId);
    await la.next('polis');
    expect((await call('DELETE', `/v1/polis/${polisId}/members/${b.id}`, undefined, a.token)).status).toBe(200);
    await lb.next('polis');
    la.send({ t: 'push', ref: 1, documentId: t.id, stream: 'text', kind: 'update', ...entry(a, symposion.key, t.id, 'text', 'update', 'dopo') });
    await la.next('ack');
    await expect(lb.next('entry', () => true, 300)).rejects.toThrow();
    const key2 = key();
    const d = (await call<PolisDetail>('GET', `/v1/polis/${polisId}`, undefined, a.token)).json;
    const rot = await call('POST', `/v1/polis/${polisId}/rotate`, {
      epoch: 2,
      envelopes: [{ accountId: a.id, sealed: b64(s.crypto_box_seal(key2, a.box.publicKey)) }],
      prev: seal(key2, polisKey, AD.keyChain(polisId, 2), 2),
      symposia: d.symposia.map((o) => ({ symposionId: o.id, key: seal(key2, key(), AD.symposionKey(o.id, 2), 2) })),
      meta: seal(key2, '{}', AD.polisMeta(polisId), 2),
    }, a.token);
    expect(rot.status).toBe(200);
    la.send({ t: 'push', ref: 2, documentId: t.id, stream: 'text', kind: 'update', ...entry(a, symposion.key, t.id, 'text', 'update', 'vecchia') });
    expect((await la.next('err', (m) => m.ref === 2)).error).toBe('stale-key');
    la.ws.terminate();
    lb.ws.terminate();
  });

  it('senza autenticazione la connessione si chiude', async () => {
    const ws = await app.injectWS('/v1/live');
    const closed = new Promise<number>((r) => ws.on('close', (code: number) => r(code)));
    ws.send(JSON.stringify({ t: 'sub', documentId: crypto.randomUUID() }));
    expect(await closed).toBe(4401);
  });
});

describe('notifiche', () => {
  it('cifrate solo verso membri; il destinatario le riceve subito e le cancella', async () => {
    const { a, others: [b], polisId } = await polisWith(1);
    const outsider = await newUser();
    const lb = await live(b);
    const sealed = b64(s.crypto_box_seal(SECRET_TEXT, b.box.publicKey));
    expect((await call('POST', `/v1/polis/${polisId}/notices`, { to: [{ accountId: outsider.id, sealed }] }, a.token)).status).toBe(400);
    expect((await call('POST', `/v1/polis/${polisId}/notices`, { to: [{ accountId: b.id, sealed }] }, outsider.token)).status).toBe(404);
    expect((await call('POST', `/v1/polis/${polisId}/notices`, { to: [{ accountId: b.id, sealed }] }, a.token)).status).toBe(200);
    await lb.next('notice');
    const list = (await call<NoticeItem[]>('GET', '/v1/me/notices', undefined, b.token)).json;
    expect(list).toHaveLength(1);
    expect(s.to_string(s.crypto_box_seal_open(unb64(list[0].sealed), b.box.publicKey, b.box.privateKey))).toBe(SECRET_TEXT);
    await call('DELETE', `/v1/me/notices/${list[0].id}`, undefined, b.token);
    expect((await call<NoticeItem[]>('GET', '/v1/me/notices', undefined, b.token)).json).toHaveLength(0);
    lb.ws.terminate();
  });
});

describe('il server non vede contenuti in chiaro', () => {
  it('nessun nome, titolo, testo o chiave d\'accesso in chiaro in tutto il database', async () => {
    const a = await newUser();
    await newPolis(a, MARKER);
    const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
    for (const { tablename } of tables) {
      const dump = JSON.stringify(await sql.unsafe(`select * from ${tablename}`));
      for (const secret of [MARKER, 'Profilo-segreto-Archon', 'Profilo-segreto-Polites', SECRET_TEXT, a.authKey]) expect(dump.includes(secret), `${tablename}: ${secret}`).toBe(false);
    }
  });
});
