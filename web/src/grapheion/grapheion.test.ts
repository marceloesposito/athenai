import { describe, expect, it, beforeAll } from 'vitest';
import * as Y from 'yjs';
import type { LogEntry, SealedBox } from '@athenai/protocol';
import { sodium, toB64 } from '../crypto/sodium';
import { identityFromMaster, type Identity } from '../crypto/keys';
import { newKey } from '../crypto/polis';
import { sealEntry, openEntry, sealNotice, openNotice, type EpochKeys } from '../crypto/tomos';
import { addScholion, addReply, listThreads, setResolved, removeScholion, findMentions, mentionQuery, completeMention, excerpt } from './scholia';
import { docText, search, snippetOf, TEXT_FIELD } from './heuresis';
import { TomosSync, type Transport, type TomosHandlers, type PushRequest } from './sync';

const TOMOS = '7f9c2b1e-3a4d-4e5f-8a6b-1c2d3e4f5a6b';
let alice: Identity;
let bob: Identity;
let pk: Record<string, string>;

beforeAll(async () => {
  const s = await sodium();
  alice = await identityFromMaster(s.randombytes_buf(32));
  bob = await identityFromMaster(s.randombytes_buf(32));
  pk = { alice: toB64(s, alice.sign.publicKey), bob: toB64(s, bob.sign.publicKey) };
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('tempo scaduto');
    await wait(5);
  }
}

/** Server finto: numera le voci, le inoltra agli altri iscritti, compatta come quello vero. */
class FakeServer {
  log: LogEntry[] = [];
  seq = 0;
  epoch = 1;
  subs = new Set<{ who: string; h: TomosHandlers }>();
  transport(who: string): Transport {
    return {
      subscribe: (_id, h) => {
        const sub = { who, h };
        this.subs.add(sub);
        queueMicrotask(() => h.log([...this.log]));
        return () => this.subs.delete(sub);
      },
      push: async (req: PushRequest) => {
        if (req.box.e !== this.epoch) throw new Error('stale-key');
        const entry: LogEntry = { seq: ++this.seq, stream: req.stream, kind: req.kind, author: who, authorPk: '', box: req.box, sig: req.sig };
        if (req.kind === 'snapshot') this.log = this.log.filter((e) => e.stream !== req.stream || e.seq > req.covers!);
        this.log.push(entry);
        for (const s of this.subs) if (s.who !== who) queueMicrotask(() => s.h.entry(entry));
        return entry.seq;
      },
      aw: (_id, box: SealedBox | null) => {
        for (const s of this.subs) if (s.who !== who) s.h.aw(who, `cid-${who}`, box);
      },
    };
  }
}

function client(server: FakeServer, who: 'alice' | 'bob', keys: { epoch: number; ring: EpochKeys }, opts: Partial<{ canText: boolean; refreshKeys: () => Promise<void> }> = {}) {
  const id = who === 'alice' ? alice : bob;
  return new TomosSync({
    tomosId: TOMOS,
    accountId: who,
    signSk: id.sign.privateKey,
    keys: () => keys,
    signPkOf: (a) => pk[a],
    transport: server.transport(who),
    canPush: (stream) => stream === 'scholia' || opts.canText !== false,
    refreshKeys: opts.refreshKeys ?? (async () => undefined),
    snapshotEvery: 5,
    quietMs: 20,
    batchMs: 5,
  });
}

const write = (doc: Y.Doc, text: string) => {
  const frag = doc.getXmlFragment(TEXT_FIELD);
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  frag.push([p]);
};

describe('voci cifrate e firmate', () => {
  it('andata e ritorno; firma di un altro, chiave sbagliata o autore cambiato: rifiutate', async () => {
    const key = await newKey();
    const ring: EpochKeys = new Map([[1, key]]);
    const data = new TextEncoder().encode('ciao');
    const { box, sig } = await sealEntry(key, 1, TOMOS, 'text', 'update', 'alice', data, alice.sign.privateKey);
    const e: LogEntry = { seq: 1, stream: 'text', kind: 'update', author: 'alice', authorPk: '', box, sig };
    expect(await openEntry(TOMOS, e, ring, (a) => pk[a])).toEqual(data);
    // bob si spaccia per alice / alice attribuita a bob / un altro flusso / chiave diversa
    const forged = await sealEntry(key, 1, TOMOS, 'text', 'update', 'alice', data, bob.sign.privateKey);
    expect(await openEntry(TOMOS, { ...e, ...forged }, ring, (a) => pk[a])).toBeNull();
    expect(await openEntry(TOMOS, { ...e, author: 'bob' }, ring, (a) => pk[a])).toBeNull();
    expect(await openEntry(TOMOS, { ...e, stream: 'scholia' }, ring, (a) => pk[a])).toBeNull();
    expect(await openEntry(TOMOS, e, new Map([[1, await newKey()]]), (a) => pk[a])).toBeNull();
  });

  it('Keryx: solo il destinatario apre, e la firma del mittente deve tornare', async () => {
    const s = await sodium();
    const notice = { kind: 'mention' as const, polisId: 'p', oikosId: 'o', tomosId: TOMOS, from: 'alice', excerpt: 'ciao @Bob', at: '2026-10-12T10:00:00Z' };
    const sealed = await sealNotice(notice, { accountId: 'bob', boxPk: toB64(s, bob.box.publicKey) }, alice.sign.privateKey);
    expect(await openNotice(sealed, bob, 'bob', (_p, a) => pk[a])).toEqual(notice);
    expect(await openNotice(sealed, alice, 'alice', (_p, a) => pk[a])).toBeNull();
    // se dice di venire da bob, la firma (di alice) non torna
    const lie = await sealNotice({ ...notice, from: 'bob' }, { accountId: 'bob', boxPk: toB64(s, bob.box.publicKey) }, alice.sign.privateKey);
    expect(await openNotice(lie, bob, 'bob', (_p, a) => pk[a])).toBeNull();
  });
});

describe('Scholia', () => {
  it('discussioni, risposte, risolto; solo l\'autore cancella', () => {
    const doc = new Y.Doc();
    addScholion(doc, { id: 's1', author: 'alice', body: 'Chiarire', created: '2026-01-01', anchor: null, resolved: false, mentions: [] });
    addReply(doc, { id: 'r2', parent: 's1', author: 'bob', body: 'Fatto', created: '2026-01-03', mentions: [] });
    addReply(doc, { id: 'r1', parent: 's1', author: 'alice', body: 'Grazie', created: '2026-01-02', mentions: [] });
    addReply(doc, { id: 'rx', parent: 'nessuno', author: 'bob', body: 'x', created: '2026-01-02', mentions: [] });
    setResolved(doc, 's1', true);
    const [t] = listThreads(doc);
    expect(t.resolved).toBe(true);
    expect(t.replies.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(removeScholion(doc, 's1', 'bob')).toBe(false);
    expect(removeScholion(doc, 's1', 'alice')).toBe(true);
    expect(listThreads(doc)).toEqual([]);
    expect(doc.getMap('replies').size).toBe(0);
  });

  it('@menzioni: nomi composti, maiuscole, confini di parola', () => {
    const people = [
      { accountId: 'a', name: 'Anna' },
      { accountId: 'am', name: 'Anna Maria' },
      { accountId: 'p', name: 'Pericle' },
    ];
    expect(findMentions('Ciao @anna maria e @Pericle!', people).sort()).toEqual(['am', 'p']);
    expect(findMentions('@Anna, guarda', people)).toEqual(['a']);
    expect(findMentions('@Annalisa no', people)).toEqual([]);
    expect(findMentions('email@anna.it', people)).toEqual(['a']); // basta la @: e' l'utente a scegliere dal menu
    expect(mentionQuery('ciao @An', 8)).toEqual({ start: 5, query: 'An' });
    expect(mentionQuery('ciao @Anna Ma', 13)).toEqual({ start: 5, query: 'Anna Ma' });
    expect(mentionQuery('ciao Anna', 9)).toBeNull();
    expect(completeMention('ciao @An!', 5, 8, 'Anna Maria')).toEqual({ text: 'ciao @Anna Maria !', caret: 17 });
    expect(excerpt('a'.repeat(200), 10)).toHaveLength(10);
  });
});

describe('Heuresis', () => {
  it('testo dei blocchi, passi senza accenti, titoli approssimati', () => {
    const doc = new Y.Doc();
    write(doc, 'Primo paragrafo.');
    write(doc, 'La città di Pericle e la democrazia.');
    expect(docText(doc)).toBe('Primo paragrafo.\nLa città di Pericle e la democrazia.');
    expect(snippetOf(docText(doc), 'CITTA', 5)).toBe('…. La città di P…');
    const hits = search('pericle', [
      { id: '1', title: 'Appunti', text: docText(doc) },
      { id: '2', title: 'Pericle, discorso', text: null },
      { id: '3', title: 'Altro', text: 'niente' },
    ]);
    expect(hits.map((h) => h.id)).toEqual(['2', '1']);
    expect(hits[1].snippet).toContain('Pericle');
    expect(search('  ', [{ id: '1', title: 'x', text: 'x' }])).toEqual([]);
  });
});

describe('sincronizzazione cifrata', () => {
  it('due client convergono; chi arriva dopo legge tutto, anche dopo lo stato intero', async () => {
    const server = new FakeServer();
    const keys = { epoch: 1, ring: new Map([[1, await newKey()]]) as EpochKeys };
    const a = client(server, 'alice', keys);
    const b = client(server, 'bob', keys);
    await Promise.all([a.loaded, b.loaded]);
    for (let i = 0; i < 8; i++) {
      write(a.text, `alice ${i}`);
      await wait(8);
    }
    write(b.text, 'bob 1');
    addScholion(b.scholia, { id: 's', author: 'bob', body: 'nota', created: 'x', anchor: null, resolved: false, mentions: [] });
    await until(() => docText(a.text).includes('bob 1') && docText(b.text).includes('alice 7') && listThreads(a.scholia).length === 1);
    // il registro si e' accorciato con uno stato intero
    await until(() => server.log.some((e) => e.kind === 'snapshot' && e.stream === 'text'));
    expect(server.log.filter((e) => e.stream === 'text').length).toBeLessThan(9);
    // sul server niente in chiaro
    expect(JSON.stringify(server.log)).not.toContain('alice 3');
    const c = client(server, 'alice', keys);
    await c.loaded;
    expect(docText(c.text)).toBe(docText(a.text));
    expect(listThreads(c.scholia)[0].body).toBe('nota');
    for (const x of [a, b, c]) x.destroy();
  });

  it('una voce falsa si ignora; dopo la rotazione si ricaricano le chiavi e si riprova', async () => {
    const server = new FakeServer();
    const k1 = await newKey();
    const keys = { epoch: 1, ring: new Map([[1, k1]]) as EpochKeys };
    const k2 = await newKey();
    let refreshed = 0;
    const a = client(server, 'alice', keys, {
      refreshKeys: async () => {
        refreshed++;
        keys.epoch = 2;
        keys.ring.set(2, k2);
      },
    });
    await a.loaded;
    // bob scrive con la firma di bob ma dichiarandosi alice: ignorata
    const forged = await sealEntry(k1, 1, TOMOS, 'text', 'update', 'alice', Y.encodeStateAsUpdate(new Y.Doc()), bob.sign.privateKey);
    for (const s of server.subs) s.h.entry({ seq: 99, stream: 'text', kind: 'update', author: 'alice', authorPk: '', ...forged });
    await until(() => a.rejected === 1);
    // il server passa all'epoca 2: la modifica torna in coda, le chiavi si ricaricano, poi parte
    server.epoch = 2;
    write(a.text, 'dopo la rotazione');
    await until(() => server.log.some((e) => e.box.e === 2));
    expect(refreshed).toBeGreaterThanOrEqual(1);
    const b = client(server, 'bob', { epoch: 2, ring: new Map([[2, k2]]) });
    await b.loaded;
    expect(docText(b.text)).toBe('dopo la rotazione');
    a.destroy();
    b.destroy();
  });

  it('Xenos e Mentore: niente modifiche al testo in uscita', async () => {
    const server = new FakeServer();
    const keys = { epoch: 1, ring: new Map([[1, await newKey()]]) as EpochKeys };
    const m = client(server, 'bob', keys, { canText: false });
    await m.loaded;
    write(m.text, 'non deve partire');
    addScholion(m.scholia, { id: 's', author: 'bob', body: 'si', created: 'x', anchor: null, resolved: false, mentions: [] });
    await until(() => server.log.length === 1);
    await wait(30);
    expect(server.log.map((e) => e.stream)).toEqual(['scholia']);
    m.destroy();
  });

  it('presenza: arriva cifrata e sparisce quando l\'altro chiude', async () => {
    const server = new FakeServer();
    const keys = { epoch: 1, ring: new Map([[1, await newKey()]]) as EpochKeys };
    const a = client(server, 'alice', keys);
    const b = client(server, 'bob', keys);
    await Promise.all([a.loaded, b.loaded]);
    b.awareness.setLocalStateField('user', { name: 'Bob', color: '#123456' });
    await until(() => [...a.presentAccounts().values()].some((u) => u.name === 'Bob'));
    b.destroy();
    await until(() => a.presentAccounts().size === 0);
    a.destroy();
  });
});
