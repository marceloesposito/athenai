// Collegare un nuovo dispositivo senza frase di recupero (come WhatsApp Web, ma cifrato).
//  1. Il dispositivo nuovo crea una coppia di chiavi usa e getta e mostra un codice (QR o testo)
//     con la chiave pubblica e un canale casuale.
//  2. Quello gia' collegato legge il codice *dallo schermo* (mai dal server), lo conferma e
//     cifra la chiave principale verso quella chiave pubblica (sealed box).
//  3. Il relay (server) trasporta solo il messaggio cifrato sul canale; il dispositivo nuovo lo
//     apre e controlla che l'identita' ottenuta sia quella dell'account.
// Il codice di verifica (6 cifre) mostrato su entrambi gli schermi conferma che si e' letto il
// dispositivo giusto.
import { sodium, toB64, fromB64 } from './sodium';

const PREFIX = 'ath1-';

export interface LinkRequest {
  code: string;
  channel: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export async function createLinkRequest(): Promise<LinkRequest> {
  const s = await sodium();
  const kp = s.crypto_box_keypair();
  const channel = s.randombytes_buf(16);
  const payload = new Uint8Array(48);
  payload.set(channel, 0);
  payload.set(kp.publicKey, 16);
  return { code: PREFIX + toB64(s, payload), channel: toB64(s, channel), publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** Il codice letto dall'altro dispositivo; null se non e' un codice di Athenai. */
export async function parseLinkCode(code: string): Promise<{ channel: string; publicKey: Uint8Array } | null> {
  const s = await sodium();
  const c = code.trim();
  if (!c.startsWith(PREFIX)) return null;
  try {
    const raw = fromB64(s, c.slice(PREFIX.length));
    if (raw.length !== 48) return null;
    return { channel: toB64(s, raw.slice(0, 16)), publicKey: raw.slice(16) };
  } catch {
    return null;
  }
}

/** 6 cifre da confrontare sui due schermi. */
export async function verificationCode(publicKey: Uint8Array): Promise<string> {
  const s = await sodium();
  const h = s.crypto_generichash(8, publicKey, s.from_string('athenai:link:v1'));
  const n = (((h[0] << 24) >>> 0) + (h[1] << 16) + (h[2] << 8) + h[3]) % 1_000_000;
  const d = String(n).padStart(6, '0');
  return `${d.slice(0, 3)} ${d.slice(3)}`;
}

/** Sul dispositivo gia' collegato: la chiave principale cifrata per il nuovo. */
export async function sealMasterFor(master: Uint8Array, publicKey: Uint8Array): Promise<string> {
  const s = await sodium();
  return toB64(s, s.crypto_box_seal(master, publicKey));
}

/** Sul dispositivo nuovo; null se il messaggio non e' per lui o e' stato alterato. */
export async function openLinkedMaster(sealed: string, req: LinkRequest): Promise<Uint8Array | null> {
  const s = await sodium();
  try {
    const m = s.crypto_box_seal_open(fromB64(s, sealed), req.publicKey, req.privateKey);
    return m.length === 32 ? m : null;
  } catch {
    return null;
  }
}

/** Trasporto dei messaggi cifrati fra i due dispositivi (server o, in locale, BroadcastChannel). */
export interface LinkRelay {
  send(channel: string, message: string): Promise<void>;
  /** attende il primo messaggio sul canale; si annulla con il segnale */
  receive(channel: string, signal?: AbortSignal): Promise<string>;
}
