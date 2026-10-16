import { describe, expect, it } from 'vitest';
import { newKdf, passwordKeys, newMaster, wrapMasterWith, unwrapMasterWith, newRecoveryCode, normalizeRecoveryCode, recoveryKeys, passwordStrength } from './password';
import { identityFromMaster, publicIdentity } from './keys';
import { newDeviceKey, wrapWithDevice, unwrapWithDevice } from './deviceKey';

// parametri leggeri per i test (in uso: 3 passaggi, 64 MiB)
const LIGHT = { ops: 2, mem: 32 * 1024 * 1024 };

describe('password', () => {
  it('stessa password e sale: stesse chiavi; la chiave d\'accesso non e\' quella che avvolge', async () => {
    const kdf = await newKdf(LIGHT);
    const a = await passwordKeys('Ateniesi, ascoltate!', kdf);
    const b = await passwordKeys('Ateniesi, ascoltate!', kdf);
    expect(a.authKey).toBe(b.authKey);
    expect(a.wrapKey).toEqual(b.wrapKey);
    expect(Buffer.from(a.wrapKey).toString('base64url')).not.toBe(a.authKey);
    expect((await passwordKeys('Ateniesi, ascoltate?', kdf)).authKey).not.toBe(a.authKey);
    expect((await passwordKeys('Ateniesi, ascoltate!', await newKdf(LIGHT))).authKey).not.toBe(a.authKey);
  });

  it('la chiave principale si riapre solo con la password giusta e ridà la stessa identità', async () => {
    const kdf = await newKdf(LIGHT);
    const master = await newMaster();
    const { wrapKey } = await passwordKeys('una password lunga', kdf);
    const box = await wrapMasterWith(wrapKey, master, 'password');
    const again = await unwrapMasterWith((await passwordKeys('una password lunga', kdf)).wrapKey, box, 'password');
    expect(again).toEqual(master);
    expect(await publicIdentity(await identityFromMaster(again!))).toEqual(await publicIdentity(await identityFromMaster(master)));
    expect(await unwrapMasterWith((await passwordKeys('un\'altra password', kdf)).wrapKey, box, 'password')).toBeNull();
    // un involucro "password" non vale come "recovery"
    expect(await unwrapMasterWith(wrapKey, box, 'recovery')).toBeNull();
  });

  it('codice di recupero: 24 caratteri, si accetta come lo scrive una persona', async () => {
    const code = await newRecoveryCode();
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/);
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code.replace(/-/g, ''));
    expect(normalizeRecoveryCode('troppo corto')).toBeNull();
    const k1 = await recoveryKeys(code);
    const k2 = await recoveryKeys(code.toLowerCase());
    expect(k1!.recoveryAuth).toBe(k2!.recoveryAuth);
    const master = await newMaster();
    const box = await wrapMasterWith(k1!.wrapKey, master, 'recovery');
    expect(await unwrapMasterWith(k2!.wrapKey, box, 'recovery')).toEqual(master);
    expect(await unwrapMasterWith((await recoveryKeys(await newRecoveryCode()))!.wrapKey, box, 'recovery')).toBeNull();
  });

  it('robustezza: corte o note sono deboli', () => {
    expect(passwordStrength('corta')).toBe(0);
    expect(passwordStrength('password1234')).toBe(1);
    expect(passwordStrength('cavallo batteria graffetta')).toBeGreaterThanOrEqual(3);
    expect(passwordStrength('Pericle-431aC!')).toBe(4);
  });

  it('resta connesso: chiave del browser non esportabile', async () => {
    const master = await newMaster();
    const key = await newDeviceKey();
    const w = await wrapWithDevice(master, key);
    expect(await unwrapWithDevice(w, key)).toEqual(master);
    expect(await unwrapWithDevice(w, await newDeviceKey())).toBeNull();
  });
});
