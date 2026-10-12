// Archivio locale SOLO su scelta esplicita ("Ricorda su questo browser"): la chiave principale
// avvolta da una chiave WebCrypto non esportabile. Di default Athenai non salva nulla nel browser.
import { get, set, del, createStore, type UseStore } from 'idb-keyval';
import type { PublicIdentity } from './keys';
import type { DeviceWrap } from './deviceKey';

export interface DeviceRecord {
  v: 2;
  account: string;
  identity: PublicIdentity;
  device: DeviceWrap;
}

const DB = 'athenai-device';
let store: UseStore | null = null;
// aprire il database lo crea: lo si apre solo se esiste gia' o se l'utente sceglie di ricordare
const open = () => (store ??= createStore(DB, 'keys'));
async function exists(): Promise<boolean> {
  if (store) return true;
  if (!('databases' in indexedDB)) return false;
  return (await indexedDB.databases()).some((d) => d.name === DB);
}

const recKey = (account: string) => `athenai:device:${account}`;
const keyKey = (account: string) => `athenai:devicekey:${account}`;

export const deviceStore = {
  async load(account: string): Promise<{ record: DeviceRecord; key: CryptoKey } | null> {
    try {
      if (!(await exists())) return null;
      const record = await get<DeviceRecord>(recKey(account), open());
      const key = await get<CryptoKey>(keyKey(account), open());
      return record && key ? { record, key } : null;
    } catch {
      return null;
    }
  },
  async save(record: DeviceRecord, key: CryptoKey) {
    await set(keyKey(record.account), key, open());
    await set(recKey(record.account), record, open());
  },
  async forget(account: string) {
    if (!(await exists())) return;
    await del(recKey(account), open()).catch(() => undefined);
    await del(keyKey(account), open()).catch(() => undefined);
  },
};
