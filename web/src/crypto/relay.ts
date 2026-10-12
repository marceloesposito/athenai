// Relay per il collegamento dei dispositivi: il server di Athenai, che vede solo il messaggio cifrato.
import type { LinkRelay } from './deviceLink';
import { api } from '../api/client';

export function serverRelay(): LinkRelay {
  return {
    async send(channel, message) {
      await api.linkSend(channel, message);
    },
    async receive(channel, signal) {
      for (;;) {
        const r = await api.linkReceive(channel, signal);
        if (r?.message) return r.message;
      }
    },
  };
}
