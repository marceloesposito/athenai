// Scelta del client d'accesso dalla configurazione (variabili VITE_ in .env, vedi deploy/).
import { createOidcClient } from './oidc';
import { createTrialClient } from './trial';
import type { AuthClient } from './types';

const env = import.meta.env;

export const auth: AuthClient =
  env.VITE_OIDC_ISSUER && env.VITE_OIDC_CLIENT_ID
    ? createOidcClient({
        issuer: env.VITE_OIDC_ISSUER,
        clientId: env.VITE_OIDC_CLIENT_ID,
        idp: { google: env.VITE_IDP_GOOGLE, github: env.VITE_IDP_GITHUB },
      })
    : createTrialClient();

export type { AuthClient, AuthUser, SocialProvider } from './types';
