// Client delle API del server di Athenai. Tutto quello che passa di qui e' gia' cifrato, tranne
// email, chiavi pubbliche e richieste di servizio. Il token di sessione resta in memoria (per gli
// ospiti anche nella sessione della scheda).
import type {
  RegisterRequest,
  LoginRequest,
  SessionResponse,
  ChangePasswordRequest,
  SetRecoveryRequest,
  RecoverRequest,
  RecoverResponse,
  AccountView,
  KdfParams,
  PolisSummary,
  PolisDetail,
  CreatePolisRequest,
  CreateInviteRequest,
  InviteDetail,
  AcceptInviteRequest,
  CreateSymposionRequest,
  CreateGuestLinkRequest,
  GuestLinkDetail,
  GuestSessionResponse,
  GuestContext,
  RotateRequest,
  SealedBox,
  MemberRole,
  DocumentView,
  CreateDocumentRequest,
  LogEntry,
  NoticeItem,
  SendNoticesRequest,
} from '@athenai/protocol';

export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

let token: string | null = null;
const tokenListeners = new Set<(t: string | null) => void>();

export function setToken(t: string | null) {
  token = t;
  tokenListeners.forEach((l) => l(t));
}

/** Chi deve seguire la sessione (la connessione in tempo reale, le cache in memoria). */
export function onToken(fn: (t: string | null) => void) {
  tokenListeners.add(fn);
  if (token) fn(token);
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'offline');
  }
  if (r.status === 204) return null as T;
  const json = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new ApiError(r.status, json.error ?? 'error');
  return json;
}

export const api = {
  register: (r: RegisterRequest) => call<SessionResponse>('POST', '/v1/auth/register', r),
  prelogin: (email: string) => call<{ kdf: KdfParams }>('POST', '/v1/auth/prelogin', { email }),
  login: (r: LoginRequest) => call<SessionResponse>('POST', '/v1/auth/login', r),
  recover: (r: RecoverRequest) => call<RecoverResponse>('POST', '/v1/auth/recover', r),
  challenge: (signPk: string) => call<{ challenge: string }>('POST', '/v1/auth/challenge', { signPk }),
  session: (signPk: string, challenge: string, signature: string) => call<SessionResponse>('POST', '/v1/auth/session', { signPk, challenge, signature }),
  me: () => call<AccountView>('GET', '/v1/me'),
  logout: () => call('POST', '/v1/me/logout'),
  changePassword: (r: ChangePasswordRequest) => call('PUT', '/v1/me/password', r),
  setRecovery: (r: SetRecoveryRequest) => call('PUT', '/v1/me/recovery', r),
  removeRecovery: () => call('DELETE', '/v1/me/recovery'),
  putPrefs: (prefs: SealedBox) => call('PUT', '/v1/me/prefs', { prefs }),

  listPolis: () => call<PolisSummary[]>('GET', '/v1/polis'),
  polis: (id: string) => call<PolisDetail>('GET', `/v1/polis/${id}`),
  createPolis: (r: CreatePolisRequest) => call<{ id: string }>('POST', '/v1/polis', r),
  renamePolis: (polisId: string, meta: SealedBox) => call('PUT', `/v1/polis/${polisId}/meta`, { meta }),
  putProfile: (polisId: string, profile: SealedBox) => call('PUT', `/v1/polis/${polisId}/profile`, { profile }),
  setRole: (polisId: string, accountId: string, role: MemberRole) => call('PATCH', `/v1/polis/${polisId}/members/${accountId}`, { role }),
  removeMember: (polisId: string, accountId: string) => call('DELETE', `/v1/polis/${polisId}/members/${accountId}`),
  rotate: (polisId: string, r: RotateRequest) => call('POST', `/v1/polis/${polisId}/rotate`, r),
  createInvite: (polisId: string, r: CreateInviteRequest) => call('POST', `/v1/polis/${polisId}/invites`, r),
  deleteInvite: (polisId: string, inviteId: string) => call('DELETE', `/v1/polis/${polisId}/invites/${inviteId}`),
  invite: (id: string) => call<InviteDetail>('GET', `/v1/invites/${id}`),
  acceptInvite: (id: string, r: AcceptInviteRequest) => call<{ polisId: string }>('POST', `/v1/invites/${id}/accept`, r),

  createSymposion: (polisId: string, r: CreateSymposionRequest) => call('POST', `/v1/polis/${polisId}/symposia`, r),
  renameSymposion: (symposionId: string, meta: SealedBox) => call('PUT', `/v1/symposia/${symposionId}/meta`, { meta }),
  deleteSymposion: (symposionId: string) => call('DELETE', `/v1/symposia/${symposionId}`),
  createGuestLink: (symposionId: string, r: CreateGuestLinkRequest) => call('POST', `/v1/symposia/${symposionId}/links`, r),
  revokeGuestLink: (linkId: string) => call('DELETE', `/v1/links/${linkId}`),
  guestLink: (linkId: string) => call<GuestLinkDetail>('GET', `/v1/links/${linkId}`),
  joinGuest: (linkId: string, signPk: string, boxPk: string) => call<GuestSessionResponse>('POST', `/v1/links/${linkId}/join`, { signPk, boxPk }),
  guestMe: () => call<GuestContext>('GET', '/v1/guest/me'),

  documents: (symposionId: string) => call<DocumentView[]>('GET', `/v1/symposia/${symposionId}/documents`),
  createDocument: (symposionId: string, r: CreateDocumentRequest) => call<{ id: string }>('POST', `/v1/symposia/${symposionId}/documents`, r),
  renameDocument: (documentId: string, meta: SealedBox) => call('PUT', `/v1/documents/${documentId}/meta`, { meta }),
  deleteDocument: (documentId: string) => call('DELETE', `/v1/documents/${documentId}`),
  documentLog: (documentId: string) => call<LogEntry[]>('GET', `/v1/documents/${documentId}/log`),

  sendNotices: (polisId: string, r: SendNoticesRequest) => call('POST', `/v1/polis/${polisId}/notices`, r),
  notices: () => call<NoticeItem[]>('GET', '/v1/me/notices'),
  dropNotice: (id: string) => call('DELETE', `/v1/me/notices/${id}`),
  dropAllNotices: () => call('DELETE', '/v1/me/notices'),
};
