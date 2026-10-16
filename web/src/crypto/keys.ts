// Chiavi dell'utente. Dalla chiave principale (32 byte casuali, avvolta dalla password: vedi
// password.ts) si derivano, con contesti separati, le coppie di chiavi dell'identita':
//   X25519 (cifrare verso l'utente: consegna delle chiavi di Polis e Symposia) e Ed25519 (firmare).
// La chiave principale in chiaro esiste solo in memoria, mentre l'utente e' dentro.
import { sodium, toB64 } from './sodium';

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

export async function identityFromMaster(master: Uint8Array): Promise<Identity> {
  const s = await sodium();
  if (master.length !== 32) throw new Error('master');
  const boxSeed = s.crypto_kdf_derive_from_key(32, SUBKEY.box, KDF_CONTEXT, master);
  const signSeed = s.crypto_kdf_derive_from_key(32, SUBKEY.sign, KDF_CONTEXT, master);
  const box = s.crypto_box_seed_keypair(boxSeed);
  const sign = s.crypto_sign_seed_keypair(signSeed);
  return { master, box: { publicKey: box.publicKey, privateKey: box.privateKey }, sign: { publicKey: sign.publicKey, privateKey: sign.privateKey } };
}

/** Identita' usa e getta (gli ospiti): solo chiavi, nessuna chiave principale. */
export async function ephemeralIdentity(): Promise<Identity> {
  const s = await sodium();
  return identityFromMaster(s.randombytes_buf(32));
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

/** Per cancellare dalla memoria le chiavi che non servono piu'. */
export async function wipe(...buffers: Uint8Array[]) {
  const s = await sodium();
  for (const b of buffers) s.memzero(b);
}
