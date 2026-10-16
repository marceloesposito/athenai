// Il lavoro aperto: la Polis, i suoi Symposia, i documenti del Symposion aperto e la sezione
// (Agora', Grapheion, Anamnesis). Tutto arriva cifrato dal server e si apre qui. Per un ospite c'e'
// un solo Symposion, con le chiavi prese dal link. Quando una Polis cambia il server lo dice in tempo
// reale e la vista si aggiorna da se'. La rotazione delle chiavi dopo un'uscita la fa da se' il primo
// Archon che apre la Polis.
import { create } from 'zustand';
import { AD, can, type MemberRole, type Role, type GuestMode, type PolisDetail } from '@athenai/protocol';
import { api, ApiError } from '../api/client';
import { live } from '../live/socket';
import { t } from '../i18n';
import { useSession } from './session';
import { usePrefs } from './prefs';
import {
  keyring,
  openJson,
  sealJson,
  createPolisRequest,
  createInvite,
  acceptInvite,
  createSymposionRequest,
  createGuestLinkRequest,
  rotationRequest,
  type Keyring,
  type PolisMeta,
  type SymposionMeta,
  type Profile,
} from '../crypto/polis';
import { sealDocMeta, openDocMeta, type EpochKeys } from '../crypto/docs';

export type Section = 'agora' | 'grapheion' | 'anamnesis';
export type View = { kind: 'home' } | { kind: 'symposion'; symposionId: string; section: Section; documentId: string | null };

/** Una persona di un Symposion: membro della Polis o ospite. */
export interface Person {
  id: string;
  name: string;
  signPk: string;
  boxPk: string;
  role: Role;
  me: boolean;
}

export interface SymposionItem {
  id: string;
  name: string;
}

export interface DocItem {
  id: string;
  title: string;
  updatedAt: string;
}

export interface OpenPolis {
  id: string;
  name: string;
  role: MemberRole;
  members: Person[];
  symposia: SymposionItem[];
  detail: PolisDetail;
  ring: Keyring;
}

interface WorkState {
  polisList: { id: string; name: string; role: MemberRole }[] | null;
  polis: OpenPolis | null;
  view: View;
  docs: DocItem[] | null;
  /** commento da mostrare all'apertura del documento (da una notifica) */
  focus: string | null;
  start(): Promise<void>;
  openPolis(id: string): Promise<void>;
  go(v: View): Promise<void>;
  setSection(section: Section): void;
  openDocument(documentId: string): void;
  reload(): Promise<void>;
  newPolis(name: string): Promise<void>;
  renamePolis(name: string): Promise<void>;
  newSymposion(name: string): Promise<void>;
  renameSymposion(symposionId: string, name: string): Promise<void>;
  deleteSymposion(symposionId: string): Promise<void>;
  newDocument(): Promise<void>;
  renameDocument(documentId: string, title: string): Promise<void>;
  deleteDocument(documentId: string): Promise<void>;
  invite(): Promise<string>;
  createGuestLink(symposionId: string, mode: GuestMode): Promise<string>;
  revokeGuestLink(linkId: string): Promise<void>;
  setRole(accountId: string, role: MemberRole): Promise<void>;
  removeMember(accountId: string): Promise<void>;
  setFocus(id: string | null): void;
  updateProfiles(name: string): Promise<void>;
}

const me = () => {
  const { identity, account } = useSession.getState();
  if (!identity || !account) throw new Error('signed-out');
  return { identity, account, profile: { name: usePrefs.getState().name } satisfies Profile };
};

async function loadPolis(id: string): Promise<OpenPolis> {
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
  const members: Person[] = await Promise.all(
    detail.members.map(async (m) => ({
      id: m.accountId,
      role: m.role,
      signPk: m.signPk,
      boxPk: m.boxPk,
      me: m.accountId === account.accountId,
      name: (await openJson<Profile>(m.profile ? ring.polis.get(m.profile.e) : undefined, m.profile, AD.profile(id, m.accountId)))?.name ?? '…',
    })),
  );
  const symposia = await Promise.all(
    detail.symposia.map(async (o) => ({ id: o.id, name: (await openJson<SymposionMeta>(ring.symposia.get(o.id)?.get(1), o.meta, AD.symposionMeta(o.id)))?.name ?? '…' })),
  );
  return { id, name, role: detail.role, members, symposia, detail, ring };
}

/** Le chiavi di un Symposion: l'epoca con cui si scrive e tutte quelle che so aprire. */
export function symposionKeys(symposionId: string): { epoch: number; ring: EpochKeys } {
  const g = useSession.getState().guest;
  if (g && g.symposionId === symposionId) return { epoch: Math.max(...g.keys.keys()), ring: g.keys };
  const p = useWork.getState().polis;
  const o = p?.detail.symposia.find((x) => x.id === symposionId);
  return { epoch: o?.epoch ?? 0, ring: p?.ring.symposia.get(symposionId) ?? new Map() };
}

/** Chi sono io qui: ruolo e (per gli ospiti) che cosa permette il link. */
export function myRole(): { role: Role; mode?: GuestMode; id: string } {
  const { guest, account } = useSession.getState();
  if (guest) return { role: 'xenos', mode: guest.mode, id: guest.guestId };
  return { role: useWork.getState().polis?.role ?? 'polites', id: account?.accountId ?? '' };
}

/** Le persone di un Symposion: membri della Polis e ospiti presenti. */
export function people(symposionId: string): Person[] {
  const { guest } = useSession.getState();
  if (guest) {
    return guest.people.map((p) => ({
      id: p.id,
      signPk: p.signPk,
      boxPk: p.boxPk,
      role: p.guestName ? 'xenos' : 'polites',
      me: p.id === guest.guestId,
      // gli ospiti non leggono i profili della Polis: i nomi dei membri arrivano con la presenza e
      // con i commenti (dove chi scrive lascia il proprio nome)
      name: p.guestName ?? '',
    }));
  }
  const p = useWork.getState().polis;
  if (!p) return [];
  const guests = p.detail.guests
    .filter((g) => g.symposionId === symposionId)
    .map((g) => ({ id: g.id, name: g.name, signPk: g.signPk, boxPk: g.boxPk, role: 'xenos' as const, me: false }));
  return [...p.members, ...guests];
}

async function loadDocs(symposionId: string): Promise<DocItem[]> {
  const { ring } = symposionKeys(symposionId);
  const rows = await api.documents(symposionId);
  return Promise.all(rows.map(async (r) => ({ id: r.id, title: (await openDocMeta(ring, r.id, r.meta))?.title ?? '', updatedAt: r.updatedAt })));
}

async function polisNames(): Promise<WorkState['polisList']> {
  const { identity } = me();
  const summaries = await api.listPolis();
  return Promise.all(
    summaries.map(async (p) => {
      const detail = await api.polis(p.id);
      const ring = await keyring(detail, identity);
      const name = (await openJson<PolisMeta>(ring.polis.get(p.meta.e), p.meta, AD.polisMeta(p.id)))?.name ?? '…';
      return { id: p.id, name, role: p.role };
    }),
  );
}

const LAST = 'athenai:last-polis';

export const useWork = create<WorkState>((set, get) => ({
  polisList: null,
  polis: null,
  view: { kind: 'home' },
  docs: null,
  focus: null,

  async start() {
    const session = useSession.getState();
    // ospite: un solo Symposion, si apre il Grapheion
    if (session.guest) {
      const symposionId = session.guest.symposionId;
      const docs = await loadDocs(symposionId);
      set({ docs, view: { kind: 'symposion', symposionId, section: 'grapheion', documentId: docs[0]?.id ?? null } });
      return;
    }
    // invito nella Polis arrivato dal link: si accetta e si apre quella Polis
    const inv = session.pendingInvite;
    if (inv) {
      session.clearPendingInvite();
      const { account, profile } = me();
      try {
        const detail = await api.invite(inv.inviteId);
        const acc = await acceptInvite(inv.inviteId, inv.secret, detail, account.accountId, account.boxPk, profile);
        if (acc) {
          const { polisId } = await api.acceptInvite(inv.inviteId, acc.req);
          set({ polisList: await polisNames() });
          return get().openPolis(polisId);
        }
      } catch {
        /* invito non piu' valido: si prosegue normalmente */
      }
    }
    const list = await polisNames();
    set({ polisList: list });
    if (!list?.length) return bootstrap();
    let last: string | null = null;
    try {
      last = sessionStorage.getItem(LAST);
    } catch {
      /* niente */
    }
    await get().openPolis(list.find((p) => p.id === last)?.id ?? list[0].id);
  },

  async openPolis(id) {
    const polis = await loadPolis(id);
    try {
      sessionStorage.setItem(LAST, id);
    } catch {
      /* niente */
    }
    set({ polis, view: { kind: 'home' }, docs: null });
  },

  async go(v) {
    if (v.kind === 'home') return set({ view: v, docs: null });
    const docs = get().view.kind === 'symposion' && (get().view as { symposionId: string }).symposionId === v.symposionId && get().docs ? get().docs! : await loadDocs(v.symposionId);
    const documentId = v.documentId && docs.some((d) => d.id === v.documentId) ? v.documentId : (docs[0]?.id ?? null);
    set({ docs, view: { ...v, documentId } });
  },

  setSection(section) {
    const v = get().view;
    if (v.kind === 'symposion') set({ view: { ...v, section } });
  },

  openDocument(documentId) {
    const v = get().view;
    if (v.kind === 'symposion') set({ view: { ...v, section: 'grapheion', documentId } });
  },

  async reload() {
    const { polis, view } = get();
    const guest = useSession.getState().guest;
    try {
      if (polis && !guest) {
        const next = await loadPolis(polis.id);
        set({ polis: next });
        if (view.kind === 'symposion' && !next.symposia.some((s) => s.id === view.symposionId)) return set({ view: { kind: 'home' }, docs: null });
      }
      if (view.kind === 'symposion') {
        const docs = await loadDocs(view.symposionId);
        const documentId = view.documentId && docs.some((d) => d.id === view.documentId) ? view.documentId : (docs[0]?.id ?? null);
        set({ docs, view: { ...view, documentId } });
      }
    } catch (e) {
      // allontanati dalla Polis: si torna alle altre
      if (e instanceof ApiError && e.status === 404 && !guest) {
        set({ polis: null, view: { kind: 'home' }, polisList: await polisNames() });
        const first = get().polisList?.[0];
        if (first) await get().openPolis(first.id);
        else await bootstrap();
      }
      if (e instanceof ApiError && e.status === 401 && guest) await useSession.getState().signOut();
    }
  },

  async newPolis(name) {
    const { account, profile } = me();
    const { req } = await createPolisRequest(account.accountId, account.boxPk, name.trim(), profile);
    await api.createPolis(req);
    set({ polisList: await polisNames() });
    await get().openPolis(req.id);
  },

  async renamePolis(name) {
    const p = get().polis;
    const key = p?.ring.polis.get(p.detail.epoch);
    if (!p || !key) return;
    await api.renamePolis(p.id, await sealJson(key, { name: name.trim() } satisfies PolisMeta, AD.polisMeta(p.id), p.detail.epoch));
    set({ polisList: get().polisList?.map((x) => (x.id === p.id ? { ...x, name: name.trim() } : x)) ?? null });
  },

  async newSymposion(name) {
    const p = get().polis;
    const key = p?.ring.polis.get(p.detail.epoch);
    if (!p || !key) return;
    const { req } = await createSymposionRequest(key, p.detail.epoch, name.trim());
    await api.createSymposion(p.id, req);
    set({ polis: await loadPolis(p.id) });
    await get().go({ kind: 'symposion', symposionId: req.id, section: 'grapheion', documentId: null });
  },

  async renameSymposion(symposionId, name) {
    const key = symposionKeys(symposionId).ring.get(1);
    if (!key) return;
    await api.renameSymposion(symposionId, await sealJson(key, { name: name.trim() } satisfies SymposionMeta, AD.symposionMeta(symposionId), 1));
  },

  async deleteSymposion(symposionId) {
    await api.deleteSymposion(symposionId);
    set({ view: { kind: 'home' }, docs: null });
  },

  async newDocument() {
    const v = get().view;
    if (v.kind !== 'symposion') return;
    const { epoch, ring } = symposionKeys(v.symposionId);
    const key = ring.get(epoch);
    if (!key) return;
    const id = crypto.randomUUID();
    await api.createDocument(v.symposionId, { id, meta: await sealDocMeta(key, epoch, id, { title: '' }) });
    const docs = await loadDocs(v.symposionId);
    set({ docs, view: { ...v, section: 'grapheion', documentId: id } });
  },

  async renameDocument(documentId, title) {
    const v = get().view;
    if (v.kind !== 'symposion') return;
    const { epoch, ring } = symposionKeys(v.symposionId);
    const key = ring.get(epoch);
    if (!key) return;
    await api.renameDocument(documentId, await sealDocMeta(key, epoch, documentId, { title: title.trim() }));
    set({ docs: get().docs?.map((d) => (d.id === documentId ? { ...d, title: title.trim() } : d)) ?? null });
  },

  async deleteDocument(documentId) {
    const v = get().view;
    if (v.kind !== 'symposion') return;
    await api.deleteDocument(documentId);
    const docs = await loadDocs(v.symposionId);
    set({ docs, view: { ...v, documentId: docs[0]?.id ?? null } });
  },

  async invite() {
    const p = get().polis;
    const key = p?.ring.polis.get(p.detail.epoch);
    if (!p || !key) throw new Error('no-key');
    const { req, link } = await createInvite(location.origin, key, p.detail.epoch);
    await api.createInvite(p.id, req);
    return link;
  },

  async createGuestLink(symposionId, mode) {
    const { epoch, ring } = symposionKeys(symposionId);
    const name = get().polis?.symposia.find((s) => s.id === symposionId)?.name ?? '';
    const { req, link } = await createGuestLinkRequest(location.origin, ring, epoch, name, mode);
    await api.createGuestLink(symposionId, req);
    set({ polis: await loadPolis(get().polis!.id) });
    return link;
  },

  async revokeGuestLink(linkId) {
    await api.revokeGuestLink(linkId);
    // gli ospiti conoscevano la chiave: la si ruota subito
    set({ polis: await loadPolis(get().polis!.id) });
  },

  async setRole(accountId, role) {
    const p = get().polis;
    if (!p) return;
    await api.setRole(p.id, accountId, role);
    set({ polis: await loadPolis(p.id) });
  },

  async removeMember(accountId) {
    const p = get().polis;
    if (!p) return;
    await api.removeMember(p.id, accountId);
    if (p.members.find((m) => m.me)?.id === accountId) {
      const list = await polisNames();
      set({ polisList: list, polis: null });
      if (list?.length) await get().openPolis(list[0].id);
      else await bootstrap();
    } else set({ polis: await loadPolis(p.id) }); // qui la rotazione avviene da se'
  },

  setFocus(focus) {
    set({ focus });
  },

  /** Nuovo nome dell'utente: il profilo cifrato in ogni sua Polis. */
  async updateProfiles(name) {
    const { identity, account } = me();
    for (const s of await api.listPolis()) {
      const detail = await api.polis(s.id);
      const ring = await keyring(detail, identity);
      const key = ring.polis.get(detail.epoch);
      if (key) await api.putProfile(s.id, await sealJson(key, { name } satisfies Profile, AD.profile(s.id, account.accountId), detail.epoch));
    }
    const p = get().polis;
    if (p) set({ polis: await loadPolis(p.id) });
  },
}));

/** Primo accesso (o nessuna Polis rimasta): la propria Polis, un Symposion e un documento, gia' aperto. */
async function bootstrap() {
  const { account, profile } = me();
  const { req, key } = await createPolisRequest(account.accountId, account.boxPk, t('polis.defaultName', { name: profile.name || account.email }), profile);
  await api.createPolis(req);
  const sym = await createSymposionRequest(key, 1, t('symposion.firstName'));
  await api.createSymposion(req.id, sym.req);
  const documentId = crypto.randomUUID();
  await api.createDocument(sym.req.id, { id: documentId, meta: await sealDocMeta(sym.key, 1, documentId, { title: '' }) });
  useWork.setState({ polisList: await polisNames() });
  await useWork.getState().openPolis(req.id);
  await useWork.getState().go({ kind: 'symposion', symposionId: sym.req.id, section: 'grapheion', documentId });
}

// tempo reale: quando la Polis cambia (membri, Symposia, documenti, ospiti, chiavi) la vista si aggiorna
let reloading: Promise<void> | null = null;
let again = false;
live.onPolis((polisId) => {
  const { polis } = useWork.getState();
  const guest = useSession.getState().guest;
  if (polisId !== '*' && polis?.id !== polisId && guest?.polisId !== polisId) {
    // un'altra Polis: basta aggiornare l'elenco
    if (!guest) void polisNames().then((polisList) => useWork.setState({ polisList })).catch(() => undefined);
    return;
  }
  if (reloading) {
    again = true;
    return;
  }
  reloading = useWork
    .getState()
    .reload()
    .catch(() => undefined)
    .finally(() => {
      reloading = null;
      if (again) {
        again = false;
        void useWork.getState().reload();
      }
    });
});

/** Per gli ospiti: nuove persone entrate nel Symposion (chiavi pubbliche per verificare le firme). */
live.onPolis(() => {
  const { guest } = useSession.getState();
  if (!guest) return;
  void api
    .guestMe()
    .then((ctx) => useSession.setState({ guest: { ...guest, people: ctx.people } }))
    .catch(() => undefined);
});
