// Configurazione dalle variabili d'ambiente (vedi deploy/compose.yml).
export interface Config {
  port: number;
  databaseUrl: string;
  /** chiunque puo' registrarsi (ALLOW_SIGNUP=false per un server privato) */
  allowSignup: boolean;
  /** segreto del server: rende stabili i parametri finti restituiti per email sconosciute */
  secret: string;
  /** cartella dell'app web compilata, servita dallo stesso server */
  staticDir?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL mancante');
  return {
    port: Number(env.PORT ?? 8787),
    databaseUrl,
    allowSignup: env.ALLOW_SIGNUP !== 'false',
    // senza SERVER_SECRET se ne usa uno casuale: i parametri finti cambiano a ogni riavvio
    secret: env.SERVER_SECRET || crypto.randomUUID(),
    staticDir: env.STATIC_DIR || undefined,
  };
}
