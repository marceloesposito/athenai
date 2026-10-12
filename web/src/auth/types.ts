// Accesso: chi sei (OIDC verso Zitadel, auto-ospitato in Svizzera: passkey o email). Nessun fornitore
// americano. L'accesso non da' i contenuti, che sono cifrati con le chiavi del Symbolon.
export interface AuthUser {
  /** identificativo stabile dell'account (`sub` OIDC o id di prova) */
  id: string;
  name: string;
  email?: string;
}

/** Come il server riconosce l'account d'accesso: token OIDC verificabile, o id di prova. */
export type Binding = { idToken: string } | { trialId: string };

export interface AuthClient {
  /** false = nessun server d'identita' configurato: accesso di prova */
  readonly configured: boolean;
  completeSignIn(): Promise<AuthUser | null>;
  currentUser(): Promise<AuthUser | null>;
  /** con OIDC porta alla pagina di Zitadel (passkey o email) */
  signIn(): Promise<AuthUser | null>;
  signOut(): Promise<void>;
  binding(): Promise<Binding | null>;
}
