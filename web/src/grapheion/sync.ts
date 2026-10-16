// Sincronizzazione cifrata di un documento (sul modello di secsync): due documenti Yjs, il testo e gli
// Scholia, piu' la presenza (awareness) sul testo. Le modifiche locali si raccolgono per qualche
// decina di millisecondi, si uniscono, si cifrano e si firmano, e partono una alla volta; quelle
// degli altri arrivano dal registro, si verificano e si aprono. Ogni tanto chi puo' scrivere manda
// uno stato intero che sostituisce le voci gia' unite: il registro sul server resta corto.
// Il trasporto e' astratto (WebSocket nel browser, un server finto nei test).
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as decoding from 'lib0/decoding';
import type { LogEntry, SealedBox, Stream, EntryKind, ClientMessage } from '@athenai/protocol';
import { sealEntry, openEntry, sealAwareness, openAwareness, type EpochKeys } from '../crypto/docs';

export type PushRequest = Omit<Extract<ClientMessage, { t: 'push' }>, 't' | 'ref'>;

export interface DocHandlers {
  /** il registro intero (all'iscrizione e a ogni riconnessione) */
  log(entries: LogEntry[]): void;
  entry(e: LogEntry): void;
  aw(from: string, cid: string, box: SealedBox | null): void;
}

export interface Transport {
  subscribe(documentId: string, h: DocHandlers): () => void;
  /** risolve con il numero della voce; rifiuta con Error(codice) */
  push(req: PushRequest): Promise<number>;
  aw(documentId: string, box: SealedBox | null): void;
}

export interface SyncOptions {
  documentId: string;
  accountId: string;
  signSk: Uint8Array;
  /** le chiavi del Symposion: l'epoca attuale (con cui si scrive) e tutte quelle che so aprire */
  keys(): { epoch: number; ring: EpochKeys };
  signPkOf(accountId: string): string | undefined;
  transport: Transport;
  /** posso scrivere in questo flusso? (il server lo controlla comunque) */
  canPush(stream: Stream): boolean;
  /** chiavi da ricaricare (epoca cambiata o voce illeggibile): risolve quando sono pronte */
  refreshKeys(): Promise<void>;
  /** ogni quante voci si manda uno stato intero */
  snapshotEvery?: number;
  /** quanto aspettare senza voci nuove prima dello stato intero (ms) */
  quietMs?: number;
  batchMs?: number;
}

export type SyncStatus = 'connecting' | 'synced' | 'saving' | 'error';

const REMOTE = Symbol('remote');

interface StreamState {
  doc: Y.Doc;
  pending: Uint8Array[];
  inflight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** voci nel registro dall'ultimo stato intero */
  since: number;
  /** il numero piu' alto fra le voci gia' unite */
  maxSeq: number;
  lastRecv: number;
  snapTimer: ReturnType<typeof setTimeout> | null;
  /** voci che non si sono aperte (chiave mancante): si riprovano dopo aver ricaricato le chiavi */
  unreadable: LogEntry[];
}

/** Gli id dei client contenuti in un aggiornamento della presenza. */
function awarenessClients(update: Uint8Array): number[] {
  const d = decoding.createDecoder(update);
  const n = decoding.readVarUint(d);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(decoding.readVarUint(d));
    decoding.readVarUint(d);
    decoding.readVarString(d);
  }
  return ids;
}

export class DocSync {
  readonly text = new Y.Doc();
  readonly scholia = new Y.Doc();
  readonly awareness: Awareness;
  status: SyncStatus = 'connecting';
  /** voci che nessuna chiave apre o con firma falsa (ignorate) */
  rejected = 0;
  readonly loaded: Promise<void>;

  private o: Required<Pick<SyncOptions, 'snapshotEvery' | 'quietMs' | 'batchMs'>> & SyncOptions;
  private streams: Record<Stream, StreamState>;
  private unsubscribe: () => void;
  private listeners = new Set<() => void>();
  private peers = new Map<string, number[]>();
  private awTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveLoaded!: () => void;
  private closed = false;
  private refreshing: Promise<void> | null = null;

  constructor(opts: SyncOptions) {
    this.o = { snapshotEvery: 50, quietMs: 2000, batchMs: 120, ...opts };
    this.awareness = new Awareness(this.text);
    this.loaded = new Promise((r) => (this.resolveLoaded = r));
    const state = (doc: Y.Doc): StreamState => ({ doc, pending: [], inflight: false, timer: null, since: 0, maxSeq: 0, lastRecv: 0, snapTimer: null, unreadable: [] });
    this.streams = { text: state(this.text), scholia: state(this.scholia) };
    for (const stream of ['text', 'scholia'] as const) {
      this.streams[stream].doc.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin === REMOTE || this.closed || !this.o.canPush(stream)) return;
        this.queue(stream, u);
      });
    }
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === REMOTE) return;
      if ([...added, ...updated, ...removed].includes(this.text.clientID)) this.sendAwareness();
    });
    this.unsubscribe = this.o.transport.subscribe(this.o.documentId, {
      log: (entries) => void this.onLog(entries),
      entry: (e) => void this.onEntry(e),
      aw: (from, cid, box) => void this.onAwareness(from, cid, box),
    });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private setStatus(s: SyncStatus) {
    if (this.status === s) return;
    this.status = s;
    this.listeners.forEach((l) => l());
  }

  private updateStatus() {
    const busy = Object.values(this.streams).some((s) => s.inflight || s.pending.length);
    if (this.status !== 'error') this.setStatus(busy ? 'saving' : 'synced');
  }

  // ---------------------------------------------------------------- in arrivo

  private async apply(e: LogEntry, st: StreamState): Promise<boolean> {
    const { ring } = this.o.keys();
    const data = await openEntry(this.o.documentId, e, ring, this.o.signPkOf);
    if (!data) return false;
    Y.applyUpdate(st.doc, data, REMOTE);
    st.maxSeq = Math.max(st.maxSeq, e.seq);
    return true;
  }

  private async onLog(entries: LogEntry[]) {
    for (const st of Object.values(this.streams)) {
      st.since = 0;
      st.unreadable = [];
    }
    for (const e of entries) {
      const st = this.streams[e.stream];
      st.since = e.kind === 'snapshot' ? 1 : st.since + 1;
      if (!(await this.apply(e, st))) st.unreadable.push(e);
    }
    await this.retryUnreadable();
    this.resolveLoaded();
    this.updateStatus();
    // dopo una riconnessione: riparte quello che era rimasto da mandare
    for (const stream of ['text', 'scholia'] as const) this.flush(stream);
    // e chi c'e' vede subito anche me
    this.sendAwareness();
  }

  private async onEntry(e: LogEntry) {
    const st = this.streams[e.stream];
    st.since = e.kind === 'snapshot' ? 1 : st.since + 1;
    st.lastRecv = Date.now();
    if (!(await this.apply(e, st))) {
      st.unreadable.push(e);
      await this.retryUnreadable();
    }
    this.scheduleSnapshot(e.stream);
  }

  /** Voci illeggibili: forse e' cambiata l'epoca. Si ricaricano le chiavi una volta e si riprova. */
  private async retryUnreadable() {
    if (!Object.values(this.streams).some((s) => s.unreadable.length)) return;
    await this.refresh();
    for (const st of Object.values(this.streams)) {
      const left: LogEntry[] = [];
      for (const e of st.unreadable) if (!(await this.apply(e, st))) left.push(e);
      this.rejected += left.length;
      st.unreadable = [];
    }
  }

  private refresh() {
    return (this.refreshing ??= this.o.refreshKeys().finally(() => (this.refreshing = null)));
  }

  // ---------------------------------------------------------------- in uscita

  private queue(stream: Stream, u: Uint8Array) {
    const st = this.streams[stream];
    st.pending.push(u);
    this.setStatus('saving');
    if (!st.timer) st.timer = setTimeout(() => this.flush(stream), this.o.batchMs);
  }

  private flush(stream: Stream) {
    const st = this.streams[stream];
    if (st.timer) clearTimeout(st.timer);
    st.timer = null;
    if (st.inflight || !st.pending.length || this.closed) return;
    const update = st.pending.length === 1 ? st.pending[0] : Y.mergeUpdates(st.pending);
    st.pending = [];
    st.inflight = true;
    void this.send(stream, 'update', update)
      .then((seq) => {
        st.maxSeq = Math.max(st.maxSeq, seq);
        st.since++;
        this.setStatus('saving');
        this.scheduleSnapshot(stream);
      })
      .catch(async (err: Error) => {
        // la modifica non e' persa: torna in coda
        st.pending.unshift(update);
        if (err.message === 'stale-key') await this.refresh();
        else if (err.message === 'forbidden') {
          st.pending = [];
          this.setStatus('error');
        } else await new Promise((r) => setTimeout(r, 1000));
      })
      .finally(() => {
        st.inflight = false;
        if (st.pending.length && this.status !== 'error') this.flush(stream);
        this.updateStatus();
      });
  }

  private async send(stream: Stream, kind: EntryKind, data: Uint8Array, covers?: number): Promise<number> {
    const { epoch, ring } = this.o.keys();
    const key = ring.get(epoch);
    if (!key) throw new Error('stale-key');
    const { box, sig } = await sealEntry(key, epoch, this.o.documentId, stream, kind, this.o.accountId, data, this.o.signSk);
    return this.o.transport.push({ documentId: this.o.documentId, stream, kind, box, sig, ...(kind === 'snapshot' ? { covers } : {}) });
  }

  /**
   * Stato intero quando il registro si allunga e c'e' quiete: copre solo le voci gia' unite (fino a
   * maxSeq). Chi non puo' scrivere in quel flusso non lo manda.
   */
  private scheduleSnapshot(stream: Stream) {
    const st = this.streams[stream];
    if (st.since < this.o.snapshotEvery || !this.o.canPush(stream) || st.snapTimer || this.closed) return;
    st.snapTimer = setTimeout(() => {
      st.snapTimer = null;
      if (Date.now() - st.lastRecv < this.o.quietMs || st.inflight || st.pending.length) return this.scheduleSnapshot(stream);
      if (st.since < this.o.snapshotEvery) return;
      const covers = st.maxSeq;
      st.inflight = true;
      void this.send(stream, 'snapshot', Y.encodeStateAsUpdate(st.doc), covers)
        .then((seq) => {
          st.maxSeq = Math.max(st.maxSeq, seq);
          st.since = 1;
        })
        .catch(() => undefined)
        .finally(() => {
          st.inflight = false;
          this.flush(stream);
        });
    }, this.o.quietMs);
  }

  // ---------------------------------------------------------------- presenza

  private sendAwareness() {
    if (this.awTimer || this.closed) return;
    this.awTimer = setTimeout(async () => {
      this.awTimer = null;
      const { epoch, ring } = this.o.keys();
      const key = ring.get(epoch);
      if (!key || this.closed) return;
      const update = encodeAwarenessUpdate(this.awareness, [this.text.clientID]);
      this.o.transport.aw(this.o.documentId, await sealAwareness(key, epoch, this.o.documentId, this.o.accountId, update));
    }, 80);
  }

  private async onAwareness(from: string, cid: string, box: SealedBox | null) {
    if (!box) {
      const ids = this.peers.get(cid);
      this.peers.delete(cid);
      if (ids?.length) removeAwarenessStates(this.awareness, ids, REMOTE);
      return;
    }
    const update = await openAwareness(this.o.keys().ring, this.o.documentId, from, box);
    if (!update) return;
    const isNew = !this.peers.has(cid);
    try {
      // una connessione parla solo per se': niente stati di altri client mescolati
      const ids = awarenessClients(update).filter((id) => id !== this.text.clientID);
      this.peers.set(cid, ids);
      applyAwarenessUpdate(this.awareness, update, REMOTE);
    } catch {
      return;
    }
    if (isNew) this.sendAwareness();
  }

  /** persone presenti in questo documento (oltre a me), dalla presenza */
  presentAccounts(): Map<number, { name?: string; color?: string }> {
    const out = new Map<number, { name?: string; color?: string }>();
    for (const [id, st] of this.awareness.getStates()) if (id !== this.text.clientID && st.user) out.set(id, st.user as { name?: string; color?: string });
    return out;
  }

  destroy() {
    if (this.closed) return;
    // le modifiche ancora in coda partono prima di chiudere
    for (const stream of ['text', 'scholia'] as const) this.flush(stream);
    this.closed = true;
    for (const st of Object.values(this.streams)) {
      if (st.timer) clearTimeout(st.timer);
      if (st.snapTimer) clearTimeout(st.snapTimer);
    }
    if (this.awTimer) clearTimeout(this.awTimer);
    this.o.transport.aw(this.o.documentId, null);
    this.unsubscribe();
    this.awareness.destroy();
    this.listeners.clear();
  }
}
