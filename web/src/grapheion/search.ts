// Ricerca locale nei documenti di un Symposion. I testi si decifrano nel browser e si cercano qui;
// al server non arriva nessuna parola cercata. Funzioni pure.
import * as Y from 'yjs';
import { fuzzyScore } from 'logos/lib/fuzzy';

/** Il campo del documento Yjs che TipTap (Collaboration) usa per il testo. */
export const TEXT_FIELD = 'default';

/** Testo semplice di un frammento Yjs di ProseMirror: un blocco per riga. */
export function fragmentText(frag: Y.XmlFragment | Y.XmlElement): string {
  const out: string[] = [];
  const walk = (node: Y.XmlFragment | Y.XmlElement | Y.XmlText, into: string[]) => {
    if (node instanceof Y.XmlText) {
      into.push((node.toDelta() as { insert: unknown }[]).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join(''));
      return;
    }
    const kids = node.toArray() as (Y.XmlElement | Y.XmlText)[];
    const inline = kids.every((k) => k instanceof Y.XmlText || k.nodeName === 'hardBreak');
    if (inline) {
      const parts: string[] = [];
      for (const k of kids) {
        if (k instanceof Y.XmlText) walk(k, parts);
        else parts.push('\n');
      }
      into.push(parts.join(''));
    } else for (const k of kids) walk(k, into);
  };
  walk(frag, out);
  return out.filter((l, i) => l || i > 0).join('\n');
}

export const docText = (doc: Y.Doc) => fragmentText(doc.getXmlFragment(TEXT_FIELD));

export interface Searchable {
  id: string;
  title: string;
  /** null finche' il testo non e' stato decifrato */
  text: string | null;
}

export interface Hit {
  id: string;
  title: string;
  /** il passo del testo che contiene la ricerca, se c'e' */
  snippet: string | null;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Il passo intorno alla prima occorrenza (senza accenti e maiuscole), o null. */
export function snippetOf(text: string, query: string, radius = 60): string | null {
  const q = fold(query.trim());
  if (!q) return null;
  // la normalizzazione toglie gli accenti combinati: si cerca carattere per carattere sul testo piegato
  const folded = [...text].map((c) => fold(c));
  const joined = folded.join('');
  const at = joined.indexOf(q);
  if (at < 0) return null;
  let pos = 0;
  let start = 0;
  for (let i = 0; i < folded.length; i++) {
    if (pos >= at) {
      start = i;
      break;
    }
    pos += folded[i].length;
  }
  const chars = [...text];
  const from = Math.max(0, start - radius);
  const to = Math.min(chars.length, start + [...q].length + radius);
  return `${from > 0 ? '…' : ''}${chars.slice(from, to).join('').replace(/\s+/g, ' ').trim()}${to < chars.length ? '…' : ''}`;
}

/** Documenti che corrispondono: prima per titolo (approssimato), poi per testo (esatto, senza accenti). */
export function search(query: string, items: Searchable[]): Hit[] {
  if (!query.trim()) return [];
  const scored = items
    .map((it, i) => {
      const t = fuzzyScore(query, it.title);
      const snippet = it.text ? snippetOf(it.text, query) : null;
      const score = Math.max(t ?? -Infinity, snippet ? 500 : -Infinity);
      return { it, i, score, snippet };
    })
    .filter((r) => r.score > -Infinity)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((r) => ({ id: r.it.id, title: r.it.title, snippet: r.snippet }));
}
