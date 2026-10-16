/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** indirizzo del server di Athenai (vuoto = stessa origine) */
  readonly VITE_API_URL?: string;
}
