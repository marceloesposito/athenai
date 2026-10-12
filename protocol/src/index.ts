// Protocollo fra l'app e il server di Athenai: ruoli, testi da firmare, formati delle buste cifrate,
// link d'invito e tipi delle API. Solo funzioni pure e tipi: la crittografia sta nel client, il
// server verifica le firme e i permessi ma non vede mai chiavi segrete o contenuti in chiaro.
// (Solo sintassi "cancellabile": il server lo esegue con il TypeScript nativo di Node.)

export const API_VERSION = 'v1';

// ---------------------------------------------------------------- ruoli

export const ROLES = ['archon', 'polites', 'mentore', 'xenos'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(x: unknown): x is Role {
  return (ROLES as readonly unknown[]).includes(x);
}

/** Chi puo' fare cosa in una Polis. */
export const can = {
  /** invitare, cambiare ruoli, allontanare, ruotare le chiavi */
  govern: (r: Role) => r === 'archon',
  /** creare Oikos e scrivere nei contenuti */
  write: (r: Role) => r === 'archon' || r === 'polites',
  /** commentare e proporre modifiche (dalla fase P3) */
  comment: (r: Role) => r !== 'xenos',
  read: (_r: Role) => true,
};

// ---------------------------------------------------------------- firme

/** Testo firmato per dimostrare di possedere la chiave all'accesso. */
export const authMessage = (challenge: string) => `athenai:auth:v1:${challenge}`;

/** Testo firmato alla registrazione: lega le due chiavi pubbliche all'account d'accesso. */
export const registerMessage = (signPk: string, boxPk: string, binding: string) => `athenai:register:v1:${signPk}:${boxPk}:${binding}`;

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
  polisMeta: (polisId: string) => `athenai:polis-meta:v1:${polisId}`,
  profile: (polisId: string, accountId: string) => `athenai:profile:v1:${polisId}:${accountId}`,
  oikosMeta: (oikosId: string) => `athenai:oikos-meta:v1:${oikosId}`,
  oikosKey: (oikosId: string, epoch: number) => `athenai:oikos-key:v1:${oikosId}:${epoch}`,
  keyChain: (polisId: string, epoch: number) => `athenai:key-chain:v1:${polisId}:${epoch}`,
  invite: (inviteId: string) => `athenai:invite:v1:${inviteId}`,
  prefs: (accountId: string) => `athenai:prefs:v1:${accountId}`,
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

// ---------------------------------------------------------------- inviti

/**
 * Link d'invito: l'id va al server, il segreto resta nel frammento (dopo #), che il browser non
 * invia mai. Con il segreto si apre la chiave della Polis allegata all'invito.
 */
export function inviteLink(origin: string, inviteId: string, secret: string): string {
  return `${origin.replace(/\/$/, '')}/invito/${inviteId}#${secret}`;
}

export function parseInviteLink(url: string): { inviteId: string; secret: string } | null {
  const m = /\/invito\/([0-9a-f-]{36})#([A-Za-z0-9_-]{20,})$/.exec(url.trim());
  return m && isUuid(m[1]) ? { inviteId: m[1], secret: m[2] } : null;
}

// ---------------------------------------------------------------- API

export interface RegisterRequest {
  signPk: string;
  boxPk: string;
  signature: string;
  /** OIDC (Zitadel) oppure, solo su server di prova, l'id dell'account di prova */
  idToken?: string;
  trialId?: string;
}

export interface LookupRequest {
  idToken?: string;
  trialId?: string;
}

/** Chiave principale avvolta da una passkey (estensione PRF): il server la custodisce ma non la apre. */
export interface WrappedMaster {
  v: 1;
  kind: 'passkey';
  nonce: string;
  ct: string;
}

export function isWrappedMaster(x: unknown): x is WrappedMaster {
  const w = x as WrappedMaster;
  return !!w && w.v === 1 && w.kind === 'passkey' && isB64url(w.nonce, 64) && isB64url(w.ct, 256);
}

export interface PasskeyWrap {
  credentialId: string;
  /** sale dell'estensione PRF */
  salt: string;
  wrapped: WrappedMaster;
}

export interface LookupResponse extends PublicKeys {
  passkeys: PasskeyWrap[];
  /** preferenze dell'utente, cifrate con una chiave derivata dalla sua chiave principale */
  prefs: SealedBox | null;
}

export interface PublicKeys {
  accountId: string;
  signPk: string;
  boxPk: string;
}

export interface SessionResponse {
  token: string;
  accountId: string;
  expiresAt: string;
}

export interface PolisSummary {
  id: string;
  role: Role;
  meta: SealedBox;
  epoch: number;
  rotationNeeded: boolean;
}

export interface MemberView extends PublicKeys {
  role: Role;
  profile: SealedBox | null;
  joinedAt: string;
}

export interface OikosView {
  id: string;
  meta: SealedBox;
  epoch: number;
  /** chiave dell'Oikos per epoca, cifrata con la chiave della Polis dell'epoca indicata */
  keys: { epoch: number; polisEpoch: number; wrapped: SealedBox }[];
  createdAt: string;
}

export interface InviteView {
  id: string;
  role: Role;
  expiresAt: string;
  usesLeft: number;
}

export interface PolisDetail extends PolisSummary {
  members: MemberView[];
  /** le mie chiavi della Polis (sealed box verso la mia chiave X25519), per epoca */
  myKeys: { epoch: number; sealed: string }[];
  /** catena all'indietro: per l'epoca e, la chiave dell'epoca e-1 cifrata con quella di e */
  chain: { epoch: number; prev: SealedBox }[];
  oikos: OikosView[];
  /** solo per l'Archon */
  invites: InviteView[];
}

export interface CreatePolisRequest {
  id: string;
  meta: SealedBox;
  sealed: string;
  profile: SealedBox;
}

export interface CreateInviteRequest {
  id: string;
  role: Exclude<Role, 'archon'>;
  /** chiave della Polis cifrata con il segreto del link */
  key: SealedBox;
  hours: number;
  uses: number;
}

export interface InviteDetail {
  id: string;
  polisId: string;
  role: Role;
  key: SealedBox;
  meta: SealedBox;
  expiresAt: string;
}

export interface AcceptInviteRequest {
  /** la chiave della Polis cifrata verso me stesso */
  sealed: string;
  profile: SealedBox;
}

export interface CreateOikosRequest {
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
  /** una nuova chiave per ogni Oikos, cifrata con la nuova chiave della Polis */
  oikos: { oikosId: string; key: SealedBox }[];
  /** il nome della Polis cifrato con la nuova chiave */
  meta: SealedBox;
}
