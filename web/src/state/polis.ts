// Polis, Oikos e Tomoi dell'utente: si scaricano cifrati dal server e si aprono qui con le sue chiavi.
// Nulla si salva nel browser. La rotazione delle chiavi dopo un'uscita la fa da se' il primo Archon
// che apre la Polis: l'utente non deve pensarci. Quando una Polis cambia il server lo dice in tempo
// reale e la vista si aggiorna da se'.
import { create } from 'zustand';
import { AD, can, parseInviteLink, type PolisDetail, type Role } from '@athenai/protocol';
import { api, ApiError } from '../api/client';
import { live } from '../live/socket';
import { sealTomosMeta, openTomosMeta, type EpochKeys } from '../crypto/tomos';
import { useSession } from './session';
import {
  keyring,
  openJson,
  sealJson,
  createPolisRequest,
  createInvite,
  acceptInvite,
  createOikosRequest,
  rotationRequest,
  type Keyring,
  type PolisMeta,
  type OikosMeta,
  type Profile,
} from '../crypto/polis';

export interface PolisItem {
  id: string;
  name: string;
  role: Role;
}

export interface Member {
  accountId: string;
  name: string;
  role: Role;
  signPk: string;
  boxPk: string;
  me: boolean;
}

export interface OikosItem {
  id: string;
  name: string;
}

export interface OpenPolis {
  id: string;
  name: string;
  role: Role;
  members: Member[];
  oikos: OikosItem[];
  invites: PolisDetail['invites'];
  detail: PolisDetail;
  ring: Keyring;
}

export interface TomosItem {
  id: string;
  title: string;
  updatedAt: string;
}

export type View =
  | { kind: 'akropolis' }
  | { kind: 'polis'; id: string }
  | { kind: 'oikos'; id: string; oikosId: string }
  | { kind: 'tomos'; id: string; oikosId: string; tomosId: string };

interface PolisState {
  list: PolisItem[] | null;
  current: OpenPolis | null;
  view: View;
  /** i Tomoi dell'Oikos aperto */
  tomoi: TomosItem[] | null;
  /** Scholion da mostrare all'apertura del Tomos (da una notifica) */
  focus: string | null;
  setFocus(id: string | null): void;
  /** invito arrivato dal link (id e segreto del frammento), da proporre dopo lo sblocco */
  pendingInvite: { inviteId: string; secret: string } | null;
  busy: boolean;
  refresh(): Promise<void>;
  go(v: View): Promise<void>;
  /** ricarica la Polis aperta (e i Tomoi dell'Oikos aperto): la chiama l'avviso in tempo reale */
  reload(): Promise<void>;
  found(name: string): Promise<void>;
  newOikos(name: string): Promise<void>;
  invite(role: Exclude<Role, 'archon'>): Promise<string>;
  setRole(accountId: string, role: Role): Promise<void>;
  remove(accountId: string): Promise<void>;
  /** nome della Polis e ruolo dell'invito in attesa (null se non valido) */
  previewPending(): Promise<{ name: string; role: Role } | null>;
  acceptPending(): Promise<'ok' | 'invalid'>;
  dismissInvite(): void;
  newTomos(): Promise<void>;
  renameTomos(tomosId: string, title: string): Promise<void>;
  deleteTomos(tomosId: string): Promise<void>;
}

/** Le chiavi di un Oikos della Polis aperta: l'epoca con cui si scrive e tutte quelle che so aprire. */
export function oikosKeys(oikosId: string): { epoch: number; ring: EpochKeys } {
  const cur = usePolis.getState().current;
  const o = cur?.detail.oikos.find((x) => x.id === oikosId);
  return { epoch: o?.epoch ?? 0, ring: cur?.ring.oikos.get(oikosId) ?? new Map() };
}

async function loadTomoi(oikosId: string): Promise<TomosItem[]> {
  const { ring } = oikosKeys(oikosId);
  const rows = await api.listTomos(oikosId);
  return Promise.all(rows.map(async (r) => ({ id: r.id, title: (await openTomosMeta(ring, r.id, r.meta))?.title ?? '', updatedAt: r.updatedAt })));
}

const me = () => {
  const { identity, account, user } = useSession.getState();
  if (!identity || !account || !user) throw new Error('locked');
  return { identity, account, profile: { name: user.name } satisfies Profile };
};

async function load(id: string): Promise<OpenPolis> {
  const { identity, account } = me();
  let detail = await api.polis(id);
  let ring = await keyring(detail, identity);
  // dopo un'uscita: il primo Archon che entra ruota le chiavi
  if (detail.rotationNeeded && can.govern(detail.role)) {
    const meta = (await openJson<PolisMeta>(ring.polis.get(detail.meta.e), detail.meta, AD.polisMeta(id))) ?? { name: '' };
    const req = await rotationRequest(detail, ring, meta);
    if (req) {
      await api.rotate(id, req).catch(() => undefined);
      detail = await api.polis(id);
      ring = await keyring(detail, identity);
    }
  }
  const name = (await openJson<PolisMeta>(ring.polis.get(detail.meta.e), detail.meta, AD.polisMeta(id)))?.name ?? '…';
  const members: Member[] = await Promise.all(
    detail.members.map(async (m) => ({
      accountId: m.accountId,
      role: m.role,
      signPk: m.signPk,
      boxPk: m.boxPk,
      me: m.accountId === account.accountId,
      name: (await openJson<Profile>(m.profile ? ring.polis.get(m.profile.e) : undefined, m.profile, AD.profile(id, m.accountId)))?.name ?? '…',
    })),
  );
  const oikos: OikosItem[] = await Promise.all(
    detail.oikos.map(async (o) => ({ id: o.id, name: (await openJson<OikosMeta>(ring.oikos.get(o.id)?.get(1), o.meta, AD.oikosMeta(o.id)))?.name ?? '…' })),
  );
  return { id, name, role: detail.role, members, oikos, invites: detail.invites, detail, ring };
}

/** Invito nel percorso dell'indirizzo (/invito/<id>#<segreto>): lo si prende e si pulisce l'URL. */
function inviteFromUrl() {
  const back = sessionStorage.getItem('athenai:return-to');
  if (back) sessionStorage.removeItem('athenai:return-to');
  const p = parseInviteLink(location.origin + (back ?? location.pathname + location.hash));
  if (p) history.replaceState(null, '', '/');
  return p;
}

export const usePolis = create<PolisState>((set, get) => ({
  list: null,
  current: null,
  view: { kind: 'akropolis' },
  tomoi: null,
  focus: null,
  setFocus: (focus) => set({ focus }),
  pendingInvite: inviteFromUrl(),
  busy: false,

  async refresh() {
    const { identity } = me();
    const summaries = await api.listPolis();
    const list = await Promise.all(
      summaries.map(async (p) => {
        // per il nome serve la chiave dell'epoca del nome: il dettaglio la fornisce
        const detail = await api.polis(p.id);
        const ring = await keyring(detail, identity);
        const name = (await openJson<PolisMeta>(ring.polis.get(p.meta.e), p.meta, AD.polisMeta(p.id)))?.name ?? '…';
        return { id: p.id, name, role: p.role };
      }),
    );
    set({ list });
  },

  async go(v) {
    if (v.kind === 'akropolis') {
      set({ view: v, current: null, tomoi: null });
      await get().refresh();
      return;
    }
    const current = get().current?.id === v.id ? get().current! : await load(v.id);
    set({ current });
    const tomoi = v.kind === 'polis' ? null : await loadTomoi(v.oikosId);
    set({ view: v, tomoi });
  },

  async reload() {
    const { current: cur, view } = get();
    if (!cur) {
      if (view.kind === 'akropolis') await get().refresh();
      return;
    }
    try {
      const current = await load(cur.id);
      set({ current });
      if (view.kind === 'oikos' || view.kind === 'tomos') {
        // l'Oikos (o il Tomos) puo' non esserci piu'
        if (!current.oikos.some((o) => o.id === view.oikosId)) return get().go({ kind: 'polis', id: cur.id });
        const tomoi = await loadTomoi(view.oikosId);
        set({ tomoi });
        if (view.kind === 'tomos' && !tomoi.some((t) => t.id === view.tomosId)) await get().go({ kind: 'oikos', id: cur.id, oikosId: view.oikosId });
      }
    } catch (e) {
      // allontanati dalla Polis: si torna all'Akropolis
      if (e instanceof ApiError && e.status === 404) await get().go({ kind: 'akropolis' });
    }
  },

  async found(name) {
    const { account, profile } = me();
    set({ busy: true });
    try {
      const { req } = await createPolisRequest(account.accountId, account.boxPk, name.trim(), profile);
      await api.createPolis(req);
      await get().go({ kind: 'polis', id: req.id });
    } finally {
      set({ busy: false });
    }
  },

  async newOikos(name) {
    const cur = get().current;
    if (!cur) return;
    const key = cur.ring.polis.get(cur.detail.epoch);
    if (!key) return;
    await api.createOikos(cur.id, await createOikosRequest(key, cur.detail.epoch, name.trim()));
    set({ current: await load(cur.id) });
  },

  async invite(role) {
    const cur = get().current;
    const key = cur?.ring.polis.get(cur.detail.epoch);
    if (!cur || !key) throw new Error('no-key');
    const { req, link } = await createInvite(location.origin, key, cur.detail.epoch, role);
    await api.createInvite(cur.id, req);
    set({ current: await load(cur.id) });
    return link;
  },

  async setRole(accountId, role) {
    const cur = get().current;
    if (!cur) return;
    await api.setRole(cur.id, accountId, role);
    set({ current: await load(cur.id) });
  },

  async remove(accountId) {
    const cur = get().current;
    if (!cur) return;
    await api.removeMember(cur.id, accountId);
    const self = cur.members.find((m) => m.me)?.accountId === accountId;
    if (self) await get().go({ kind: 'akropolis' });
    else set({ current: await load(cur.id) }); // qui la rotazione avviene da se'
  },

  async previewPending() {
    const p = get().pendingInvite;
    if (!p) return null;
    const { account, profile } = me();
    try {
      const inv = await api.invite(p.inviteId);
      const acc = await acceptInvite(p.inviteId, p.secret, inv, account.accountId, account.boxPk, profile);
      if (!acc) return null;
      const name = (await openJson<PolisMeta>(acc.key, inv.meta, AD.polisMeta(inv.polisId)))?.name ?? '…';
      return { name, role: inv.role };
    } catch {
      return null;
    }
  },

  async acceptPending() {
    const p = get().pendingInvite;
    if (!p) return 'invalid';
    const { account, profile } = me();
    try {
      const inv = await api.invite(p.inviteId);
      const acc = await acceptInvite(p.inviteId, p.secret, inv, account.accountId, account.boxPk, profile);
      if (!acc) return 'invalid';
      const { polisId } = await api.acceptInvite(p.inviteId, acc.req);
      set({ pendingInvite: null });
      await get().go({ kind: 'polis', id: polisId });
      return 'ok';
    } catch {
      return 'invalid';
    }
  },

  dismissInvite() {
    set({ pendingInvite: null });
  },

  async newTomos() {
    const { view } = get();
    if (view.kind !== 'oikos') return;
    const { epoch, ring } = oikosKeys(view.oikosId);
    const key = ring.get(epoch);
    if (!key) return;
    const tomosId = crypto.randomUUID();
    await api.createTomos(view.oikosId, { id: tomosId, meta: await sealTomosMeta(key, epoch, tomosId, { title: '' }) });
    await get().go({ kind: 'tomos', id: view.id, oikosId: view.oikosId, tomosId });
  },

  async renameTomos(tomosId, title) {
    const { view } = get();
    if (view.kind !== 'tomos' && view.kind !== 'oikos') return;
    const { epoch, ring } = oikosKeys(view.oikosId);
    const key = ring.get(epoch);
    if (!key) return;
    await api.renameTomos(tomosId, await sealTomosMeta(key, epoch, tomosId, { title: title.trim() }));
    set({ tomoi: get().tomoi?.map((t) => (t.id === tomosId ? { ...t, title: title.trim() } : t)) ?? null });
  },

  async deleteTomos(tomosId) {
    const { view } = get();
    if (view.kind !== 'tomos' && view.kind !== 'oikos') return;
    await api.deleteTomos(tomosId);
    await get().go({ kind: 'oikos', id: view.id, oikosId: view.oikosId });
  },
}));

// tempo reale: quando una mia Polis cambia (membri, Oikos, Tomoi, chiavi) la vista si aggiorna
let reloading: Promise<void> | null = null;
let again = false;
live.onPolis((polisId) => {
  const { current, view } = usePolis.getState();
  if (polisId !== '*' && current?.id !== polisId && view.kind !== 'akropolis') return;
  if (reloading) {
    again = true;
    return;
  }
  reloading = usePolis
    .getState()
    .reload()
    .catch(() => undefined)
    .finally(() => {
      reloading = null;
      if (again) {
        again = false;
        void usePolis.getState().reload();
      }
    });
});

/** Nome cifrato del profilo in una Polis (quando cambia il nome dell'utente). */
export async function updateProfile(polisId: string, ring: Keyring, epoch: number, accountId: string, profile: Profile) {
  const key = ring.polis.get(epoch);
  if (key) await api.putProfile(polisId, await sealJson(key, profile, AD.profile(polisId, accountId), epoch));
}
