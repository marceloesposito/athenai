// "Ricorda su questo dispositivo" senza passkey: una chiave AES-GCM del browser *non esportabile*
// (nemmeno uno script nella pagina puo' leggerne i byte) avvolge la chiave principale. Protegge da
// chi copia i dati del browser, non da chi usa il browser sbloccato: per questo e' facoltativa.
export interface DeviceWrap {
  v: 1;
  iv: string;
  ct: string;
}

const AD = new TextEncoder().encode('athenai:devicewrap:v1');

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function newDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>;
}

export async function wrapWithDevice(master: Uint8Array, key: CryptoKey): Promise<DeviceWrap> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AD }, key, new Uint8Array(master)));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}

export async function unwrapWithDevice(w: DeviceWrap, key: CryptoKey): Promise<Uint8Array | null> {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv), additionalData: AD }, key, unb64(w.ct));
    return new Uint8Array(pt);
  } catch {
    return null;
  }
}
