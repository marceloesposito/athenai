// Il server verifica solo firme Ed25519 (libsodium) e calcola hash: non ha chiavi segrete degli utenti.
import _sodium from 'libsodium-wrappers-sumo';
import { createHash, randomBytes } from 'node:crypto';

let ready: Promise<typeof _sodium> | null = null;
const sodium = () => (ready ??= _sodium.ready.then(() => _sodium));

export async function verifySignature(message: string, signatureB64: string, publicKeyB64: string): Promise<boolean> {
  const s = await sodium();
  try {
    const v = s.base64_variants.URLSAFE_NO_PADDING;
    return s.crypto_sign_verify_detached(s.from_base64(signatureB64, v), s.from_string(message), s.from_base64(publicKeyB64, v));
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
