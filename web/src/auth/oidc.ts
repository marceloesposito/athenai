// OIDC con PKCE verso Zitadel (auto-ospitato, svizzero, open source). Passkey ed email li gestisce
// Zitadel; Google e GitHub sono fornitori esterni configurati li', raggiungibili direttamente con
// lo scope `urn:zitadel:iam:org:idp:id:<id>`. I token restano in sessionStorage (si perdono alla
// chiusura della scheda).
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import type { AuthClient, AuthUser, SocialProvider } from './types';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  idp: Partial<Record<SocialProvider, string>>;
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
  const providers = (Object.keys(cfg.idp) as SocialProvider[]).filter((p) => cfg.idp[p]);
  return {
    configured: true,
    providers,
    async completeSignIn() {
      const q = new URLSearchParams(location.search);
      if (!q.has('code') || !q.has('state')) return null;
      const u = await um.signinRedirectCallback();
      history.replaceState(null, '', location.pathname);
      return toUser(u);
    },
    async currentUser() {
      return toUser(await um.getUser());
    },
    async signIn(provider) {
      const idp = provider ? cfg.idp[provider] : undefined;
      await um.signinRedirect(idp ? { scope: `openid profile email urn:zitadel:iam:org:idp:id:${idp}` } : undefined);
      return null; // la pagina se ne va
    },
    async signOut() {
      await um.removeUser();
      await um.signoutRedirect().catch(() => undefined);
    },
  };
}
