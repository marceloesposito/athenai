// Passkey con estensione PRF: il portachiavi del sistema (iCloud, Google, 1Password...) produce un
// segreto stabile per questa app, da cui si ricava la chiave che avvolge la chiave principale.
// Sblocco con impronta o volto, senza password; il segreto non lascia mai il dispositivo in chiaro.
// Supporto: Chrome/Edge 116+, Safari 18+, Firefox 135+. Senza PRF resta la frase di recupero.

export interface PasskeyInfo {
  credentialId: string;
  /** sale dell'estensione PRF (base64url) */
  salt: string;
}

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export function passkeysAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

/** Crea la passkey; restituisce l'uscita PRF, oppure null se il portachiavi non supporta PRF. */
export async function createPasskey(accountId: string, displayName: string): Promise<{ info: PasskeyInfo; secret: Uint8Array } | null> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Athenai', id: location.hostname },
      user: { id: enc.encode(accountId).slice(0, 64), name: displayName, displayName },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return null;
  const info: PasskeyInfo = { credentialId: b64u(cred.rawId), salt: b64u(salt) };
  const ext = cred.getClientExtensionResults() as PrfResults;
  if (ext.prf?.results?.first) return { info, secret: new Uint8Array(ext.prf.results.first) };
  if (ext.prf?.enabled === false) return null;
  // alcuni portachiavi danno il PRF solo all'accesso: si chiede subito
  const secret = await passkeySecret(info);
  return secret ? { info, secret } : null;
}

/** Segreto PRF della passkey (chiede impronta o volto); null se annullato o non supportato. */
export async function passkeySecret(info: PasskeyInfo): Promise<Uint8Array | null> {
  try {
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: unb64u(info.credentialId) }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: unb64u(info.salt) } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    const first = (cred?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results?.first;
    return first ? new Uint8Array(first) : null;
  } catch {
    return null;
  }
}
