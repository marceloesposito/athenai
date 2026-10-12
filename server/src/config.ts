// Configurazione dalle variabili d'ambiente (vedi deploy/compose.yml).
export interface Config {
  port: number;
  databaseUrl: string;
  /** Zitadel: emittente e client id dell'app (audience dei token) */
  oidcIssuer?: string;
  oidcAudience?: string;
  /** server di prova: accetta account senza OIDC (mai in produzione) */
  allowTrial: boolean;
  /** cartella dell'app web compilata, servita dallo stesso server */
  staticDir?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL mancante');
  const cfg: Config = {
    port: Number(env.PORT ?? 8787),
    databaseUrl,
    oidcIssuer: env.OIDC_ISSUER || undefined,
    oidcAudience: env.OIDC_AUDIENCE || undefined,
    allowTrial: env.ALLOW_TRIAL === 'true',
    staticDir: env.STATIC_DIR || undefined,
  };
  if (!cfg.oidcIssuer && !cfg.allowTrial) throw new Error('Configurare OIDC_ISSUER oppure, solo per prova, ALLOW_TRIAL=true');
  return cfg;
}
