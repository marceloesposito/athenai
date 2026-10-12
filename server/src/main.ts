import { loadConfig } from './config.ts';
import { connect, migrate } from './db.ts';
import { buildApp } from './app.ts';

const cfg = loadConfig();
const sql = connect(cfg.databaseUrl);
await migrate(sql);
const app = await buildApp(cfg, sql);
await app.listen({ port: cfg.port, host: '0.0.0.0' });
console.log(`Athenai server su :${cfg.port}${cfg.allowTrial ? ' (modalita\' di prova: account senza OIDC ammessi)' : ''}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
