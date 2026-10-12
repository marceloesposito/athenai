// Scholia (commenti) di un Tomos: vivono nel flusso "scholia", un documento Yjs separato dal testo
// (cosi' il Mentore puo' commentare senza poter toccare il testo). Ogni Scholion e ogni risposta e'
// una voce a se' di una mappa Yjs: modifiche concorrenti non si pestano i piedi. L'ancora e' una
// coppia di posizioni relative Yjs nel documento del testo: resta al suo posto mentre gli altri
// scrivono. Funzioni pure sul documento.
import * as Y from 'yjs';

export interface Anchor {
  /** Y.RelativePosition in JSON (vedi Y.relativePositionToJSON) */
  from: unknown;
  to: unknown;
  /** il testo commentato, per riconoscerlo se l'ancora si perde */
  quote: string;
}

export interface Scholion {
  id: string;
  author: string;
  body: string;
  created: string;
  anchor: Anchor | null;
  resolved: boolean;
  mentions: string[];
}

export interface Reply {
  id: string;
  parent: string;
  author: string;
  body: string;
  created: string;
  mentions: string[];
}

export interface Thread extends Scholion {
  replies: Reply[];
}

const threads = (doc: Y.Doc) => doc.getMap<Scholion>('scholia');
const replies = (doc: Y.Doc) => doc.getMap<Reply>('replies');

export const newId = () => crypto.randomUUID();

export function listThreads(doc: Y.Doc): Thread[] {
  const all = [...replies(doc).values()];
  return [...threads(doc).values()]
    .map((s) => ({ ...s, replies: all.filter((r) => r.parent === s.id).sort((a, b) => a.created.localeCompare(b.created)) }))
    .sort((a, b) => a.created.localeCompare(b.created));
}

export function addScholion(doc: Y.Doc, s: Scholion) {
  threads(doc).set(s.id, s);
}

export function addReply(doc: Y.Doc, r: Reply) {
  if (threads(doc).has(r.parent)) replies(doc).set(r.id, r);
}

export function setResolved(doc: Y.Doc, id: string, resolved: boolean) {
  const s = threads(doc).get(id);
  if (s && s.resolved !== resolved) threads(doc).set(id, { ...s, resolved });
}

/** Solo l'autore cancella il proprio Scholion (con le risposte). */
export function removeScholion(doc: Y.Doc, id: string, by: string): boolean {
  const s = threads(doc).get(id);
  if (!s || s.author !== by) return false;
  doc.transact(() => {
    threads(doc).delete(id);
    for (const [k, r] of replies(doc)) if (r.parent === id) replies(doc).delete(k);
  });
  return true;
}

// ---------------------------------------------------------------- @menzioni

export interface Mentionable {
  accountId: string;
  name: string;
}

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase();

/** Gli account menzionati nel testo come @Nome (i nomi piu' lunghi prima: "@Anna Maria" non e' "@Anna"). */
export function findMentions(body: string, people: Mentionable[]): string[] {
  const text = norm(body);
  const found = new Set<string>();
  const sorted = [...people].filter((p) => p.name.trim()).sort((a, b) => b.name.length - a.name.length);
  let i = text.indexOf('@');
  while (i >= 0) {
    const rest = text.slice(i + 1);
    const p = sorted.find((p) => {
      const n = norm(p.name.trim());
      return rest.startsWith(n) && !/[\p{L}\p{N}]/u.test(rest.charAt(n.length));
    });
    if (p) found.add(p.accountId);
    i = text.indexOf('@', i + 1);
  }
  return [...found];
}

/** La menzione che si sta scrivendo prima del cursore ("@an" → "an"), o null. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  // al massimo due parole: i nomi composti ("@Anna Maria")
  const m = /(^|\s)@([\p{L}\p{N}'.-]{0,30}(?: [\p{L}\p{N}'.-]{0,30})?)$/u.exec(before);
  return m ? { start: before.length - m[2].length - 1, query: m[2] } : null;
}

/** Sostituisce la menzione in corso con "@Nome ". */
export function completeMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const ins = `@${name} `;
  return { text: text.slice(0, start) + ins + text.slice(caret), caret: start + ins.length };
}

export function excerpt(body: string, max = 140): string {
  const one = body.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}
