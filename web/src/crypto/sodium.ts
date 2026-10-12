// libsodium (versione "sumo": serve crypto_pwhash / Argon2id). Si carica una volta sola.
import _sodium from 'libsodium-wrappers-sumo';

export type Sodium = typeof _sodium;

let ready: Promise<Sodium> | null = null;

export function sodium(): Promise<Sodium> {
  return (ready ??= _sodium.ready.then(() => _sodium));
}

export function toB64(s: Sodium, bytes: Uint8Array): string {
  return s.to_base64(bytes, s.base64_variants.URLSAFE_NO_PADDING);
}

export function fromB64(s: Sodium, text: string): Uint8Array {
  return s.from_base64(text, s.base64_variants.URLSAFE_NO_PADDING);
}
