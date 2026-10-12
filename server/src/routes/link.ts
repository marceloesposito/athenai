// Relay per il collegamento dei dispositivi: un messaggio cifrato (sealed box) per canale, tenuto
// in memoria al massimo 10 minuti. Senza sessione: il nuovo dispositivo non ha ancora le chiavi; il
// canale e' casuale (128 bit) e il messaggio e' leggibile solo dal dispositivo che l'ha chiesto.
import type { FastifyInstance } from 'fastify';
import { isB64url } from '@athenai/protocol';

const TTL = 10 * 60_000;
const MAX_WAIT = 25_000;

export function linkRoutes(app: FastifyInstance) {
  const box = new Map<string, { message: string; expires: number }>();
  const waiting = new Map<string, Set<(m: string) => void>>();
  const sweep = () => {
    const now = Date.now();
    for (const [k, v] of box) if (v.expires < now) box.delete(k);
  };

  app.post('/v1/link/:channel', async (req, reply) => {
    const { channel } = req.params as { channel: string };
    const b = req.body as { message?: string };
    if (!isB64url(channel, 32) || !isB64url(b?.message, 512)) return reply.code(400).send({ error: 'bad-request' });
    sweep();
    if (box.size > 5000) return reply.code(503).send({ error: 'busy' });
    const ws = waiting.get(channel);
    if (ws?.size) {
      for (const w of ws) w(b.message);
      waiting.delete(channel);
    } else box.set(channel, { message: b.message, expires: Date.now() + TTL });
    return { ok: true };
  });

  /** Attesa lunga: risponde appena arriva il messaggio, o 204 dopo 25 secondi. */
  app.get('/v1/link/:channel', async (req, reply) => {
    const { channel } = req.params as { channel: string };
    if (!isB64url(channel, 32)) return reply.code(400).send({ error: 'bad-request' });
    sweep();
    const ready = box.get(channel);
    if (ready) {
      box.delete(channel);
      return { message: ready.message };
    }
    const message = await new Promise<string | null>((resolve) => {
      const set = waiting.get(channel) ?? new Set();
      waiting.set(channel, set);
      const done = (m: string | null) => {
        clearTimeout(timer);
        set.delete(fn);
        resolve(m);
      };
      const fn = (m: string) => done(m);
      const timer = setTimeout(() => done(null), MAX_WAIT);
      set.add(fn);
      req.raw.on('close', () => done(null));
    });
    if (message === null) return reply.code(204).send();
    return { message };
  });
}
