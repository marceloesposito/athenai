// Scelta del client d'accesso dalla configurazione (VITE_OIDC_* in web/.env.local, vedi deploy/).
import { createOidcClient } from './oidc';
import { createTrialClient } from './trial';
import type { AuthClient } from './types';

const env = import.meta.env;

export const auth: AuthClient =
  env.VITE_OIDC_ISSUER && env.VITE_OIDC_CLIENT_ID ? createOidcClient({ issuer: env.VITE_OIDC_ISSUER, clientId: env.VITE_OIDC_CLIENT_ID }) : createTrialClient();

export type { AuthClient, AuthUser, Binding } from './types';
