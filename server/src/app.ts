// Server di Athenai: API minime + relay, e (se configurato) l'app web compilata.
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { MAX_SNAPSHOT } from '@athenai/protocol';
import { resolve } from 'node:path';
import type { Config } from './config.ts';
import type { Sql } from './db.ts';
import { Auth } from './auth.ts';
import { accountRoutes } from './routes/accounts.ts';
import { polisRoutes } from './routes/polis.ts';
import { linkRoutes } from './routes/link.ts';
import { tomosRoutes } from './routes/tomos.ts';
import { keryxRoutes } from './routes/keryx.ts';
import { Hub, liveRoutes } from './live.ts';

export async function buildApp(cfg: Config, sql: Sql): Promise<FastifyInstance> {
  // nessun log delle richieste con corpo o intestazioni: solo errori del server
  const app = Fastify({ logger: { level: 'error' }, bodyLimit: 256 * 1024, trustProxy: true });
  const auth = new Auth(cfg, sql);
  const hub = new Hub(sql);
  // uno stato intero di un Tomos puo' superare il limite delle richieste normali
  await app.register(fastifyWebsocket, { options: { maxPayload: MAX_SNAPSHOT + 64 * 1024 } });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  });

  app.get('/v1/health', async () => ({ ok: true }));
  accountRoutes(app, sql, auth);
  polisRoutes(app, sql, auth, hub);
  tomosRoutes(app, sql, auth, hub);
  keryxRoutes(app, sql, auth, hub);
  liveRoutes(app, sql, auth, hub);
  linkRoutes(app);

  if (cfg.staticDir) {
    const root = resolve(cfg.staticDir);
    await app.register(fastifyStatic, { root, wildcard: false });
    // app a pagina singola: ogni percorso che non e' un file o un'API apre index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/v1/')) return reply.type('text/html').sendFile('index.html');
      return reply.code(404).send({ error: 'not-found' });
    });
  }
  return app;
}
