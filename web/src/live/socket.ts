// Connessione in tempo reale con il server (/v1/live): una per scheda, aperta finche' la sessione e'
// sbloccata. Porta il registro dei Tomos aperti, la presenza e gli avvisi (Polis cambiata, Keryx).
// Si riconnette da sola; a ogni riconnessione si reiscrive ai Tomos e riceve di nuovo il registro.
import type { ClientMessage, ServerMessage, SealedBox } from '@athenai/protocol';
import { API_BASE, onToken } from '../api/client';
import type { Transport, TomosHandlers, PushRequest } from '../grapheion/sync';

type Listener<T> = (x: T) => void;

class Live implements Transport {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private ready = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private ref = 0;
  private pushes = new Map<number, { resolve: (seq: number) => void; reject: (e: Error) => void }>();
  private tomos = new Map<string, Set<TomosHandlers>>();
  private polisListeners = new Set<Listener<string>>();
  private keryxListeners = new Set<Listener<void>>();
  private statusListeners = new Set<Listener<boolean>>();

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
      // sessione non valida: niente tentativi a vuoto
      if (ev.code === 4401 || !this.token) return;
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
        for (const id of this.tomos.keys()) this.raw({ t: 'sub', tomosId: id });
        // durante la disconnessione la Polis puo' essere cambiata
        this.polisListeners.forEach((l) => l('*'));
        return;
      case 'log':
        this.tomos.get(m.tomosId)?.forEach((h) => h.log(m.entries));
        return;
      case 'entry':
        this.tomos.get(m.tomosId)?.forEach((h) => h.entry(m.entry));
        return;
      case 'aw':
        this.tomos.get(m.tomosId)?.forEach((h) => h.aw(m.from, m.cid, m.box));
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
      case 'keryx':
        this.keryxListeners.forEach((l) => l());
        return;
    }
  }

  private raw(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  // ---------------------------------------------------------------- Transport

  subscribe(tomosId: string, h: TomosHandlers) {
    const set = this.tomos.get(tomosId) ?? new Set();
    set.add(h);
    this.tomos.set(tomosId, set);
    // anche un secondo iscritto allo stesso Tomos deve ricevere il registro: si chiede di nuovo
    if (this.ready) this.raw({ t: 'sub', tomosId });
    return () => {
      set.delete(h);
      if (!set.size) {
        this.tomos.delete(tomosId);
        this.raw({ t: 'unsub', tomosId });
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

  aw(tomosId: string, box: SealedBox | null) {
    if (this.ready) this.raw({ t: 'aw', tomosId, box });
  }

  // ---------------------------------------------------------------- avvisi

  onPolis(fn: Listener<string>) {
    this.polisListeners.add(fn);
    return () => void this.polisListeners.delete(fn);
  }

  onKeryx(fn: Listener<void>) {
    this.keryxListeners.add(fn);
    return () => void this.keryxListeners.delete(fn);
  }

  onStatus(fn: Listener<boolean>) {
    this.statusListeners.add(fn);
    return () => void this.statusListeners.delete(fn);
  }
}

export const live = new Live();

// la connessione segue la sessione: si apre con il token e si chiude quando si blocca o si esce
onToken((t) => (t ? live.start(t) : live.stop()));
