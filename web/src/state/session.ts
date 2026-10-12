// Sessione: chi e' entrato (accesso) e se le sue chiavi sono sbloccate (Symbolon).
//   signedOut -> (Propylaia) -> needsSymbolon -> protect -> ready (Akropolis)
//                               locked -> ready
// Le chiavi private stanno solo in memoria, in questo store, e si cancellano con "Blocca".
import { create } from 'zustand';
import { auth, type AuthUser, type SocialProvider } from '../auth';
import { keystore, type KeyRecord } from '../crypto/keystore';
import { masterFromEntropy, identityFromMaster, publicIdentity, sameIdentity, wrapMaster, unwrapMaster, wrappingKeyFrom, wipe, type Identity } from '../crypto/keys';
import { phraseEntropy } from '../crypto/recovery';
import { createPasskey, passkeySecret } from '../crypto/passkey';
import { newDeviceKey, wrapWithDevice, unwrapWithDevice } from '../crypto/deviceKey';

export type Phase = 'loading' | 'signedOut' | 'needsSymbolon' | 'protect' | 'locked' | 'ready';
export type Protection = 'passkey' | 'device' | 'none';

interface SessionState {
  phase: Phase;
  user: AuthUser | null;
  record: KeyRecord | null;
  identity: Identity | null;
  error: string | null;
  init(): Promise<void>;
  signIn(provider?: SocialProvider): Promise<void>;
  signOut(): Promise<void>;
  /** nuova identita' o identita' gia' esistente arrivata da frase o da un altro dispositivo */
  adoptMaster(master: Uint8Array): Promise<'ok' | 'other'>;
  adoptPhrase(phrase: string): Promise<'ok' | 'bad' | 'other'>;
  protect(kind: Protection): Promise<'ok' | 'noPrf' | 'failed'>;
  unlockWithPasskey(): Promise<boolean>;
  lock(): Promise<void>;
  forgetDevice(): Promise<void>;
}

async function afterSignIn(user: AuthUser | null): Promise<Partial<SessionState>> {
  if (!user) return { phase: 'signedOut', user: null, record: null, identity: null };
  const record = (await keystore.load(user.id)) ?? null;
  if (!record) return { phase: 'needsSymbolon', user, record: null, identity: null };
  // chiave del dispositivo: sblocco senza chiedere niente
  if (record.device) {
    const key = await keystore.loadDeviceKey(user.id);
    const master = key ? await unwrapWithDevice(record.device, key) : null;
    if (master) return { phase: 'ready', user, record, identity: await identityFromMaster(master) };
  }
  return { phase: 'locked', user, record, identity: null };
}

export const useSession = create<SessionState>((set, get) => ({
  phase: 'loading',
  user: null,
  record: null,
  identity: null,
  error: null,

  async init() {
    try {
      const user = (await auth.completeSignIn()) ?? (await auth.currentUser());
      set({ ...(await afterSignIn(user)), error: null });
    } catch (e) {
      set({ phase: 'signedOut', error: String((e as Error).message ?? e) });
    }
  },

  async signIn(provider) {
    set({ error: null });
    try {
      const user = await auth.signIn(provider);
      if (user) set(await afterSignIn(user));
    } catch (e) {
      set({ error: String((e as Error).message ?? e) });
    }
  },

  async signOut() {
    await get().lock();
    await auth.signOut();
    set({ phase: 'signedOut', user: null, record: null, identity: null });
  },

  async adoptMaster(master) {
    const { user, record } = get();
    if (!user) return 'other';
    const identity = await identityFromMaster(master);
    const pub = await publicIdentity(identity);
    // con un'identita' gia' nota per l'account deve essere la stessa (dal P2 la conosce anche il server)
    if (record && !sameIdentity(record.identity, pub)) {
      await wipe(master);
      return 'other';
    }
    const next: KeyRecord = record ?? { v: 1, account: user.id, identity: pub, created: new Date().toISOString() };
    await keystore.save(next);
    set({ record: next, identity, phase: next.protection ? 'ready' : 'protect' });
    return 'ok';
  },

  async adoptPhrase(phrase) {
    const entropy = phraseEntropy(phrase);
    if (!entropy) return 'bad';
    const master = await masterFromEntropy(entropy);
    await wipe(entropy);
    return get().adoptMaster(master);
  },

  async protect(kind) {
    const { user, record, identity } = get();
    if (!user || !record || !identity) return 'failed';
    const next: KeyRecord = { ...record, passkey: undefined, device: undefined, protection: kind };
    if (kind === 'passkey') {
      let made;
      try {
        made = await createPasskey(user.id, user.email ?? user.name);
      } catch {
        return 'failed';
      }
      if (!made) return 'noPrf';
      const key = await wrappingKeyFrom(made.secret, 'passkey');
      next.passkey = { info: made.info, wrapped: await wrapMaster(identity.master, key, 'passkey') };
      await wipe(made.secret, key);
    } else if (kind === 'device') {
      const key = await newDeviceKey();
      await keystore.saveDeviceKey(user.id, key);
      next.device = await wrapWithDevice(identity.master, key);
    }
    await keystore.save(next);
    set({ record: next, phase: 'ready' });
    return 'ok';
  },

  async unlockWithPasskey() {
    const { record } = get();
    if (!record?.passkey) return false;
    const secret = await passkeySecret(record.passkey.info);
    if (!secret) return false;
    const key = await wrappingKeyFrom(secret, 'passkey');
    const master = await unwrapMaster(record.passkey.wrapped, key);
    await wipe(secret, key);
    if (!master) return false;
    return (await get().adoptMaster(master)) === 'ok';
  },

  async lock() {
    const { identity } = get();
    if (identity) await wipe(identity.master, identity.box.privateKey, identity.sign.privateKey);
    set({ identity: null, phase: get().record ? 'locked' : get().phase });
  },

  async forgetDevice() {
    const { user } = get();
    if (!user) return;
    await get().lock();
    await keystore.forget(user.id);
    set({ record: null, phase: 'needsSymbolon' });
  },
}));
