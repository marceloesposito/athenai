// Chiavi dell'utente. Dalla frase di recupero (128 bit) si deriva una chiave principale e da questa,
// con contesti separati, le coppie di chiavi dell'identita':
//   X25519 (cifrare verso l'utente: consegna delle chiavi degli Oikos) e Ed25519 (firmare).
// La chiave principale non si salva mai in chiaro: sul dispositivo resta solo "avvolta"
// (cifrata) da una passkey (estensione PRF) o da una chiave del dispositivo non esportabile.
import { sodium, toB64, fromB64, type Sodium } from './sodium';

const KDF_CONTEXT = 'athenai_'; // 8 byte, richiesti da crypto_kdf
const SUBKEY = { box: 1, sign: 2, prefs: 3 } as const;

export interface PublicIdentity {
  /** X25519, base64url */
  box: string;
  /** Ed25519, base64url */
  sign: string;
}

export interface Identity {
  master: Uint8Array;
  box: { publicKey: Uint8Array; privateKey: Uint8Array };
  sign: { publicKey: Uint8Array; privateKey: Uint8Array };
}

/** Chiave principale (32 byte) dai 16 byte della frase di recupero. */
export async function masterFromEntropy(entropy: Uint8Array): Promise<Uint8Array> {
  const s = await sodium();
  if (entropy.length !== 16) throw new Error('entropy');
  return s.crypto_generichash(32, entropy, s.from_string('athenai:master:v1'));
}

export async function identityFromMaster(master: Uint8Array): Promise<Identity> {
  const s = await sodium();
  if (master.length !== 32) throw new Error('master');
  const boxSeed = s.crypto_kdf_derive_from_key(32, SUBKEY.box, KDF_CONTEXT, master);
  const signSeed = s.crypto_kdf_derive_from_key(32, SUBKEY.sign, KDF_CONTEXT, master);
  const box = s.crypto_box_seed_keypair(boxSeed);
  const sign = s.crypto_sign_seed_keypair(signSeed);
  return { master, box: { publicKey: box.publicKey, privateKey: box.privateKey }, sign: { publicKey: sign.publicKey, privateKey: sign.privateKey } };
}

/** Chiave delle preferenze dell'utente (cifrate sul server). */
export async function prefsKey(master: Uint8Array): Promise<Uint8Array> {
  const s = await sodium();
  return s.crypto_kdf_derive_from_key(32, SUBKEY.prefs, KDF_CONTEXT, master);
}

export async function publicIdentity(id: Identity): Promise<PublicIdentity> {
  const s = await sodium();
  return { box: toB64(s, id.box.publicKey), sign: toB64(s, id.sign.publicKey) };
}

export function sameIdentity(a: PublicIdentity, b: PublicIdentity): boolean {
  return a.box === b.box && a.sign === b.sign;
}

/**
 * Impronta dell'identita' da confrontare a voce o di persona (come i numeri di sicurezza di Signal):
 * 8 gruppi di 4 cifre.
 */
export async function fingerprint(pub: PublicIdentity): Promise<string> {
  const s = await sodium();
  const h = s.crypto_generichash(20, s.from_string(`athenai:fp:v1:${pub.sign}:${pub.box}`), null);
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    const n = ((h[i * 2] << 8) | h[i * 2 + 1]) % 10000;
    groups.push(String(n).padStart(4, '0'));
  }
  return groups.join(' ');
}

// ---------------------------------------------------------------- avvolgimento della chiave principale

export type WrapKind = 'passkey' | 'device';

/** Chiave principale cifrata (XChaCha20-Poly1305); `kind` entra nei dati autenticati. */
export interface WrappedKey {
  v: 1;
  kind: WrapKind;
  nonce: string;
  ct: string;
}

function ad(s: Sodium, kind: WrapKind): Uint8Array {
  return s.from_string(`athenai:wrap:v1:${kind}`);
}

/** Da un segreto qualunque (es. l'uscita PRF di una passkey) a una chiave d'avvolgimento di 32 byte. */
export async function wrappingKeyFrom(secret: Uint8Array, kind: WrapKind): Promise<Uint8Array> {
  const s = await sodium();
  return s.crypto_generichash(32, secret, s.from_string(`athenai:wrapkey:v1:${kind}`));
}

export async function wrapMaster(master: Uint8Array, key: Uint8Array, kind: WrapKind): Promise<WrappedKey> {
  const s = await sodium();
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = s.crypto_aead_xchacha20poly1305_ietf_encrypt(master, ad(s, kind), null, nonce, key);
  return { v: 1, kind, nonce: toB64(s, nonce), ct: toB64(s, ct) };
}

/** null se la chiave e' sbagliata o i dati sono stati alterati. */
export async function unwrapMaster(w: WrappedKey, key: Uint8Array): Promise<Uint8Array | null> {
  const s = await sodium();
  try {
    return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, fromB64(s, w.ct), ad(s, w.kind), fromB64(s, w.nonce), key);
  } catch {
    return null;
  }
}

/** Per cancellare dalla memoria le chiavi che non servono piu'. */
export async function wipe(...buffers: Uint8Array[]) {
  const s = await sodium();
  for (const b of buffers) s.memzero(b);
}
