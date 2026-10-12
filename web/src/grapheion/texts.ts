// Testi dei Tomoi per Heuresis: si scaricano cifrati, si aprono qui e restano solo in memoria (mai
// nel browser), finche' il Tomos non cambia.
import * as Y from 'yjs';
import { api, onToken } from '../api/client';
import { usePolis, oikosKeys } from '../state/polis';
import { openEntry } from '../crypto/tomos';
import { docText } from './heuresis';

const cache = new Map<string, { version: string; text: string }>();

export async function tomosText(oikosId: string, tomosId: string, version: string): Promise<string> {
  const hit = cache.get(tomosId);
  if (hit?.version === version) return hit.text;
  const { ring } = oikosKeys(oikosId);
  const members = new Map(usePolis.getState().current?.members.map((m) => [m.accountId, m.signPk]) ?? []);
  const doc = new Y.Doc();
  for (const e of await api.tomosLog(tomosId)) {
    if (e.stream !== 'text') continue;
    const data = await openEntry(tomosId, e, ring, (a) => members.get(a));
    if (data) Y.applyUpdate(doc, data);
  }
  const text = docText(doc);
  doc.destroy();
  cache.set(tomosId, { version, text });
  return text;
}

// al blocco o all'uscita: niente testi in chiaro in memoria
onToken((t) => t || cache.clear());
