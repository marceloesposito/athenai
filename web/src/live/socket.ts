// Connessione in tempo reale con il server (/v1/live): una per scheda, aperta finche' la sessione e'
// aperta. Porta il registro dei documenti aperti, la presenza e gli avvisi (Polis cambiata, notifiche).
// Si riconnette da sola; a ogni riconnessione si reiscrive ai documenti e riceve di nuovo il registro.
import type { ClientMessage, ServerMessage, SealedBox } from '@athenai/protocol';
import { API_BASE, onToken } from '../api/client';
import type { Transport, DocHandlers, PushRequest } from '../grapheion/sync';

type Listener<T> = (x: T) => void;

class Live implements Transport {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private ready = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private ref = 0;
  private pushes = new Map<number, { resolve: (seq: number) => void; reject: (e: Error) => void }>();
  private docs = new Map<string, Set<DocHandlers>>();
  private polisListeners = new Set<Listener<string>>();
  private noticeListeners = new Set<Listener<void>>();
  private statusListeners = new Set<Listener<boolean>>();
  private unauthorizedListeners = new Set<Listener<void>>();

  start(token: string) {
    if (this.token === token && this.ws) return;
    this.stop();
    this.token = token;
    this.connect();
  }

  stop() {
    this.token = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    this.down();
  }

  get online() {
    return this.ready;
  }

  private url() {
    const base = API_BASE || location.origin;
    return `${base.replace(/^http/, 'ws')}/v1/live`;
  }

  private connect() {
    if (!this.token) return;
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => this.raw({ t: 'auth', token: this.token! });
    ws.onmessage = (ev) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(m);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.down();
      // sessione non valida (scaduta, o link dell'ospite revocato): niente tentativi a vuoto
      if (ev.code === 4401) {
        this.token = null;
        this.unauthorizedListeners.forEach((l) => l());
        return;
      }
      if (!this.token) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private down() {
    if (this.ready) {
      this.ready = false;
      this.statusListeners.forEach((l) => l(false));
    }
    for (const p of this.pushes.values()) p.reject(new Error('offline'));
    this.pushes.clear();
  }

  private handle(m: ServerMessage) {
    switch (m.t) {
      case 'ready':
        this.ready = true;
        this.retry = 0;
        this.statusListeners.forEach((l) => l(true));
        for (const id of this.docs.keys()) this.raw({ t: 'sub', documentId: id });
        // durante la disconnessione la Polis puo' essere cambiata
        this.polisListeners.forEach((l) => l('*'));
        return;
      case 'log':
        this.docs.get(m.documentId)?.forEach((h) => h.log(m.entries));
        return;
      case 'entry':
        this.docs.get(m.documentId)?.forEach((h) => h.entry(m.entry));
        return;
      case 'aw':
        this.docs.get(m.documentId)?.forEach((h) => h.aw(m.from, m.cid, m.box));
        return;
      case 'ack':
        this.pushes.get(m.ref)?.resolve(m.seq);
        this.pushes.delete(m.ref);
        return;
      case 'err':
        if (m.ref !== undefined) {
          this.pushes.get(m.ref)?.reject(new Error(m.error));
          this.pushes.delete(m.ref);
        }
        return;
      case 'polis':
        this.polisListeners.forEach((l) => l(m.polisId));
        return;
      case 'notice':
        this.noticeListeners.forEach((l) => l());
        return;
    }
  }

  private raw(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  // ---------------------------------------------------------------- Transport

  subscribe(documentId: string, h: DocHandlers) {
    const set = this.docs.get(documentId) ?? new Set();
    set.add(h);
    this.docs.set(documentId, set);
    // anche un secondo iscritto allo stesso documento deve ricevere il registro: si chiede di nuovo
    if (this.ready) this.raw({ t: 'sub', documentId });
    return () => {
      set.delete(h);
      if (!set.size) {
        this.docs.delete(documentId);
        this.raw({ t: 'unsub', documentId });
      }
    };
  }

  push(req: PushRequest): Promise<number> {
    if (!this.ready) return Promise.reject(new Error('offline'));
    const ref = ++this.ref;
    return new Promise((resolve, reject) => {
      this.pushes.set(ref, { resolve, reject });
      this.raw({ t: 'push', ref, ...req });
    });
  }

  aw(documentId: string, box: SealedBox | null) {
    if (this.ready) this.raw({ t: 'aw', documentId, box });
  }

  // ---------------------------------------------------------------- avvisi

  onPolis(fn: Listener<string>) {
    this.polisListeners.add(fn);
    return () => void this.polisListeners.delete(fn);
  }

  onNotice(fn: Listener<void>) {
    this.noticeListeners.add(fn);
    return () => void this.noticeListeners.delete(fn);
  }

  /** il server ha chiuso la sessione */
  onUnauthorized(fn: Listener<void>) {
    this.unauthorizedListeners.add(fn);
    return () => void this.unauthorizedListeners.delete(fn);
  }

  onStatus(fn: Listener<boolean>) {
    this.statusListeners.add(fn);
    return () => void this.statusListeners.delete(fn);
  }
}

export const live = new Live();

// la connessione segue la sessione: si apre con il token e si chiude quando si blocca o si esce
onToken((t) => (t ? live.start(t) : live.stop()));
