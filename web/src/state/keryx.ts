// Keryx: le notifiche dell'utente (per ora le @menzioni negli Scholia). Arrivano cifrate verso la sua
// chiave; qui si aprono, si verifica chi le ha mandate e si arricchiscono con i nomi della Polis.
// Aprirne una porta al Tomos e la cancella dal server.
import { create } from 'zustand';
import { AD, type KeryxNotice } from '@athenai/protocol';
import { api } from '../api/client';
import { live } from '../live/socket';
import { useSession } from './session';
import { usePolis } from './polis';
import { keyring, openJson, type Profile, type PolisMeta } from '../crypto/polis';
import { openNotice, sealNotice, openTomosMeta } from '../crypto/tomos';

export interface KeryxEntry {
  id: string;
  notice: KeryxNotice;
  from: string;
  polis: string;
  tomos: string;
}

interface KeryxState {
  items: KeryxEntry[];
  load(): Promise<void>;
  open(id: string): Promise<void>;
  dismissAll(): Promise<void>;
}

/** Nomi e chiavi pubbliche di una Polis, per verificare e mostrare le notifiche. */
async function polisInfo(polisId: string) {
  const { identity } = useSession.getState();
  if (!identity) return null;
  const detail = await api.polis(polisId);
  const ring = await keyring(detail, identity);
  const members = new Map<string, { signPk: string; name: string }>();
  for (const m of detail.members) {
    const profile = await openJson<Profile>(m.profile ? ring.polis.get(m.profile.e) : undefined, m.profile, AD.profile(polisId, m.accountId));
    members.set(m.accountId, { signPk: m.signPk, name: profile?.name ?? '…' });
  }
  const name = (await openJson<PolisMeta>(ring.polis.get(detail.meta.e), detail.meta, AD.polisMeta(polisId)))?.name ?? '…';
  return { name, members, detail, ring };
}

export const useKeryx = create<KeryxState>((set, get) => ({
  items: [],

  async load() {
    const { identity, account } = useSession.getState();
    if (!identity || !account) return;
    const raw = await api.keryx().catch(() => null);
    if (!raw) return;
    const infos = new Map<string, Promise<Awaited<ReturnType<typeof polisInfo>>>>();
    const info = (polisId: string) => {
      if (!infos.has(polisId)) infos.set(polisId, polisInfo(polisId).catch(() => null));
      return infos.get(polisId)!;
    };
    const items: KeryxEntry[] = [];
    for (const r of raw) {
      const notice = await openNotice(r.sealed, identity, account.accountId, async (p, a) => (await info(p))?.members.get(a)?.signPk);
      if (!notice) {
        // illeggibile o non autentica: non serve tenerla
        void api.dropKeryx(r.id).catch(() => undefined);
        continue;
      }
      const pi = await info(notice.polisId);
      let tomos = '';
      try {
        const o = pi?.detail.oikos.find((x) => x.id === notice.oikosId);
        const t = o ? (await api.listTomos(o.id)).find((x) => x.id === notice.tomosId) : undefined;
        if (t && pi) tomos = (await openTomosMeta(pi.ring.oikos.get(o!.id) ?? new Map(), t.id, t.meta))?.title ?? '';
      } catch {
        /* il Tomos puo' non esserci piu' */
      }
      items.push({ id: r.id, notice, from: pi?.members.get(notice.from)?.name ?? '…', polis: pi?.name ?? '…', tomos });
    }
    set({ items });
  },

  async open(id) {
    const it = get().items.find((x) => x.id === id);
    if (!it) return;
    set({ items: get().items.filter((x) => x.id !== id) });
    await api.dropKeryx(id).catch(() => undefined);
    const { polisId, oikosId, tomosId, scholionId } = it.notice;
    usePolis.getState().setFocus(scholionId ?? null);
    await usePolis.getState().go({ kind: 'tomos', id: polisId, oikosId, tomosId }).catch(() => undefined);
  },

  async dismissAll() {
    set({ items: [] });
    await api.dropAllKeryx().catch(() => undefined);
  },
}));

/** Manda una notifica di menzione a ciascun account (membri della Polis aperta, me escluso). */
export async function notifyMentions(accountIds: string[], where: { polisId: string; oikosId: string; tomosId: string; scholionId: string }, text: string) {
  const { identity, account } = useSession.getState();
  const cur = usePolis.getState().current;
  if (!identity || !account || !cur) return;
  const to = cur.members.filter((m) => accountIds.includes(m.accountId) && !m.me);
  if (!to.length) return;
  const notice: KeryxNotice = { kind: 'mention', ...where, from: account.accountId, excerpt: text, at: new Date().toISOString() };
  const sealed = await Promise.all(to.map(async (m) => ({ accountId: m.accountId, sealed: await sealNotice(notice, m, identity.sign.privateKey) })));
  await api.sendKeryx(where.polisId, { to: sealed });
}

// le notifiche si caricano quando la connessione e' pronta e quando ne arriva una nuova
live.onStatus((online) => online && void useKeryx.getState().load());
live.onKeryx(() => void useKeryx.getState().load());
