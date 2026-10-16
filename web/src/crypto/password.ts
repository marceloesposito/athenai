// Account con email e password, senza che la password lasci il browser (modello Bitwarden/Proton).
// Argon2id(password, sale) da' 64 byte: i primi 32 sono la chiave d'accesso (va al server, che ne
// salva solo l'hash), gli altri 32 avvolgono la chiave principale (resta qui). Il codice di recupero
// facoltativo (120 bit casuali) fa lo stesso senza Argon2: e' gia' abbastanza lungo.
import { AD, KDF_DEFAULT, type KdfParams, type SealedBox } from '@athenai/protocol';
import { sodium, toB64, fromB64 } from './sodium';
import { sealBox, openBox } from './polis';

export interface PasswordKeys {
  /** va al server */
  authKey: string;
  /** non lascia mai il browser */
  wrapKey: Uint8Array;
}

export async function newKdf(params: { ops: number; mem: number } = KDF_DEFAULT): Promise<KdfParams> {
  const s = await sodium();
  return { salt: toB64(s, s.randombytes_buf(s.crypto_pwhash_SALTBYTES)), ...params };
}

export async function passwordKeys(password: string, kdf: KdfParams): Promise<PasswordKeys> {
  const s = await sodium();
  const out = s.crypto_pwhash(64, password.normalize('NFC'), fromB64(s, kdf.salt), kdf.ops, kdf.mem, s.crypto_pwhash_ALG_ARGON2ID13);
  const keys = { authKey: toB64(s, out.slice(0, 32)), wrapKey: out.slice(32) };
  s.memzero(out);
  return keys;
}

/** Una chiave principale nuova (32 byte casuali): da qui nasce l'identita' (keys.ts). */
export async function newMaster(): Promise<Uint8Array> {
  const s = await sodium();
  return s.randombytes_buf(32);
}

export const wrapMasterWith = (wrapKey: Uint8Array, master: Uint8Array, kind: 'password' | 'recovery'): Promise<SealedBox> => sealBox(wrapKey, master, AD.masterWrap(kind), 1);

/** null se la chiave e' sbagliata (password o codice errati) o i dati sono alterati. */
export const unwrapMasterWith = (wrapKey: Uint8Array, box: SealedBox, kind: 'password' | 'recovery') => openBox(wrapKey, box, AD.masterWrap(kind));

// ---------------------------------------------------------------- codice di recupero

/** Alfabeto di Crockford: niente I, L, O, U (si confondono con 1 e 0). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 24 caratteri (120 bit) in gruppi di 4: "7KQ2-…". */
export async function newRecoveryCode(): Promise<string> {
  const s = await sodium();
  const bytes = s.randombytes_buf(15);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join('-');
}

/** Il codice come lo scrive una persona: maiuscole, senza trattini e spazi, O→0, I/L→1. */
export function normalizeRecoveryCode(code: string): string | null {
  const c = code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return c.length === 24 && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}

export async function recoveryKeys(code: string): Promise<{ recoveryAuth: string; wrapKey: Uint8Array } | null> {
  const c = normalizeRecoveryCode(code);
  if (!c) return null;
  const s = await sodium();
  const auth = s.crypto_generichash(32, s.from_string(c), s.from_string('athenai:recovery-auth:v1'));
  const wrapKey = s.crypto_generichash(32, s.from_string(c), s.from_string('athenai:recovery-wrap:v1'));
  return { recoveryAuth: toB64(s, auth), wrapKey };
}

// ---------------------------------------------------------------- robustezza della password

/** 0 (debole) … 4 (ottima): lunghezza e varieta', con un elenco di password note da evitare. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (pw.length < 10) return 0;
  const common = /^(password|passw0rd|qwerty|123456|abc123|letmein|iloveyou|admin|welcome|athenai)/i;
  if (common.test(pw)) return 1;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const score = (pw.length >= 14 ? 2 : 1) + (kinds >= 3 ? 1 : 0) + (pw.length >= 20 || (kinds === 4 && pw.length >= 12) ? 1 : 0);
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}
