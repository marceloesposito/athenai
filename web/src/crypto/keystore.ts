// "Resta connesso su questo browser": la chiave principale avvolta da una chiave WebCrypto non
// esportabile, in IndexedDB. E' l'unica cosa che Athenai salva nel browser, e solo se l'utente lo
// sceglie. Un solo account per browser.
import { get, set, del, createStore, type UseStore } from 'idb-keyval';
import type { DeviceWrap } from './deviceKey';

export interface DeviceRecord {
  v: 3;
  accountId: string;
  email: string;
  /** chiave pubblica di firma, per chiedere la sessione con una sfida firmata */
  signPk: string;
  device: DeviceWrap;
}

const DB = 'athenai-device';
const REC = 'athenai:device';
const KEY = 'athenai:devicekey';
let store: UseStore | null = null;
// aprire il database lo crea: lo si apre solo se esiste gia' o se l'utente sceglie di restare connesso
const open = () => (store ??= createStore(DB, 'keys'));
async function exists(): Promise<boolean> {
  if (store) return true;
  if (!('databases' in indexedDB)) return false;
  return (await indexedDB.databases()).some((d) => d.name === DB);
}

export const deviceStore = {
  async load(): Promise<{ record: DeviceRecord; key: CryptoKey } | null> {
    try {
      if (!(await exists())) return null;
      const record = await get<DeviceRecord>(REC, open());
      const key = await get<CryptoKey>(KEY, open());
      return record?.v === 3 && key ? { record, key } : null;
    } catch {
      return null;
    }
  },
  async save(record: DeviceRecord, key: CryptoKey) {
    await set(KEY, key, open());
    await set(REC, record, open());
  },
  async forget() {
    if (!(await exists())) return;
    await del(REC, open()).catch(() => undefined);
    await del(KEY, open()).catch(() => undefined);
  },
};
