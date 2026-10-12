// Archivio locale (IndexedDB) delle chiavi di un account: solo l'identita' pubblica e la chiave
// principale *avvolta*. Mai chiavi private in chiaro.
import { get, set, del } from 'idb-keyval';
import type { PublicIdentity, WrappedKey } from './keys';
import type { PasskeyInfo } from './passkey';
import type { DeviceWrap } from './deviceKey';

export interface KeyRecord {
  v: 1;
  account: string;
  identity: PublicIdentity;
  passkey?: { info: PasskeyInfo; wrapped: WrappedKey };
  device?: DeviceWrap;
  /** come si sblocca su questo dispositivo (assente = da scegliere) */
  protection?: 'passkey' | 'device' | 'none';
  created: string;
}

const recKey = (account: string) => `athenai:keys:${account}`;
const devKey = (account: string) => `athenai:devicekey:${account}`;

export const keystore = {
  load: (account: string) => get<KeyRecord>(recKey(account)),
  save: (r: KeyRecord) => set(recKey(r.account), r),
  loadDeviceKey: (account: string) => get<CryptoKey>(devKey(account)),
  saveDeviceKey: (account: string, k: CryptoKey) => set(devKey(account), k),
  /** dimentica questo dispositivo: restano solo le copie altrove e la frase di recupero */
  async forget(account: string) {
    await del(recKey(account));
    await del(devKey(account));
  },
};
