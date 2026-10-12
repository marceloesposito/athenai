// Cifratura dei Tomos (lato client). Ogni voce del registro e' una busta XChaCha20-Poly1305 con la
// chiave dell'Oikos dell'epoca indicata, legata (AD) a Tomos, flusso, tipo e autore, e firmata
// dall'autore con Ed25519: chi legge verifica la firma con la chiave pubblica del membro prima di
// aprirla. La presenza (cursori) viaggia cifrata allo stesso modo, ma senza firma: e' effimera e il
// server la attribuisce alla connessione autenticata. Le notifiche Keryx sono sealed box verso il
// destinatario, con dentro la firma del mittente.
import { AD, logMessage, keryxMessage, type SealedBox, type Stream, type EntryKind, type LogEntry, type KeryxNotice } from '@athenai/protocol';
import { sodium, toB64, fromB64 } from './sodium';
import { sealBox, openBox, sealJson, openJson } from './polis';
import type { Identity } from './keys';

/** chiavi di un Oikos per epoca */
export type EpochKeys = Map<number, Uint8Array>;

export interface SignedBox {
  box: SealedBox;
  sig: string;
}

export async function sealEntry(
  key: Uint8Array,
  epoch: number,
  tomosId: string,
  stream: Stream,
  kind: EntryKind,
  author: string,
  data: Uint8Array,
  signSk: Uint8Array,
): Promise<SignedBox> {
  const s = await sodium();
  const box = await sealBox(key, data, AD.tomosLog(tomosId, stream, kind, author), epoch);
  return { box, sig: toB64(s, s.crypto_sign_detached(logMessage(tomosId, stream, kind, box), signSk)) };
}

/**
 * Apre una voce: firma valida dell'autore dichiarato, poi la busta con la chiave della sua epoca.
 * null se manca la chiave, la firma non torna o la busta e' stata alterata o spostata.
 */
export async function openEntry(tomosId: string, e: LogEntry, keys: EpochKeys, signPkOf: (accountId: string) => string | undefined): Promise<Uint8Array | null> {
  const s = await sodium();
  // la chiave del membro, se lo e' ancora; altrimenti quella che il server ricorda dell'autore
  const pk = signPkOf(e.author) ?? (e.authorPk || undefined);
  const key = keys.get(e.box.e);
  if (!pk || !key) return null;
  try {
    if (!s.crypto_sign_verify_detached(fromB64(s, e.sig), logMessage(tomosId, e.stream, e.kind, e.box), fromB64(s, pk))) return null;
  } catch {
    return null;
  }
  return openBox(key, e.box, AD.tomosLog(tomosId, e.stream, e.kind, e.author));
}

export const sealAwareness = (key: Uint8Array, epoch: number, tomosId: string, accountId: string, update: Uint8Array) => sealBox(key, update, AD.awareness(tomosId, accountId), epoch);

/** `from` e' l'account a cui il server attribuisce la connessione: se non coincide, la busta non si apre. */
export const openAwareness = (keys: EpochKeys, tomosId: string, from: string, box: SealedBox) => {
  const key = keys.get(box.e);
  return key ? openBox(key, box, AD.awareness(tomosId, from)) : Promise.resolve(null);
};

export interface TomosMeta {
  title: string;
}

export const sealTomosMeta = (key: Uint8Array, epoch: number, tomosId: string, meta: TomosMeta) => sealJson(key, meta, AD.tomosMeta(tomosId), epoch);
export const openTomosMeta = (keys: EpochKeys, tomosId: string, box: SealedBox) => openJson<TomosMeta>(keys.get(box.e), box, AD.tomosMeta(tomosId));

// ---------------------------------------------------------------- Keryx

export async function sealNotice(notice: KeryxNotice, to: { accountId: string; boxPk: string }, signSk: Uint8Array): Promise<string> {
  const s = await sodium();
  const payload = JSON.stringify(notice);
  const sig = toB64(s, s.crypto_sign_detached(keryxMessage(to.accountId, payload), signSk));
  return toB64(s, s.crypto_box_seal(JSON.stringify({ payload, sig }), fromB64(s, to.boxPk)));
}

/**
 * Apre una notifica per me: firma del mittente dichiarato (membro della Polis indicata), legata a me
 * come destinatario. La chiave del mittente si cerca fra i membri di quella Polis.
 */
export async function openNotice(
  sealed: string,
  me: Identity,
  myAccountId: string,
  signPkOf: (polisId: string, accountId: string) => Promise<string | undefined> | string | undefined,
): Promise<KeryxNotice | null> {
  const s = await sodium();
  try {
    const raw = s.crypto_box_seal_open(fromB64(s, sealed), me.box.publicKey, me.box.privateKey);
    const { payload, sig } = JSON.parse(s.to_string(raw)) as { payload: string; sig: string };
    const notice = JSON.parse(payload) as KeryxNotice;
    const pk = await signPkOf(notice.polisId, notice.from);
    if (!pk || !s.crypto_sign_verify_detached(fromB64(s, sig), keryxMessage(myAccountId, payload), fromB64(s, pk))) return null;
    return notice;
  } catch {
    return null;
  }
}
