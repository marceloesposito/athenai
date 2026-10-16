// Notifiche dell'utente (per ora le @menzioni nei commenti). Arrivano cifrate verso la sua chiave;
// qui si aprono, si verifica chi le ha mandate e si arricchiscono con i nomi. Aprirne una porta al
// documento (e al commento) e la cancella dal server.
import { create } from 'zustand';
import { AD, type Notice } from '@athenai/protocol';
import { api } from '../api/client';
import { live } from '../live/socket';
import { useSession } from './session';
import { useWork, myRole } from './work';
import { keyring, openJson, type Profile, type PolisMeta } from '../crypto/polis';
import { openNotice, sealNotice, openDocMeta } from '../crypto/docs';

export interface NoticeEntry {
  id: string;
  notice: Notice;
  from: string;
  polis: string;
  document: string;
}

interface NoticesState {
  items: NoticeEntry[];
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
  return { name, members, ring };
}

export const useNotices = create<NoticesState>((set, get) => ({
  items: [],

  async load() {
    const { identity, account } = useSession.getState();
    if (!identity || !account) return;
    const raw = await api.notices().catch(() => null);
    if (!raw) return;
    const infos = new Map<string, Promise<Awaited<ReturnType<typeof polisInfo>>>>();
    const info = (polisId: string) => {
      if (!infos.has(polisId)) infos.set(polisId, polisInfo(polisId).catch(() => null));
      return infos.get(polisId)!;
    };
    const items: NoticeEntry[] = [];
    for (const r of raw) {
      const notice = await openNotice(r.sealed, identity, account.accountId, async (p, a) => (await info(p))?.members.get(a)?.signPk);
      if (!notice) {
        // illeggibile o non autentica: non serve tenerla
        void api.dropNotice(r.id).catch(() => undefined);
        continue;
      }
      const pi = await info(notice.polisId);
      let document = '';
      try {
        const d = (await api.documents(notice.symposionId)).find((x) => x.id === notice.documentId);
        if (d && pi) document = (await openDocMeta(pi.ring.symposia.get(notice.symposionId) ?? new Map(), d.id, d.meta))?.title ?? '';
      } catch {
        /* il documento puo' non esserci piu' */
      }
      items.push({ id: r.id, notice, from: pi?.members.get(notice.from)?.name ?? '…', polis: pi?.name ?? '…', document });
    }
    set({ items });
  },

  async open(id) {
    const it = get().items.find((x) => x.id === id);
    if (!it) return;
    set({ items: get().items.filter((x) => x.id !== id) });
    await api.dropNotice(id).catch(() => undefined);
    const { polisId, symposionId, documentId, scholionId } = it.notice;
    const work = useWork.getState();
    work.setFocus(scholionId ?? null);
    if (work.polis?.id !== polisId) await work.openPolis(polisId).catch(() => undefined);
    await useWork.getState().go({ kind: 'symposion', symposionId, section: 'grapheion', documentId }).catch(() => undefined);
  },

  async dismissAll() {
    set({ items: [] });
    await api.dropAllNotices().catch(() => undefined);
  },
}));

/** Avvisa con una notifica i membri menzionati (non gli ospiti, che non hanno un account). */
export async function notifyMentions(accountIds: string[], where: { symposionId: string; documentId: string; scholionId: string }, text: string) {
  const { identity, account } = useSession.getState();
  const polis = useWork.getState().polis;
  if (!identity || !account || !polis || myRole().role === 'xenos') return;
  const to = polis.members.filter((m) => accountIds.includes(m.id) && !m.me);
  if (!to.length) return;
  const notice: Notice = { kind: 'mention', polisId: polis.id, ...where, from: account.accountId, excerpt: text, at: new Date().toISOString() };
  const sealed = await Promise.all(to.map(async (m) => ({ accountId: m.id, sealed: await sealNotice(notice, { accountId: m.id, boxPk: m.boxPk }, identity.sign.privateKey) })));
  await api.sendNotices(polis.id, { to: sealed });
}

// le notifiche si caricano quando la connessione e' pronta e quando ne arriva una nuova
live.onStatus((online) => online && void useNotices.getState().load());
live.onNotice(() => void useNotices.getState().load());
