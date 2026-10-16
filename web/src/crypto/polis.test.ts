import { describe, expect, it } from 'vitest';
import { AD, parseInviteLink, parseGuestLink, type PolisDetail } from '@athenai/protocol';
import { identityFromMaster, publicIdentity, type Identity } from './keys';
import { sodium } from './sodium';
import { createPolisRequest, createInvite, acceptInvite, createSymposionRequest, createGuestLinkRequest, openGuestLink, rotationRequest, keyring, openJson, openBox, sealKeyFor } from './polis';

async function person(seed: number): Promise<{ id: Identity; boxPk: string; accountId: string }> {
  const id = await identityFromMaster(new Uint8Array(32).fill(seed));
  return { id, boxPk: (await publicIdentity(id)).box, accountId: crypto.randomUUID() };
}

/** Quello che il server restituirebbe a `me` (solo le sue buste). */
function view(base: Omit<PolisDetail, 'myKeys'>, keys: Map<string, { epoch: number; sealed: string }[]>, me: string): PolisDetail {
  return { ...base, myKeys: keys.get(me) ?? [] };
}

describe('Polis cifrata', () => {
  it('fondazione, invito, adesione, Symposion, uscita e rotazione: chi legge cosa', async () => {
    const a = await person(1);
    const b = await person(2);
    const c = await person(3);
    const { req, key } = await createPolisRequest(a.accountId, a.boxPk, 'Accademia', { name: 'Platone' });
    expect((await openJson<{ name: string }>(key, req.meta, AD.polisMeta(req.id)))?.name).toBe('Accademia');

    const keys = new Map<string, { epoch: number; sealed: string }[]>([[a.accountId, [{ epoch: 1, sealed: req.sealed }]]]);
    for (const p of [b, c]) {
      const inv = await createInvite('https://athenai.example', key, 1);
      const parsed = parseInviteLink(inv.link)!;
      expect(new URL(inv.link).pathname).not.toContain(parsed.secret);
      const acc = await acceptInvite(parsed.inviteId, parsed.secret, { polisId: req.id, key: inv.req.key }, p.accountId, p.boxPk, { name: 'x' });
      expect(acc?.key).toEqual(key);
      keys.set(p.accountId, [{ epoch: 1, sealed: acc!.req.sealed }]);
    }
    // segreto sbagliato: niente chiave
    const inv = await createInvite('https://athenai.example', key, 1);
    const s = await sodium();
    expect(await acceptInvite(inv.req.id, s.to_base64(s.randombytes_buf(32), s.base64_variants.URLSAFE_NO_PADDING), { polisId: req.id, key: inv.req.key }, b.accountId, b.boxPk, { name: 'x' })).toBeNull();

    const sym = await createSymposionRequest(key, 1, 'Simposio');
    const base1: Omit<PolisDetail, 'myKeys'> = {
      id: req.id, role: 'archon', meta: req.meta, epoch: 1, rotationNeeded: false, chain: [], invites: [], links: [], guests: [],
      members: [a, b, c].map((p) => ({ accountId: p.accountId, signPk: 'x', boxPk: p.boxPk, role: 'polites', profile: null, joinedAt: '' })),
      symposia: [{ id: sym.req.id, meta: sym.req.meta, epoch: 1, createdAt: '', keys: [{ epoch: 1, polisEpoch: 1, wrapped: sym.req.key }] }],
    };
    const ringC1 = await keyring(view(base1, keys, c.accountId), c.id);
    const symKey1 = ringC1.symposia.get(sym.req.id)!.get(1)!;
    expect(symKey1).toEqual(sym.key);
    expect((await openJson<{ name: string }>(symKey1, sym.req.meta, AD.symposionMeta(sym.req.id)))?.name).toBe('Simposio');

    // b esce: rotazione verso a e c soltanto
    const base1b = { ...base1, members: base1.members.filter((m) => m.accountId !== b.accountId), rotationNeeded: true };
    const ringA = await keyring(view(base1b, keys, a.accountId), a.id);
    const rot = (await rotationRequest(view(base1b, keys, a.accountId), ringA, { name: 'Accademia' }))!;
    expect(rot.envelopes.map((e) => e.accountId).sort()).toEqual([a.accountId, c.accountId].sort());
    for (const e of rot.envelopes) keys.get(e.accountId)!.push({ epoch: 2, sealed: e.sealed });

    const base2: Omit<PolisDetail, 'myKeys'> = {
      ...base1b, epoch: 2, rotationNeeded: false, meta: rot.meta, chain: [{ epoch: 2, prev: rot.prev }],
      symposia: [{ ...base1.symposia[0], epoch: 2, keys: [...base1.symposia[0].keys, { epoch: 2, polisEpoch: 2, wrapped: rot.symposia[0].key }] }],
    };
    const ringC2 = await keyring(view(base2, keys, c.accountId), c.id);
    expect(ringC2.polis.get(1)).toEqual(key);
    expect(ringC2.symposia.get(sym.req.id)!.get(1)).toEqual(symKey1);
    expect(ringC2.symposia.get(sym.req.id)!.get(2)).toBeDefined();
    // b vede la Polis com'era, non l'epoca nuova
    const ringB = await keyring(view(base2, keys, b.accountId), b.id);
    expect(ringB.polis.get(1)).toEqual(key);
    expect(ringB.polis.has(2)).toBe(false);
    expect(ringB.symposia.get(sym.req.id)!.has(2)).toBe(false);
  });

  it('link per gli ospiti: tutte le chiavi del Symposion e il nome, solo con il segreto del frammento', async () => {
    const s = await sodium();
    const ring = new Map([
      [1, s.randombytes_buf(32)],
      [2, s.randombytes_buf(32)],
    ]);
    const { req, link } = await createGuestLinkRequest('https://athenai.example', ring, 2, 'Simposio', 'comment');
    const parsed = parseGuestLink(link)!;
    expect(parsed.linkId).toBe(req.id);
    expect(new URL(link).pathname).not.toContain(parsed.secret);
    const opened = await openGuestLink(parsed.linkId, parsed.secret, req.key, req.meta);
    expect(opened?.name).toBe('Simposio');
    expect(opened?.keys.get(1)).toEqual(ring.get(1));
    expect(opened?.keys.get(2)).toEqual(ring.get(2));
    expect(await openGuestLink(parsed.linkId, s.to_base64(s.randombytes_buf(32), s.base64_variants.URLSAFE_NO_PADDING), req.key, req.meta)).toBeNull();
    expect(await openGuestLink(crypto.randomUUID(), parsed.secret, req.key, req.meta)).toBeNull();
  });

  it('una busta spostata su un altro oggetto non si apre', async () => {
    const a = await person(4);
    const { req, key } = await createPolisRequest(a.accountId, a.boxPk, 'Liceo', { name: 'Aristotele' });
    expect(await openBox(key, req.meta, AD.polisMeta(crypto.randomUUID()))).toBeNull();
    expect(await openBox(key, req.profile, AD.profile(req.id, crypto.randomUUID()))).toBeNull();
    expect(typeof (await sealKeyFor(a.boxPk, key))).toBe('string');
  });
});
