import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase, phraseEntropy, normalizePhrase, confirmationPositions, phraseWords } from './recovery';
import { masterFromEntropy, identityFromMaster, publicIdentity, sameIdentity, fingerprint, wrapMaster, unwrapMaster, wrappingKeyFrom } from './keys';
import { createLinkRequest, parseLinkCode, verificationCode, sealMasterFor, openLinkedMaster } from './deviceLink';
import { newDeviceKey, wrapWithDevice, unwrapWithDevice } from './deviceKey';
import { sodium } from './sodium';

const fromPhrase = async (p: string) => identityFromMaster(await masterFromEntropy(phraseEntropy(p)!));

describe('frase di recupero', () => {
  it('12 parole valide, in italiano e in inglese', () => {
    for (const lang of ['it', 'en'] as const) {
      const p = newRecoveryPhrase(lang);
      expect(phraseWords(p)).toHaveLength(12);
      expect(phraseEntropy(p)).toHaveLength(16);
    }
  });
  it('si accetta come la scrive una persona; una parola sbagliata no', () => {
    const p = newRecoveryPhrase('en');
    expect(phraseEntropy('  ' + p.toUpperCase().replace(/ /g, '   ') + '\n')).toEqual(phraseEntropy(p));
    const words = phraseWords(p);
    words[3] = words[3] === 'abandon' ? 'ability' : 'abandon';
    expect(phraseEntropy(words.join(' '))).toBeNull();
    expect(phraseEntropy('ciao mondo')).toBeNull();
    expect(normalizePhrase('Àbaco  Città')).toBe('abaco citta');
  });
  it('tre posizioni diverse da controllare', () => {
    const pos = confirmationPositions(3);
    expect(new Set(pos).size).toBe(3);
    expect(pos.every((i) => i >= 0 && i < 12)).toBe(true);
  });
});

describe('identita\'', () => {
  it('la stessa frase da\' sempre la stessa identita\', frasi diverse no', async () => {
    const p = newRecoveryPhrase('it');
    const a = await publicIdentity(await fromPhrase(p));
    const b = await publicIdentity(await fromPhrase(p));
    const c = await publicIdentity(await fromPhrase(newRecoveryPhrase('it')));
    expect(sameIdentity(a, b)).toBe(true);
    expect(sameIdentity(a, c)).toBe(false);
    expect(await fingerprint(a)).toMatch(/^(\d{4} ){7}\d{4}$/);
    expect(await fingerprint(a)).toBe(await fingerprint(b));
  });
  it('le chiavi derivate funzionano: cifrare verso l\'utente e firmare', async () => {
    const s = await sodium();
    const id = await fromPhrase(newRecoveryPhrase('en'));
    const sealed = s.crypto_box_seal(s.from_string('chiave dell\'Oikos'), id.box.publicKey);
    expect(s.to_string(s.crypto_box_seal_open(sealed, id.box.publicKey, id.box.privateKey))).toBe('chiave dell\'Oikos');
    const sig = s.crypto_sign_detached(s.from_string('invito'), id.sign.privateKey);
    expect(s.crypto_sign_verify_detached(sig, s.from_string('invito'), id.sign.publicKey)).toBe(true);
  });
});

describe('chiave principale avvolta', () => {
  it('si apre solo con la chiave giusta e se non e\' stata alterata', async () => {
    const s = await sodium();
    const master = await masterFromEntropy(phraseEntropy(newRecoveryPhrase('it'))!);
    const key = await wrappingKeyFrom(s.randombytes_buf(32), 'passkey');
    const w = await wrapMaster(master, key, 'passkey');
    expect(await unwrapMaster(w, key)).toEqual(master);
    expect(await unwrapMaster(w, await wrappingKeyFrom(s.randombytes_buf(32), 'passkey'))).toBeNull();
    // stesso segreto, uso diverso: chiave diversa
    expect(await unwrapMaster({ ...w, kind: 'device' }, key)).toBeNull();
    const ct = w.ct.split('');
    ct[5] = ct[5] === 'A' ? 'B' : 'A';
    expect(await unwrapMaster({ ...w, ct: ct.join('') }, key)).toBeNull();
  });
  it('chiave del dispositivo (WebCrypto, non esportabile)', async () => {
    const master = new Uint8Array(32).fill(7);
    const k = await newDeviceKey();
    expect(k.extractable).toBe(false);
    const w = await wrapWithDevice(master, k);
    expect(await unwrapWithDevice(w, k)).toEqual(master);
    expect(await unwrapWithDevice(w, await newDeviceKey())).toBeNull();
  });
});

describe('collegamento di un nuovo dispositivo', () => {
  it('il nuovo dispositivo riceve la chiave principale e ricostruisce la stessa identita\'', async () => {
    const id = await fromPhrase(newRecoveryPhrase('en'));
    const req = await createLinkRequest();
    const parsed = await parseLinkCode(req.code);
    expect(parsed?.channel).toBe(req.channel);
    // lo stesso codice di verifica sui due schermi
    expect(await verificationCode(parsed!.publicKey)).toBe(await verificationCode(req.publicKey));
    const sealed = await sealMasterFor(id.master, parsed!.publicKey);
    const master = await openLinkedMaster(sealed, req);
    expect(sameIdentity(await publicIdentity(await identityFromMaster(master!)), await publicIdentity(id))).toBe(true);
  });
  it('un altro dispositivo (o il server) non puo\' aprire il messaggio', async () => {
    const req = await createLinkRequest();
    const other = await createLinkRequest();
    const sealed = await sealMasterFor(new Uint8Array(32).fill(1), req.publicKey);
    expect(await openLinkedMaster(sealed, other)).toBeNull();
  });
  it('codici non validi', async () => {
    expect(await parseLinkCode('ciao')).toBeNull();
    expect(await parseLinkCode('ath1-AAAA')).toBeNull();
    expect(await verificationCode(new Uint8Array(32))).toMatch(/^\d{3} \d{3}$/);
  });
});
