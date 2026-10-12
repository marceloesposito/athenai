// Relay per il collegamento dei dispositivi. In questa fase (P1) c'e' solo quello locale, fra schede
// e finestre dello stesso browser (BroadcastChannel): serve a provare il protocollo. Fra dispositivi
// diversi lo fara' il server di Athenai (P2), che vedra' solo il messaggio cifrato.
import type { LinkRelay } from './deviceLink';

export function localRelay(): LinkRelay {
  return {
    async send(channel, message) {
      const bc = new BroadcastChannel(`athenai-link-${channel}`);
      bc.postMessage(message);
      bc.close();
    },
    receive(channel, signal) {
      return new Promise((resolve, reject) => {
        const bc = new BroadcastChannel(`athenai-link-${channel}`);
        const stop = () => {
          bc.close();
          reject(new DOMException('aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', stop, { once: true });
        bc.onmessage = (e) => {
          signal?.removeEventListener('abort', stop);
          bc.close();
          resolve(String(e.data));
        };
      });
    },
  };
}
