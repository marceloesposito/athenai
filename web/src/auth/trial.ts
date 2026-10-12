// Accesso di prova (server con ALLOW_TRIAL): un account che dura quanto la scheda. Nulla resta nel
// browser alla chiusura; le chiavi e la cifratura sono quelle vere.
import type { AuthClient, AuthUser } from './types';

const KEY = 'athenai:trial-user';

function load(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function createTrialClient(): AuthClient {
  return {
    configured: false,
    async completeSignIn() {
      return null;
    },
    async currentUser() {
      return load();
    },
    async signIn() {
      const u = load() ?? { id: `trial-${crypto.randomUUID()}`, name: 'Xenos' };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(u));
      } catch {
        /* la prova vale per questa pagina */
      }
      return u;
    },
    async signOut() {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* niente */
      }
    },
    async binding() {
      const u = load();
      return u ? { trialId: u.id } : null;
    },
  };
}
