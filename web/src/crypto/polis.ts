// Chiavi di Polis e Symposia (lato client). Una Polis ha una chiave simmetrica per epoca: ogni membro
// la riceve cifrata verso la propria chiave X25519; quando qualcuno esce si passa all'epoca dopo e la
// chiave nuova cifra quella vecchia (catena all'indietro), cosi' chi resta legge anche la storia e
// chi e' uscito non legge il nuovo. Ogni Symposion ha la sua chiave per epoca, cifrata con quella
// della Polis; gli ospiti la ricevono dal frammento del loro link. Nomi e profili viaggiano in buste
// XChaCha20-Poly1305 legate (AD) all'oggetto.
import { AD, inviteLink, guestLink, type SealedBox, type PolisDetail, type GuestMode, type CreatePolisRequest, type CreateInviteRequest, type AcceptInviteRequest, type CreateSymposionRequest, type CreateGuestLinkRequest, type RotateRequest } from '@athenai/protocol';
import { sodium, toB64, fromB64 } from './sodium';
import type { Identity } from './keys';

export async function newKey(): Promise<Uint8Array> {
  const s = await sodium();
  return s.crypto_aead_xchacha20poly1305_ietf_keygen();
}

export async function sealBox(key: Uint8Array, data: Uint8Array | string, ad: string, epoch: number): Promise<SealedBox> {
  const s = await sodium();
  const n = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const c = s.crypto_aead_xchacha20poly1305_ietf_encrypt(data, ad, null, n, key);
  return { v: 1, e: epoch, n: toB64(s, n), c: toB64(s, c) };
}

/** null se la chiave e' sbagliata o la busta e' alterata / spostata su un altro oggetto. */
export async function openBox(key: Uint8Array, box: SealedBox, ad: string): Promise<Uint8Array | null> {
  const s = await sodium();
  try {
    return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, fromB64(s, box.c), ad, fromB64(s, box.n), key);
  } catch {
    return null;
  }
}

export async function sealJson(key: Uint8Array, value: unknown, ad: string, epoch: number) {
  return sealBox(key, JSON.stringify(value), ad, epoch);
}

export async function openJson<T>(key: Uint8Array | undefined, box: SealedBox | null | undefined, ad: string): Promise<T | null> {
  if (!key || !box) return null;
  const raw = await openBox(key, box, ad);
  if (!raw) return null;
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as T;
  } catch {
    return null;
  }
}

export async function sealKeyFor(boxPk: string, key: Uint8Array): Promise<string> {
  const s = await sodium();
  return toB64(s, s.crypto_box_seal(key, fromB64(s, boxPk)));
}

export async function openSealedKey(id: Identity, sealed: string): Promise<Uint8Array | null> {
  const s = await sodium();
  try {
    return s.crypto_box_seal_open(fromB64(s, sealed), id.box.publicKey, id.box.privateKey);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- portachiavi di una Polis

export interface Keyring {
  /** chiave della Polis per epoca */
  polis: Map<number, Uint8Array>;
  /** chiave del Symposion per epoca */
  symposia: Map<string, Map<number, Uint8Array>>;
}

/** Tutte le chiavi che posso aprire: le mie buste, poi la catena all'indietro, poi i Symposia. */
export async function keyring(detail: PolisDetail, id: Identity): Promise<Keyring> {
  const polis = new Map<number, Uint8Array>();
  for (const k of detail.myKeys) {
    const key = await openSealedKey(id, k.sealed);
    if (key) polis.set(k.epoch, key);
  }
  const chain = new Map(detail.chain.map((c) => [c.epoch, c.prev]));
  for (let e = Math.max(0, ...polis.keys()); e >= 2; e--) {
    const cur = polis.get(e);
    const prev = chain.get(e);
    if (cur && prev && !polis.has(e - 1)) {
      const k = await openBox(cur, prev, AD.keyChain(detail.id, e));
      if (k) polis.set(e - 1, k);
    }
  }
  const symposia = new Map<string, Map<number, Uint8Array>>();
  for (const o of detail.symposia) {
    const m = new Map<number, Uint8Array>();
    for (const k of o.keys) {
      const pk = polis.get(k.polisEpoch);
      const key = pk ? await openBox(pk, k.wrapped, AD.symposionKey(o.id, k.epoch)) : null;
      if (key) m.set(k.epoch, key);
    }
    symposia.set(o.id, m);
  }
  return { polis, symposia };
}

export const currentKey = (ring: Keyring, epoch: number) => ring.polis.get(epoch);

// ---------------------------------------------------------------- richieste gia' cifrate

export interface PolisMeta {
  name: string;
}
export interface Profile {
  name: string;
}
export interface SymposionMeta {
  name: string;
}

export async function createPolisRequest(accountId: string, boxPk: string, name: string, profile: Profile): Promise<{ req: CreatePolisRequest; key: Uint8Array }> {
  const polisId = crypto.randomUUID();
  const key = await newKey();
  return {
    key,
    req: {
      id: polisId,
      meta: await sealJson(key, { name } satisfies PolisMeta, AD.polisMeta(polisId), 1),
      sealed: await sealKeyFor(boxPk, key),
      profile: await sealJson(key, profile, AD.profile(polisId, accountId), 1),
    },
  };
}

/** Invito nella Polis: la sua chiave cifrata con un segreto che sta solo nel link (dopo #). */
export async function createInvite(origin: string, key: Uint8Array, epoch: number, hours = 72, uses = 1): Promise<{ req: CreateInviteRequest; link: string }> {
  const s = await sodium();
  const inviteId = crypto.randomUUID();
  const secret = await newKey();
  const req: CreateInviteRequest = { id: inviteId, key: await sealBox(secret, key, AD.invite(inviteId), epoch), hours, uses };
  return { req, link: inviteLink(origin, inviteId, toB64(s, secret)) };
}

/** Apre la chiave dell'invito con il segreto del link e prepara l'adesione. */
export async function acceptInvite(
  inviteId: string,
  secretB64: string,
  invite: { polisId: string; key: SealedBox },
  accountId: string,
  boxPk: string,
  profile: Profile,
): Promise<{ req: AcceptInviteRequest; key: Uint8Array } | null> {
  const s = await sodium();
  let secret: Uint8Array;
  try {
    secret = fromB64(s, secretB64);
  } catch {
    return null;
  }
  const key = await openBox(secret, invite.key, AD.invite(inviteId));
  if (!key) return null;
  return {
    key,
    req: { sealed: await sealKeyFor(boxPk, key), profile: await sealJson(key, profile, AD.profile(invite.polisId, accountId), invite.key.e) },
  };
}

export async function createSymposionRequest(polisKey: Uint8Array, polisEpoch: number, name: string): Promise<{ req: CreateSymposionRequest; key: Uint8Array }> {
  const id = crypto.randomUUID();
  const key = await newKey();
  return {
    key,
    req: {
      id,
      meta: await sealJson(key, { name } satisfies SymposionMeta, AD.symposionMeta(id), 1),
      key: await sealBox(polisKey, key, AD.symposionKey(id, 1), polisEpoch),
    },
  };
}

/**
 * Link per gli ospiti di un Symposion: tutte le sue chiavi (per leggere anche i testi piu' vecchi) e
 * il suo nome, cifrati con un segreto che sta solo nel frammento del link.
 */
export async function createGuestLinkRequest(
  origin: string,
  symposionKeys: Map<number, Uint8Array>,
  epoch: number,
  name: string,
  mode: GuestMode,
  hours = 24 * 7,
): Promise<{ req: CreateGuestLinkRequest; link: string }> {
  const s = await sodium();
  const id = crypto.randomUUID();
  const secret = await newKey();
  const keys = Object.fromEntries([...symposionKeys].map(([e, k]) => [e, toB64(s, k)]));
  return {
    req: { id, mode, hours, key: await sealJson(secret, keys, AD.guestLink(id), epoch), meta: await sealJson(secret, { name }, AD.guestLink(id), epoch) },
    link: guestLink(origin, id, toB64(s, secret)),
  };
}

/** L'ospite apre il link: le chiavi del Symposion per epoca e il suo nome, o null se il segreto e' sbagliato. */
export async function openGuestLink(linkId: string, secretB64: string, key: SealedBox, meta: SealedBox): Promise<{ keys: Map<number, Uint8Array>; name: string } | null> {
  const s = await sodium();
  let secret: Uint8Array;
  try {
    secret = fromB64(s, secretB64);
  } catch {
    return null;
  }
  const raw = await openJson<Record<string, string>>(secret, key, AD.guestLink(linkId));
  const m = await openJson<SymposionMeta>(secret, meta, AD.guestLink(linkId));
  if (!raw || !m) return null;
  return { keys: new Map(Object.entries(raw).map(([e, k]) => [Number(e), fromB64(s, k)])), name: m.name };
}

/** Dopo un'uscita: nuova epoca per la Polis e per ogni Symposion, consegnata ai soli membri rimasti. */
export async function rotationRequest(detail: PolisDetail, ring: Keyring, meta: PolisMeta): Promise<RotateRequest | null> {
  const prev = ring.polis.get(detail.epoch);
  if (!prev) return null;
  const epoch = detail.epoch + 1;
  const next = await newKey();
  return {
    epoch,
    envelopes: await Promise.all(detail.members.map(async (m) => ({ accountId: m.accountId, sealed: await sealKeyFor(m.boxPk, next) }))),
    prev: await sealBox(next, prev, AD.keyChain(detail.id, epoch), epoch),
    symposia: await Promise.all(detail.symposia.map(async (o) => ({ symposionId: o.id, key: await sealBox(next, await newKey(), AD.symposionKey(o.id, o.epoch + 1), epoch) }))),
    meta: await sealJson(next, meta, AD.polisMeta(detail.id), epoch),
  };
}
