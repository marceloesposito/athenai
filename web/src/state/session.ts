// Sessione: chi e' entrato (accesso) e se le sue chiavi sono sbloccate (Symbolon).
//   signedOut -> (Propylaia) -> needsSymbolon -> protect -> ready (Akropolis)
//                               locked -> ready
// Di default nulla resta nel browser: l'identita' pubblica e la chiave avvolta dalla passkey stanno
// sul server; le chiavi private solo in memoria, cancellate da "Blocca". "Ricorda su questo
// browser" e' l'unica eccezione, su scelta esplicita.
import { useMemo } from 'react';
import { create } from 'zustand';
import { authMessage, registerMessage, AD, type LookupResponse } from '@athenai/protocol';
import { auth, type AuthUser, type Binding } from '../auth';
import { api, setToken, ApiError } from '../api/client';
import { deviceStore } from '../crypto/keystore';
import { masterFromEntropy, identityFromMaster, publicIdentity, wrapMaster, unwrapMaster, wrappingKeyFrom, prefsKey, wipe, type Identity, type PublicIdentity } from '../crypto/keys';
import { phraseEntropy } from '../crypto/recovery';
import { createPasskey, passkeySecret } from '../crypto/passkey';
import { newDeviceKey, wrapWithDevice, unwrapWithDevice } from '../crypto/deviceKey';
import { sodium, toB64 } from '../crypto/sodium';
import { sealJson, openJson } from '../crypto/polis';
import { usePrefs, type UserPrefs, type UnlockMode } from './prefs';

export type Phase = 'loading' | 'offline' | 'signedOut' | 'needsSymbolon' | 'protect' | 'locked' | 'ready';
export type Protection = UnlockMode;

interface SessionState {
  phase: Phase;
  user: AuthUser | null;
  /** quello che il server sa dell'account (null = account nuovo) */
  account: LookupResponse | null;
  identity: Identity | null;
  /** questo browser ricorda lo sblocco (scelta esplicita) */
  remembered: boolean;
  error: string | null;
  init(): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  adoptMaster(master: Uint8Array): Promise<'ok' | 'other' | 'offline'>;
  adoptPhrase(phrase: string): Promise<'ok' | 'bad' | 'other' | 'offline'>;
  protect(kind: Protection): Promise<'ok' | 'noPrf' | 'failed'>;
  unlockWithPasskey(): Promise<boolean>;
  lock(): Promise<void>;
  forgetDevice(): Promise<void>;
  publicIdentity(): PublicIdentity | null;
}

const same = (a: LookupResponse, b: PublicIdentity) => a.signPk === b.sign && a.boxPk === b.box;

async function binding(): Promise<Binding> {
  const b = await auth.binding();
  if (!b) throw new ApiError(401, 'signed-out');
  return b;
}

/** Registra (se serve) le chiavi pubbliche e apre la sessione firmando una sfida. */
async function connect(id: Identity, account: LookupResponse | null, user: AuthUser): Promise<LookupResponse> {
  const s = await sodium();
  const pub = await publicIdentity(id);
  const b = await binding();
  if (!account) {
    // il server lega le chiavi all'account d'accesso: si firma lo stesso testo che calcolera' lui
    const bound = 'idToken' in b ? `oidc:${user.id}` : `trial:${b.trialId}`;
    const signature = toB64(s, s.crypto_sign_detached(registerMessage(pub.sign, pub.box, bound), id.sign.privateKey));
    await api.register({ ...b, signPk: pub.sign, boxPk: pub.box, signature });
  }
  const { challenge } = await api.challenge(pub.sign);
  const sess = await api.session(pub.sign, challenge, toB64(s, s.crypto_sign_detached(authMessage(challenge), id.sign.privateKey)));
  setToken(sess.token);
  return (await api.lookup(b)) ?? { accountId: sess.accountId, signPk: pub.sign, boxPk: pub.box, passkeys: [], prefs: null };
}

/** Preferenze cifrate: lettura dal server e funzione per salvarle. */
async function loadPrefs(id: Identity, account: LookupResponse) {
  const key = await prefsKey(id.master);
  const p = await openJson<UserPrefs>(key, account.prefs, AD.prefs(account.accountId));
  const prefs = usePrefs.getState();
  if (p) prefs.apply(p);
  usePrefs.setState({
    saver: async (next) => {
      await api.putPrefs(await sealJson(key, next, AD.prefs(account.accountId), 1));
    },
  });
  return p;
}

/** Identita' pubblica dell'account (stabile fra un render e l'altro). */
export function usePublicIdentity(): PublicIdentity | null {
  const signPk = useSession((s) => s.account?.signPk);
  const boxPk = useSession((s) => s.account?.boxPk);
  return useMemo(() => (signPk && boxPk ? { sign: signPk, box: boxPk } : null), [signPk, boxPk]);
}

export const useSession = create<SessionState>((set, get) => {
  /** dopo lo sblocco: sessione sul server, preferenze, e la fase giusta */
  async function finish(identity: Identity): Promise<'ok' | 'other' | 'offline'> {
    const { account } = get();
    const pub = await publicIdentity(identity);
    if (account && !same(account, pub)) {
      await wipe(identity.master);
      return 'other';
    }
    try {
      const acc = await connect(identity, account, get().user!);
      const prefs = await loadPrefs(identity, acc);
      const chosen = prefs?.unlock ?? (acc.passkeys.length ? 'passkey' : get().remembered ? 'device' : undefined);
      set({ account: acc, identity, phase: chosen ? 'ready' : 'protect', error: null });
      return 'ok';
    } catch (e) {
      await wipe(identity.master);
      set({ error: String((e as Error).message) });
      return e instanceof ApiError && e.status === 0 ? 'offline' : 'other';
    }
  }

  async function afterSignIn(user: AuthUser | null) {
    if (!user) return set({ phase: 'signedOut', user: null, account: null, identity: null });
    let account: LookupResponse | null;
    try {
      account = await api.lookup(await binding());
    } catch {
      return set({ phase: 'offline', user });
    }
    const local = await deviceStore.load(user.id);
    set({ user, account, remembered: !!local, identity: null });
    if (!account) return set({ phase: 'needsSymbolon' });
    if (local) {
      const master = await unwrapWithDevice(local.record.device, local.key);
      if (master && (await finish(await identityFromMaster(master))) === 'ok') return;
    }
    set({ phase: 'locked' });
  }

  return {
    phase: 'loading',
    user: null,
    account: null,
    identity: null,
    remembered: false,
    error: null,

    async init() {
      try {
        const user = (await auth.completeSignIn()) ?? (await auth.currentUser());
        await afterSignIn(user);
      } catch (e) {
        set({ phase: 'signedOut', error: String((e as Error).message ?? e) });
      }
    },

    async signIn() {
      set({ error: null });
      try {
        const user = await auth.signIn();
        if (user) await afterSignIn(user);
      } catch (e) {
        set({ error: String((e as Error).message ?? e) });
      }
    },

    async signOut() {
      await get().lock();
      await auth.signOut();
      set({ phase: 'signedOut', user: null, account: null, identity: null });
    },

    async adoptMaster(master) {
      return finish(await identityFromMaster(master));
    },

    async adoptPhrase(phrase) {
      const entropy = phraseEntropy(phrase);
      if (!entropy) return 'bad';
      const master = await masterFromEntropy(entropy);
      await wipe(entropy);
      return get().adoptMaster(master);
    },

    async protect(kind) {
      const { user, account, identity } = get();
      if (!user || !account || !identity) return 'failed';
      try {
        if (kind === 'passkey') {
          const made = await createPasskey(user.id, user.email ?? user.name).catch(() => undefined);
          if (made === undefined) return 'failed';
          if (!made) return 'noPrf';
          const key = await wrappingKeyFrom(made.secret, 'passkey');
          const wrapped = await wrapMaster(identity.master, key, 'passkey');
          await wipe(made.secret, key);
          await api.putPasskey(made.info.credentialId, made.info.salt, wrapped as never);
          set({ account: { ...account, passkeys: [...account.passkeys, { credentialId: made.info.credentialId, salt: made.info.salt, wrapped: wrapped as never }] } });
        } else if (kind === 'device') {
          const key = await newDeviceKey();
          await deviceStore.save({ v: 2, account: user.id, identity: await publicIdentity(identity), device: await wrapWithDevice(identity.master, key) }, key);
          set({ remembered: true });
        }
        await usePrefs.getState().update({ unlock: kind });
        set({ phase: 'ready' });
        return 'ok';
      } catch {
        return 'failed';
      }
    },

    async unlockWithPasskey() {
      const { account } = get();
      for (const p of account?.passkeys ?? []) {
        const secret = await passkeySecret({ credentialId: p.credentialId, salt: p.salt });
        if (!secret) continue;
        const key = await wrappingKeyFrom(secret, 'passkey');
        const master = await unwrapMaster(p.wrapped, key);
        await wipe(secret, key);
        if (master) return (await get().adoptMaster(master)) === 'ok';
      }
      return false;
    },

    async lock() {
      const { identity } = get();
      if (identity) await wipe(identity.master, identity.box.privateKey, identity.sign.privateKey);
      setToken(null);
      usePrefs.setState({ saver: null });
      set({ identity: null, phase: get().account ? 'locked' : get().phase });
    },

    async forgetDevice() {
      const { user } = get();
      if (user) await deviceStore.forget(user.id);
      set({ remembered: false });
      if (usePrefs.getState().unlock === 'device') await usePrefs.getState().update({ unlock: 'phrase' });
    },

    publicIdentity() {
      const a = get().account;
      return a ? { sign: a.signPk, box: a.boxPk } : null;
    },
  };
});
