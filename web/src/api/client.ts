// Client delle API del server di Athenai. Tutto quello che passa di qui e' gia' cifrato, tranne le
// chiavi pubbliche e le richieste di servizio (sfida, ruoli). Il token di sessione resta in memoria.
import type {
  LookupResponse,
  SessionResponse,
  PolisSummary,
  PolisDetail,
  CreatePolisRequest,
  CreateInviteRequest,
  InviteDetail,
  AcceptInviteRequest,
  CreateOikosRequest,
  RotateRequest,
  WrappedMaster,
  SealedBox,
  Role,
  TomosView,
  CreateTomosRequest,
  LogEntry,
  KeryxItem,
  SendKeryxRequest,
} from '@athenai/protocol';
import type { Binding } from '../auth';

export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const BASE = API_BASE;

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

/** Chi deve seguire la sessione (la connessione in tempo reale). */
export function onToken(fn: (t: string | null) => void) {
  tokenListeners.add(fn);
  if (token) fn(token);
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, {
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
  /** null = nessun account legato a questo accesso */
  async lookup(b: Binding): Promise<LookupResponse | null> {
    try {
      return await call<LookupResponse>('POST', '/v1/accounts/lookup', b);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  register: (b: Binding & { signPk: string; boxPk: string; signature: string }) => call<{ accountId: string }>('POST', '/v1/accounts', b),
  challenge: (signPk: string) => call<{ challenge: string }>('POST', '/v1/auth/challenge', { signPk }),
  session: (signPk: string, challenge: string, signature: string) => call<SessionResponse>('POST', '/v1/auth/session', { signPk, challenge, signature }),
  putPasskey: (credentialId: string, salt: string, wrapped: WrappedMaster) => call('PUT', `/v1/me/passkeys/${credentialId}`, { salt, wrapped }),
  putPrefs: (prefs: SealedBox) => call('PUT', '/v1/me/prefs', { prefs }),

  listPolis: () => call<PolisSummary[]>('GET', '/v1/polis'),
  polis: (id: string) => call<PolisDetail>('GET', `/v1/polis/${id}`),
  createPolis: (r: CreatePolisRequest) => call<{ id: string }>('POST', '/v1/polis', r),
  putProfile: (polisId: string, profile: SealedBox) => call('PUT', `/v1/polis/${polisId}/profile`, { profile }),
  setRole: (polisId: string, accountId: string, role: Role) => call('PATCH', `/v1/polis/${polisId}/members/${accountId}`, { role }),
  removeMember: (polisId: string, accountId: string) => call('DELETE', `/v1/polis/${polisId}/members/${accountId}`),
  rotate: (polisId: string, r: RotateRequest) => call('POST', `/v1/polis/${polisId}/rotate`, r),
  createInvite: (polisId: string, r: CreateInviteRequest) => call('POST', `/v1/polis/${polisId}/invites`, r),
  deleteInvite: (polisId: string, inviteId: string) => call('DELETE', `/v1/polis/${polisId}/invites/${inviteId}`),
  invite: (id: string) => call<InviteDetail>('GET', `/v1/invites/${id}`),
  acceptInvite: (id: string, r: AcceptInviteRequest) => call<{ polisId: string }>('POST', `/v1/invites/${id}/accept`, r),
  createOikos: (polisId: string, r: CreateOikosRequest) => call('POST', `/v1/polis/${polisId}/oikos`, r),

  listTomos: (oikosId: string) => call<TomosView[]>('GET', `/v1/oikos/${oikosId}/tomos`),
  createTomos: (oikosId: string, r: CreateTomosRequest) => call<{ id: string }>('POST', `/v1/oikos/${oikosId}/tomos`, r),
  renameTomos: (tomosId: string, meta: SealedBox) => call('PUT', `/v1/tomos/${tomosId}/meta`, { meta }),
  deleteTomos: (tomosId: string) => call('DELETE', `/v1/tomos/${tomosId}`),
  tomosLog: (tomosId: string) => call<LogEntry[]>('GET', `/v1/tomos/${tomosId}/log`),

  sendKeryx: (polisId: string, r: SendKeryxRequest) => call('POST', `/v1/polis/${polisId}/keryx`, r),
  keryx: () => call<KeryxItem[]>('GET', '/v1/me/keryx'),
  dropKeryx: (id: string) => call('DELETE', `/v1/me/keryx/${id}`),
  dropAllKeryx: () => call('DELETE', '/v1/me/keryx'),

  linkSend: (channel: string, message: string) => call('POST', `/v1/link/${channel}`, { message }),
  linkReceive: (channel: string, signal?: AbortSignal) => call<{ message: string } | null>('GET', `/v1/link/${channel}`, undefined, signal),
};
