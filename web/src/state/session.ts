// Sessione: chi sta usando Athenai in questa scheda. Un account (email e password; la password
// sblocca la chiave principale qui nel browser) oppure un ospite entrato da un link privato. Con
// "resta connesso" la chiave principale resta avvolta da una chiave non esportabile del browser.
import { create } from 'zustand';
import {
  AD,
  registerMessage,
  authMessage,
  normalizeEmail,
  parseGuestLink,
  parseInviteLink,
  type AccountView,
  type SessionResponse,
  type GuestMode,
  type GuestContext,
} from '@athenai/protocol';
import { api, setToken, ApiError } from '../api/client';
import { live } from '../live/socket';
import { sodium, toB64, fromB64 } from '../crypto/sodium';
import { identityFromMaster, ephemeralIdentity, publicIdentity, prefsKey, wipe, type Identity } from '../crypto/keys';
import { newKdf, passwordKeys, newMaster, wrapMasterWith, unwrapMasterWith, newRecoveryCode, recoveryKeys } from '../crypto/password';
import { newDeviceKey, wrapWithDevice, unwrapWithDevice } from '../crypto/deviceKey';
import { deviceStore } from '../crypto/keystore';
import { openGuestLink, sealJson, openJson } from '../crypto/polis';
import { usePrefs, type UserPrefs } from './prefs';
import { getLang } from '../i18n';

export type Phase = 'loading' | 'signedOut' | 'ready' | 'guestInvite' | 'guest';

export interface GuestState {
  guestId: string;
  name: string;
  mode: GuestMode;
  linkId: string;
  polisId: string;
  symposionId: string;
  symposionName: string;
  /** chiavi del Symposion per epoca (dal frammento del link) */
  keys: Map<number, Uint8Array>;
  people: GuestContext['people'];
}

/** link per ospiti aperto ma non ancora usato: nome del Symposion da mostrare */
export interface GuestInvite {
  linkId: string;
  secret: string;
  symposionName: string;
  mode: GuestMode;
}

type AuthResult = 'ok' | 'bad' | 'taken' | 'wait' | 'offline' | 'closed';

interface SessionState {
  phase: Phase;
  account: AccountView | null;
  identity: Identity | null;
  guest: GuestState | null;
  guestInvite: GuestInvite | null;
  /** invito nella Polis arrivato dal link, da accettare appena dentro */
  pendingInvite: { inviteId: string; secret: string } | null;
  init(): Promise<void>;
  signUp(name: string, email: string, password: string, remember: boolean): Promise<AuthResult>;
  signIn(email: string, password: string, remember: boolean): Promise<AuthResult>;
  recover(email: string, code: string, newPassword: string): Promise<AuthResult>;
  changePassword(newPassword: string): Promise<boolean>;
  createRecoveryCode(): Promise<string | null>;
  removeRecovery(): Promise<void>;
  signOut(): Promise<void>;
  joinAsGuest(): Promise<'ok' | 'invalid'>;
  clearPendingInvite(): void;
}

const GUEST_KEY = 'athenai:guest';

function errorResult(e: unknown): AuthResult {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'offline';
    if (e.status === 409) return 'taken';
    if (e.status === 429) return 'wait';
    if (e.code === 'signup-closed') return 'closed';
  }
  return 'bad';
}

/** Preferenze cifrate: lettura dal server e funzione per salvarle. */
async function loadPrefs(id: Identity, account: AccountView, fallbackName = '') {
  const key = await prefsKey(id.master);
  const p = await openJson<UserPrefs>(key, account.prefs, AD.prefs(account.accountId));
  const prefs = usePrefs.getState();
  prefs.apply({ name: fallbackName, ...p });
  usePrefs.setState({
    saver: async (next) => {
      await api.putPrefs(await sealJson(key, next, AD.prefs(account.accountId), 1));
    },
  });
}

/** Dal percorso dell'indirizzo: un link per ospiti o un invito nella Polis. Poi l'URL si pulisce. */
function linkFromUrl() {
  const here = location.origin + location.pathname + location.hash;
  const guest = parseGuestLink(here);
  const invite = parseInviteLink(here);
  if (guest || invite) history.replaceState(null, '', '/');
  return { guest, invite };
}

export const useSession = create<SessionState>((set, get) => {
  /** Dentro con un account: identita' controllata, token, preferenze, "resta connesso". */
  async function enter(sess: SessionResponse, master: Uint8Array, remember: boolean, name?: string): Promise<AuthResult> {
    const identity = await identityFromMaster(master);
    const pub = await publicIdentity(identity);
    if (pub.sign !== sess.account.signPk || pub.box !== sess.account.boxPk) {
      await wipe(master);
      return 'bad';
    }
    setToken(sess.token);
    await loadPrefs(identity, sess.account, name);
    if (name) await usePrefs.getState().update({ name });
    if (remember) {
      const key = await newDeviceKey();
      await deviceStore.save({ v: 3, accountId: sess.account.accountId, email: sess.account.email, signPk: sess.account.signPk, device: await wrapWithDevice(master, key) }, key);
    } else await deviceStore.forget();
    set({ account: sess.account, identity, phase: 'ready', guest: null, guestInvite: null });
    return 'ok';
  }

  async function guestResume(linkId: string): Promise<boolean> {
    try {
      const raw = sessionStorage.getItem(GUEST_KEY);
      if (!raw) return false;
      const g = JSON.parse(raw) as { linkId: string; secret: string; token: string; master: string };
      if (g.linkId !== linkId && linkId) return false;
      return await guestEnter(g.linkId, g.secret, g.token, g.master);
    } catch {
      return false;
    }
  }

  async function guestEnter(linkId: string, secret: string, token: string, masterB64: string): Promise<boolean> {
    const s = await sodium();
    const link = await api.guestLink(linkId).catch(() => null);
    if (!link) return false;
    const opened = await openGuestLink(linkId, secret, link.key, link.meta);
    if (!opened) return false;
    setToken(token);
    const ctx = await api.guestMe().catch(() => null);
    if (!ctx) {
      setToken(null);
      return false;
    }
    const identity = await identityFromMaster(fromB64(s, masterB64));
    set({
      phase: 'guest',
      identity,
      account: null,
      guestInvite: null,
      guest: { guestId: ctx.guestId, name: ctx.name, mode: ctx.mode, linkId, polisId: ctx.polisId, symposionId: ctx.symposionId, symposionName: opened.name, keys: opened.keys, people: ctx.people },
    });
    return true;
  }

  return {
    phase: 'loading',
    account: null,
    identity: null,
    guest: null,
    guestInvite: null,
    pendingInvite: null,

    async init() {
      const { guest, invite } = linkFromUrl();
      if (invite) set({ pendingInvite: invite });
      // un link per ospiti: si riprende la sessione della scheda, o si propone di entrare
      if (guest) {
        if (await guestResume(guest.linkId)) return;
        const link = await api.guestLink(guest.linkId).catch(() => null);
        const opened = link ? await openGuestLink(guest.linkId, guest.secret, link.key, link.meta) : null;
        if (link && opened) return set({ phase: 'guestInvite', guestInvite: { linkId: guest.linkId, secret: guest.secret, symposionName: opened.name, mode: link.mode } });
      } else if (await guestResume('')) return;
      // "resta connesso": la chiave principale avvolta dal browser e una sfida firmata
      const saved = await deviceStore.load();
      if (saved) {
        const master = await unwrapWithDevice(saved.record.device, saved.key);
        if (master) {
          try {
            const s = await sodium();
            const id = await identityFromMaster(master);
            const { challenge } = await api.challenge(saved.record.signPk);
            const sess = await api.session(saved.record.signPk, challenge, toB64(s, s.crypto_sign_detached(authMessage(challenge), id.sign.privateKey)));
            if ((await enter(sess, master, true)) === 'ok') return;
          } catch (e) {
            // senza rete si riprova piu' tardi; con un account sparito si dimentica il browser
            if (e instanceof ApiError && e.status === 404) await deviceStore.forget();
          }
        }
      }
      set({ phase: 'signedOut' });
    },

    async signUp(name, email, password, remember) {
      try {
        const s = await sodium();
        const kdf = await newKdf();
        const { authKey, wrapKey } = await passwordKeys(password, kdf);
        const master = await newMaster();
        const id = await identityFromMaster(master);
        const pub = await publicIdentity(id);
        const addr = normalizeEmail(email);
        const sess = await api.register({
          email: addr,
          authKey,
          kdf,
          wrapped: await wrapMasterWith(wrapKey, master, 'password'),
          signPk: pub.sign,
          boxPk: pub.box,
          signature: toB64(s, s.crypto_sign_detached(registerMessage(pub.sign, pub.box, addr), id.sign.privateKey)),
        });
        await wipe(wrapKey);
        usePrefs.getState().apply({ lang: getLang() });
        return await enter(sess, master, remember, name.trim());
      } catch (e) {
        return errorResult(e);
      }
    },

    async signIn(email, password, remember) {
      try {
        const addr = normalizeEmail(email);
        const { kdf } = await api.prelogin(addr);
        const { authKey, wrapKey } = await passwordKeys(password, kdf);
        const sess = await api.login({ email: addr, authKey });
        const master = await unwrapMasterWith(wrapKey, sess.account.wrapped, 'password');
        await wipe(wrapKey);
        if (!master) return 'bad';
        return await enter(sess, master, remember);
      } catch (e) {
        return errorResult(e);
      }
    },

    /** Password dimenticata, con il codice di recupero: si entra e si sceglie una password nuova. */
    async recover(email, code, newPassword) {
      try {
        const rk = await recoveryKeys(code);
        if (!rk) return 'bad';
        const sess = await api.recover({ email: normalizeEmail(email), recoveryAuth: rk.recoveryAuth });
        const master = await unwrapMasterWith(rk.wrapKey, sess.recoveryWrapped, 'recovery');
        if (!master) return 'bad';
        const r = await enter(sess, master, false);
        if (r === 'ok') await get().changePassword(newPassword);
        return r;
      } catch (e) {
        return errorResult(e);
      }
    },

    async changePassword(newPassword) {
      const { identity, account } = get();
      if (!identity || !account) return false;
      const kdf = await newKdf();
      const { authKey, wrapKey } = await passwordKeys(newPassword, kdf);
      await api.changePassword({ authKey, kdf, wrapped: await wrapMasterWith(wrapKey, identity.master, 'password') });
      await wipe(wrapKey);
      return true;
    },

    async createRecoveryCode() {
      const { identity, account } = get();
      if (!identity || !account) return null;
      const code = await newRecoveryCode();
      const rk = (await recoveryKeys(code))!;
      await api.setRecovery({ recoveryAuth: rk.recoveryAuth, wrapped: await wrapMasterWith(rk.wrapKey, identity.master, 'recovery') });
      set({ account: { ...account, hasRecovery: true } });
      return code;
    },

    async removeRecovery() {
      const { account } = get();
      await api.removeRecovery();
      if (account) set({ account: { ...account, hasRecovery: false } });
    },

    async signOut() {
      const { identity, phase } = get();
      if (phase === 'ready') await api.logout().catch(() => undefined);
      await deviceStore.forget();
      try {
        sessionStorage.removeItem(GUEST_KEY);
      } catch {
        /* niente */
      }
      if (identity) await wipe(identity.master, identity.box.privateKey, identity.sign.privateKey);
      setToken(null);
      usePrefs.setState({ saver: null });
      set({ phase: 'signedOut', account: null, identity: null, guest: null, guestInvite: null });
    },

    async joinAsGuest() {
      const inv = get().guestInvite;
      if (!inv) return 'invalid';
      try {
        const s = await sodium();
        const id = await ephemeralIdentity();
        const pub = await publicIdentity(id);
        const g = await api.joinGuest(inv.linkId, pub.sign, pub.box);
        const master = toB64(s, id.master);
        // la sessione da ospite vale per questa scheda: si chiude con lei
        try {
          sessionStorage.setItem(GUEST_KEY, JSON.stringify({ linkId: inv.linkId, secret: inv.secret, token: g.token, master }));
        } catch {
          /* senza sessionStorage si resta ospiti fino al ricaricamento */
        }
        return (await guestEnter(inv.linkId, inv.secret, g.token, master)) ? 'ok' : 'invalid';
      } catch {
        return 'invalid';
      }
    },

    clearPendingInvite() {
      set({ pendingInvite: null });
    },
  };
});

// il server ha chiuso la sessione (scaduta, o link dell'ospite revocato): si torna all'ingresso
live.onUnauthorized(() => {
  if (useSession.getState().phase !== 'signedOut') void useSession.getState().signOut();
});
