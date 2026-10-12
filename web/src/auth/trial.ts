// Accesso di prova, quando non c'e' un server d'identita' (sviluppo, prove): un account locale a
// questo browser. Le chiavi e la cifratura sono quelle vere.
import type { AuthClient, AuthUser } from './types';

const KEY = 'athenai:trial-user';

function load(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function createTrialClient(): AuthClient {
  return {
    configured: false,
    providers: [],
    async completeSignIn() {
      return null;
    },
    async currentUser() {
      return load();
    },
    async signIn() {
      const u = load() ?? { id: `trial-${crypto.randomUUID()}`, name: 'Xenos' };
      try {
        localStorage.setItem(KEY, JSON.stringify(u));
      } catch {
        /* senza storage la prova vale per questa pagina */
      }
      return u;
    },
    async signOut() {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* niente */
      }
    },
  };
}
