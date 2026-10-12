// Accesso: chi sei (OIDC verso Zitadel). Non da' accesso ai contenuti, che sono cifrati con le
// chiavi del Symbolon: Google, GitHub o il fornitore d'identita' non possono leggerli.
export type SocialProvider = 'google' | 'github';

export interface AuthUser {
  /** identificativo stabile dell'account (`sub` OIDC) */
  id: string;
  name: string;
  email?: string;
}

export interface AuthClient {
  /** false = nessun server d'identita' configurato: accesso di prova locale */
  readonly configured: boolean;
  /** fornitori esterni attivi su questo server */
  readonly providers: SocialProvider[];
  /** dopo il ritorno dal fornitore: l'utente, oppure null */
  completeSignIn(): Promise<AuthUser | null>;
  currentUser(): Promise<AuthUser | null>;
  /** porta alla pagina del fornitore (passkey/email, o direttamente Google/GitHub) */
  signIn(provider?: SocialProvider): Promise<AuthUser | null>;
  signOut(): Promise<void>;
}
