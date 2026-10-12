// Protocollo fra l'app e il server di Athenai: ruoli, testi da firmare, formati delle buste cifrate,
// link (inviti e ospiti) e tipi delle API. Solo funzioni pure e tipi: la crittografia sta nel client,
// il server verifica firme e permessi ma non vede mai chiavi segrete o contenuti in chiaro.
// (Solo sintassi "cancellabile": il server lo esegue con il TypeScript nativo di Node.)

export const API_VERSION = 'v1';

// ---------------------------------------------------------------- ruoli

/** Archon: proprietario della Polis. Polites: membro. Xenos: ospite di un Symposion via link. */
export const ROLES = ['archon', 'polites', 'xenos'] as const;
export type Role = (typeof ROLES)[number];
/** i ruoli di chi ha un account nella Polis */
export const MEMBER_ROLES = ['archon', 'polites'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
/** che cosa puo' fare un ospite con il suo link */
export type GuestMode = 'edit' | 'comment';

export function isRole(x: unknown): x is Role {
  return (ROLES as readonly unknown[]).includes(x);
}
export function isMemberRole(x: unknown): x is MemberRole {
  return (MEMBER_ROLES as readonly unknown[]).includes(x);
}
export const isGuestMode = (x: unknown): x is GuestMode => x === 'edit' || x === 'comment';

/** Chi puo' fare cosa. */
export const can = {
  /** invitare, cambiare ruoli, allontanare, creare Symposia, condividere con gli ospiti */
  govern: (r: Role) => r === 'archon',
  /** scrivere nei documenti e crearne */
  write: (r: Role, mode?: GuestMode) => r === 'archon' || r === 'polites' || (r === 'xenos' && mode === 'edit'),
  /** commentare (Scholia): tutti, anche gli ospiti */
  comment: (_r: Role) => true,
};

// ---------------------------------------------------------------- firme

/** Testo firmato per dimostrare di possedere la chiave (accesso con "resta connesso"). */
export const authMessage = (challenge: string) => `athenai:auth:v1:${challenge}`;

/** Testo firmato alla registrazione: lega le due chiavi pubbliche all'email. */
export const registerMessage = (signPk: string, boxPk: string, email: string) => `athenai:register:v2:${signPk}:${boxPk}:${normalizeEmail(email)}`;

// ---------------------------------------------------------------- dati cifrati

/** Busta simmetrica (XChaCha20-Poly1305): nonce e testo cifrato in base64url. */
export interface SealedBox {
  v: 1;
  /** epoca della chiave usata */
  e: number;
  n: string;
  c: string;
}

/** Dati autenticati delle buste: legano il testo cifrato a che cosa e a quale oggetto. */
export const AD = {
  /** la chiave principale avvolta dalla password o dal codice di recupero */
  masterWrap: (kind: 'password' | 'recovery') => `athenai:master-wrap:v1:${kind}`,
  polisMeta: (polisId: string) => `athenai:polis-meta:v1:${polisId}`,
  profile: (polisId: string, accountId: string) => `athenai:profile:v1:${polisId}:${accountId}`,
  symposionMeta: (symposionId: string) => `athenai:symposion-meta:v1:${symposionId}`,
  symposionKey: (symposionId: string, epoch: number) => `athenai:symposion-key:v1:${symposionId}:${epoch}`,
  keyChain: (polisId: string, epoch: number) => `athenai:key-chain:v1:${polisId}:${epoch}`,
  invite: (inviteId: string) => `athenai:invite:v1:${inviteId}`,
  guestLink: (linkId: string) => `athenai:guest-link:v1:${linkId}`,
  prefs: (accountId: string) => `athenai:prefs:v1:${accountId}`,
  docMeta: (documentId: string) => `athenai:doc-meta:v1:${documentId}`,
  /** voce del registro di un documento: lega flusso, tipo e autore */
  docLog: (documentId: string, stream: Stream, kind: EntryKind, author: string) => `athenai:doc-log:v1:${documentId}:${stream}:${kind}:${author}`,
  /** cursori e presenza: effimeri, mai salvati */
  awareness: (documentId: string, author: string) => `athenai:awareness:v1:${documentId}:${author}`,
};

const B64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isB64url(x: unknown, maxLength = 8192): x is string {
  return typeof x === 'string' && x.length > 0 && x.length <= maxLength && B64URL.test(x);
}

export function isUuid(x: unknown): x is string {
  return typeof x === 'string' && UUID.test(x);
}

export function isSealedBox(x: unknown, maxLength = 16384): x is SealedBox {
  const b = x as SealedBox;
  return !!b && b.v === 1 && Number.isInteger(b.e) && b.e >= 1 && isB64url(b.n, 64) && isB64url(b.c, maxLength);
}

// ---------------------------------------------------------------- account

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(x: unknown): x is string {
  return typeof x === 'string' && x.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.trim());
}

/** Parametri di Argon2id con cui il browser ricava le chiavi dalla password. */
export interface KdfParams {
  salt: string;
  ops: number;
  /** byte */
  mem: number;
}

/** Valori di oggi: 3 passaggi, 64 MiB (come Bitwarden). */
export const KDF_DEFAULT = { ops: 3, mem: 64 * 1024 * 1024 };

export function isKdfParams(x: unknown): x is KdfParams {
  const k = x as KdfParams;
  return !!k && isB64url(k.salt, 64) && Number.isInteger(k.ops) && k.ops >= 2 && k.ops <= 10 && Number.isInteger(k.mem) && k.mem >= 32 * 1024 * 1024 && k.mem <= 1024 * 1024 * 1024;
}

export const MIN_PASSWORD = 10;

export interface RegisterRequest {
  email: string;
  /** chiave d'accesso ricavata dalla password: il server ne conserva solo l'hash */
  authKey: string;
  kdf: KdfParams;
  /** chiave principale avvolta con la chiave ricavata dalla password (che il server non vede) */
  wrapped: SealedBox;
  signPk: string;
  boxPk: string;
  signature: string;
}

export interface LoginRequest {
  email: string;
  authKey: string;
}

export interface AccountView {
  accountId: string;
  email: string;
  signPk: string;
  boxPk: string;
  kdf: KdfParams;
  wrapped: SealedBox;
  /** preferenze e nome, cifrati con una chiave ricavata dalla chiave principale */
  prefs: SealedBox | null;
  hasRecovery: boolean;
}

export interface SessionResponse {
  token: string;
  expiresAt: string;
  account: AccountView;
}

export interface ChangePasswordRequest {
  authKey: string;
  kdf: KdfParams;
  wrapped: SealedBox;
}

/** Codice di recupero: avvolge la chiave principale; il server conserva l'hash della sua chiave d'accesso. */
export interface SetRecoveryRequest {
  recoveryAuth: string;
  wrapped: SealedBox;
}

export interface RecoverRequest {
  email: string;
  recoveryAuth: string;
}

export interface RecoverResponse extends SessionResponse {
  recoveryWrapped: SealedBox;
}

export interface PublicKeys {
  accountId: string;
  signPk: string;
  boxPk: string;
}

// ---------------------------------------------------------------- Polis e Symposia

export interface PolisSummary {
  id: string;
  role: MemberRole;
  meta: SealedBox;
  epoch: number;
  rotationNeeded: boolean;
}

export interface MemberView extends PublicKeys {
  role: MemberRole;
  profile: SealedBox | null;
  joinedAt: string;
}

export interface SymposionView {
  id: string;
  meta: SealedBox;
  epoch: number;
  /** chiave del Symposion per epoca, cifrata con la chiave della Polis dell'epoca indicata */
  keys: { epoch: number; polisEpoch: number; wrapped: SealedBox }[];
  createdAt: string;
}

export interface InviteView {
  id: string;
  expiresAt: string;
  usesLeft: number;
}

/** Ospite di un Symposion: nome di un personaggio greco, chiavi pubbliche della sua sessione. */
export interface GuestView {
  id: string;
  symposionId: string;
  name: string;
  signPk: string;
  boxPk: string;
  mode: GuestMode;
  expiresAt: string;
}

export interface GuestLinkView {
  id: string;
  symposionId: string;
  mode: GuestMode;
  expiresAt: string;
}

export interface PolisDetail extends PolisSummary {
  members: MemberView[];
  /** le mie chiavi della Polis (sealed box verso la mia chiave X25519), per epoca */
  myKeys: { epoch: number; sealed: string }[];
  /** catena all'indietro: per l'epoca e, la chiave dell'epoca e-1 cifrata con quella di e */
  chain: { epoch: number; prev: SealedBox }[];
  symposia: SymposionView[];
  /** ospiti con una sessione aperta */
  guests: GuestView[];
  /** solo per l'Archon */
  invites: InviteView[];
  links: GuestLinkView[];
}

export interface CreatePolisRequest {
  id: string;
  meta: SealedBox;
  sealed: string;
  profile: SealedBox;
}

export interface CreateInviteRequest {
  id: string;
  /** chiave della Polis cifrata con il segreto del link */
  key: SealedBox;
  hours: number;
  uses: number;
}

export interface InviteDetail {
  id: string;
  polisId: string;
  key: SealedBox;
  meta: SealedBox;
  expiresAt: string;
}

export interface AcceptInviteRequest {
  /** la chiave della Polis cifrata verso me stesso */
  sealed: string;
  profile: SealedBox;
}

export interface CreateSymposionRequest {
  id: string;
  meta: SealedBox;
  key: SealedBox;
}

export interface RotateRequest {
  epoch: number;
  /** la nuova chiave per ogni membro rimasto */
  envelopes: { accountId: string; sealed: string }[];
  /** la chiave precedente cifrata con la nuova */
  prev: SealedBox;
  /** una nuova chiave per ogni Symposion, cifrata con la nuova chiave della Polis */
  symposia: { symposionId: string; key: SealedBox }[];
  /** il nome della Polis cifrato con la nuova chiave */
  meta: SealedBox;
}

// ---------------------------------------------------------------- link (inviti e ospiti)

/**
 * Link d'invito nella Polis (per chi ha o crea un account): l'id va al server, il segreto resta nel
 * frammento (dopo #), che il browser non invia mai. Con il segreto si apre la chiave della Polis.
 */
export function inviteLink(origin: string, inviteId: string, secret: string): string {
  return `${origin.replace(/\/$/, '')}/invito/${inviteId}#${secret}`;
}

export function parseInviteLink(url: string): { inviteId: string; secret: string } | null {
  const m = /\/invito\/([0-9a-f-]{36})#([A-Za-z0-9_-]{20,})$/.exec(url.trim());
  return m && isUuid(m[1]) ? { inviteId: m[1], secret: m[2] } : null;
}

/** Link privato per gli ospiti di un Symposion: nel frammento il segreto che apre la sua chiave. */
export function guestLink(origin: string, linkId: string, secret: string): string {
  return `${origin.replace(/\/$/, '')}/s/${linkId}#${secret}`;
}

export function parseGuestLink(url: string): { linkId: string; secret: string } | null {
  const m = /\/s\/([0-9a-f-]{36})#([A-Za-z0-9_-]{20,})$/.exec(url.trim());
  return m && isUuid(m[1]) ? { linkId: m[1], secret: m[2] } : null;
}

export interface CreateGuestLinkRequest {
  id: string;
  mode: GuestMode;
  /** le chiavi del Symposion (tutte le epoche, JSON) cifrate con il segreto del link */
  key: SealedBox;
  /** il nome del Symposion cifrato con il segreto del link */
  meta: SealedBox;
  hours: number;
}

export interface GuestLinkDetail {
  id: string;
  polisId: string;
  symposionId: string;
  mode: GuestMode;
  key: SealedBox;
  /** nome del Symposion (cifrato con il segreto del link) */
  meta: SealedBox;
  expiresAt: string;
}

export interface JoinGuestRequest {
  signPk: string;
  boxPk: string;
}

export interface GuestSessionResponse {
  token: string;
  guestId: string;
  name: string;
  expiresAt: string;
}

/** Quello che un ospite sa del Symposion in cui e' entrato. */
export interface GuestContext {
  guestId: string;
  name: string;
  mode: GuestMode;
  polisId: string;
  symposionId: string;
  linkId: string;
  expiresAt: string;
  /** le persone del Symposion: chiavi pubbliche per verificare le firme; i nomi solo degli ospiti */
  people: { id: string; signPk: string; boxPk: string; guestName?: string }[];
}

/** Personaggi del mondo greco classico per i nomi degli ospiti. */
export const GUEST_NAMES = [
  'Saffo', 'Ipazia', 'Pericle', 'Aspasia', 'Socrate', 'Platone', 'Aristotele', 'Euclide', 'Archimede', 'Erodoto',
  'Tucidide', 'Ippocrate', 'Pitagora', 'Eraclito', 'Democrito', 'Epicuro', 'Diogene', 'Antigone', 'Elettra', 'Penelope',
  'Odisseo', 'Achille', 'Ettore', 'Andromaca', 'Cassandra', 'Medea', 'Sofocle', 'Euripide', 'Eschilo', 'Aristofane',
  'Esopo', 'Omero', 'Esiodo', 'Pindaro', 'Talete', 'Anassimandro', 'Parmenide', 'Zenone', 'Ipparchia', 'Diotima',
  'Temistocle', 'Solone', 'Clistene', 'Fidia', 'Prassitele', 'Eratostene', 'Aristarco', 'Teofrasto', 'Callimaco', 'Corinna',
] as const;

/**
 * Un nome per un nuovo ospite, diverso da quelli gia' presenti. Esauriti i nomi, si aggiunge un
 * numero romano ("Saffo II"). `rand` in [0, 1).
 */
export function pickGuestName(taken: Iterable<string>, rand: () => number): string {
  const used = new Set(taken);
  const free = GUEST_NAMES.filter((n) => !used.has(n));
  if (free.length) return free[Math.floor(rand() * free.length)];
  const roman = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  for (const r of roman) {
    const options = GUEST_NAMES.map((n) => `${n} ${r}`).filter((n) => !used.has(n));
    if (options.length) return options[Math.floor(rand() * options.length)];
  }
  return `${GUEST_NAMES[Math.floor(rand() * GUEST_NAMES.length)]} ${Math.floor(rand() * 1000)}`;
}

// ---------------------------------------------------------------- documenti

/**
 * Un documento ha due flussi Yjs cifrati con la chiave del Symposion: il testo e gli Scholia
 * (commenti). Sono separati perche' il server, che non legge nulla, possa far rispettare i ruoli:
 * un ospite con il link "puo' commentare" scrive solo negli Scholia.
 */
export const STREAMS = ['text', 'scholia'] as const;
export type Stream = (typeof STREAMS)[number];
export const isStream = (x: unknown): x is Stream => (STREAMS as readonly unknown[]).includes(x);

/** update = modifica Yjs; snapshot = stato intero che sostituisce le voci fino a `covers` */
export type EntryKind = 'update' | 'snapshot';
export const isEntryKind = (x: unknown): x is EntryKind => x === 'update' || x === 'snapshot';

export function canPush(role: Role, stream: Stream, mode?: GuestMode): boolean {
  return stream === 'text' ? can.write(role, mode) : can.comment(role);
}

/** Limiti delle buste (in caratteri base64url): una modifica e' piccola, uno stato intero meno. */
export const MAX_UPDATE = 512 * 1024;
export const MAX_SNAPSHOT = 4 * 1024 * 1024;

/**
 * Testo firmato (Ed25519) dall'autore di ogni voce: il server verifica che l'abbia scritta chi ne ha
 * il diritto, gli altri client che nessuno l'abbia alterata o attribuita ad altri.
 */
export const logMessage = (documentId: string, stream: Stream, kind: EntryKind, box: SealedBox) =>
  `athenai:doc-log:v1:${documentId}:${stream}:${kind}:${box.e}:${box.n}:${box.c}`;

export interface LogEntry {
  seq: number;
  stream: Stream;
  kind: EntryKind;
  /** account o ospite */
  author: string;
  /**
   * chiave Ed25519 dell'autore secondo il server: serve per chi non c'e' piu'. Per i membri e gli
   * ospiti presenti vale quella nota. Il server non puo' comunque fabbricare voci: non ha la chiave.
   */
  authorPk: string;
  box: SealedBox;
  sig: string;
}

export interface DocumentView {
  id: string;
  symposionId: string;
  /** titolo, cifrato con la chiave del Symposion */
  meta: SealedBox;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocumentRequest {
  id: string;
  meta: SealedBox;
}

// ---------------------------------------------------------------- tempo reale

/** Messaggi dal client al server sulla connessione /v1/live (WebSocket). */
export type ClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'sub'; documentId: string }
  | { t: 'unsub'; documentId: string }
  | { t: 'push'; ref: number; documentId: string; stream: Stream; kind: EntryKind; box: SealedBox; sig: string; covers?: number }
  | { t: 'aw'; documentId: string; box: SealedBox | null };

/** Messaggi dal server: il registro, le voci nuove, la presenza e gli avvisi di cambiamento. */
export type ServerMessage =
  | { t: 'ready' }
  | { t: 'log'; documentId: string; entries: LogEntry[] }
  | { t: 'entry'; documentId: string; entry: LogEntry }
  | { t: 'ack'; ref: number; seq: number }
  /** presenza di un'altra connessione (cid); box null = se n'e' andata */
  | { t: 'aw'; documentId: string; from: string; cid: string; box: SealedBox | null }
  | { t: 'polis'; polisId: string }
  | { t: 'notice' }
  | { t: 'err'; ref?: number; error: string };

/** Legge e valida un messaggio del client; null se non e' ben formato. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'auth':
      return isB64url(m.token, 128) ? { t: 'auth', token: m.token } : null;
    case 'sub':
    case 'unsub':
      return isUuid(m.documentId) ? { t: m.t, documentId: m.documentId } : null;
    case 'push': {
      const max = m.kind === 'snapshot' ? MAX_SNAPSHOT : MAX_UPDATE;
      if (!Number.isInteger(m.ref) || !isUuid(m.documentId) || !isStream(m.stream) || !isEntryKind(m.kind)) return null;
      if (!isSealedBox(m.box, max) || !isB64url(m.sig, 128)) return null;
      const covers = m.covers;
      if (m.kind === 'snapshot' ? !(Number.isInteger(covers) && (covers as number) >= 0) : covers !== undefined) return null;
      return { t: 'push', ref: m.ref as number, documentId: m.documentId, stream: m.stream, kind: m.kind, box: m.box, sig: m.sig, ...(m.kind === 'snapshot' ? { covers: covers as number } : {}) };
    }
    case 'aw':
      return isUuid(m.documentId) && (m.box === null || isSealedBox(m.box, 8192)) ? { t: 'aw', documentId: m.documentId, box: m.box as SealedBox | null } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- notifiche

/** Che cosa dice una notifica: la vede solo il destinatario (sealed box verso la sua chiave). */
export interface Notice {
  kind: 'mention';
  polisId: string;
  symposionId: string;
  documentId: string;
  /** il commento in cui si e' chiamati (si apre con la notifica) */
  scholionId?: string;
  /** chi l'ha mandata (deve firmarla) */
  from: string;
  /** il testo del commento, accorciato */
  excerpt: string;
  at: string;
}

/** Testo firmato dal mittente: legato al destinatario, non si puo' girare ad altri. */
export const noticeMessage = (to: string, payload: string) => `athenai:notice:v1:${to}:${payload}`;

export interface NoticeItem {
  id: string;
  /** sealed box con { payload, sig }, payload = JSON di Notice */
  sealed: string;
  createdAt: string;
}

export interface SendNoticesRequest {
  to: { accountId: string; sealed: string }[];
}
