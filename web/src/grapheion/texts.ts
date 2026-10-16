// Testi dei documenti per la ricerca: si scaricano cifrati, si aprono qui e restano solo in memoria
// (mai nel browser), finche' il documento non cambia.
import * as Y from 'yjs';
import { api, onToken } from '../api/client';
import { symposionKeys, people } from '../state/work';
import { openEntry } from '../crypto/docs';
import { docText } from './search';

const cache = new Map<string, { version: string; text: string }>();

export async function documentText(symposionId: string, documentId: string, version: string): Promise<string> {
  const hit = cache.get(documentId);
  if (hit?.version === version) return hit.text;
  const { ring } = symposionKeys(symposionId);
  const keys = new Map(people(symposionId).map((p) => [p.id, p.signPk]));
  const doc = new Y.Doc();
  for (const e of await api.documentLog(documentId)) {
    if (e.stream !== 'text') continue;
    const data = await openEntry(documentId, e, ring, (a) => keys.get(a));
    if (data) Y.applyUpdate(doc, data);
  }
  const text = docText(doc);
  doc.destroy();
  cache.set(documentId, { version, text });
  return text;
}

// all'uscita: niente testi in chiaro in memoria
onToken((t) => t || cache.clear());
