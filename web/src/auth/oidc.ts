// OIDC con PKCE verso Zitadel (auto-ospitato, Svizzera, open source): passkey o email, nient'altro.
// I token restano in sessionStorage e si perdono alla chiusura della scheda.
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import type { AuthClient, AuthUser } from './types';

export interface OidcConfig {
  issuer: string;
  clientId: string;
}

const toUser = (u: User | null): AuthUser | null =>
  u && !u.expired
    ? { id: u.profile.sub, name: String(u.profile.name ?? u.profile.preferred_username ?? u.profile.email ?? 'Polites'), email: u.profile.email }
    : null;

export function createOidcClient(cfg: OidcConfig): AuthClient {
  const base = `${location.origin}/`;
  const um = new UserManager({
    authority: cfg.issuer,
    client_id: cfg.clientId,
    redirect_uri: base,
    post_logout_redirect_uri: base,
    response_type: 'code',
    scope: 'openid profile email',
    userStore: new WebStorageStateStore({ store: sessionStorage }),
  });
  return {
    configured: true,
    async completeSignIn() {
      const q = new URLSearchParams(location.search);
      if (!q.has('code') || !q.has('state')) return null;
      const u = await um.signinRedirectCallback();
      history.replaceState(null, '', location.pathname + location.hash);
      return toUser(u);
    },
    async currentUser() {
      return toUser(await um.getUser());
    },
    async signIn() {
      // un eventuale invito (frammento #) si ritrova dopo il ritorno da Zitadel
      sessionStorage.setItem('athenai:return-to', location.pathname + location.hash);
      await um.signinRedirect();
      return null;
    },
    async signOut() {
      await um.removeUser();
      await um.signoutRedirect().catch(() => undefined);
    },
    async binding() {
      const u = await um.getUser();
      return u?.id_token && !u.expired ? { idToken: u.id_token } : null;
    },
  };
}
