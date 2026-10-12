// Ancore degli Scholia nel testo: dalle posizioni di ProseMirror alle posizioni relative di Yjs (che
// seguono il testo mentre gli altri scrivono) e ritorno; e un'estensione che evidenzia i passi
// commentati.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import * as Y from 'yjs';
import { ySyncPluginKey, absolutePositionToRelativePosition, relativePositionToAbsolutePosition } from '@tiptap/y-tiptap';
import type { Anchor, Thread } from './scholia';

interface SyncState {
  doc: Y.Doc;
  type: Y.XmlFragment;
  binding: { mapping: Map<unknown, unknown> } | null;
}

const syncState = (state: EditorState) => ySyncPluginKey.getState(state) as SyncState | undefined;

/** L'ancora della selezione corrente, o null se non c'e' selezione. */
export function anchorFromSelection(state: EditorState): Anchor | null {
  const { from, to } = state.selection;
  const ys = syncState(state);
  if (from === to || !ys?.binding) return null;
  const rel = (pos: number) => Y.relativePositionToJSON(absolutePositionToRelativePosition(pos, ys.type, ys.binding!.mapping as never));
  return { from: rel(from), to: rel(to), quote: state.doc.textBetween(from, to, ' ').slice(0, 500) };
}

/** Dove si trova oggi un'ancora nel documento (null se il testo commentato non c'e' piu'). */
export function resolveAnchor(state: EditorState, a: Anchor | null): { from: number; to: number } | null {
  const ys = syncState(state);
  if (!a || !ys?.binding) return null;
  try {
    const abs = (j: unknown) => relativePositionToAbsolutePosition(ys.doc, ys.type, Y.createRelativePositionFromJSON(j), ys.binding!.mapping as never);
    const from = abs(a.from);
    const to = abs(a.to);
    if (from === null || to === null || to <= from) return null;
    return { from, to };
  } catch {
    return null;
  }
}

export interface Highlight {
  id: string;
  from: number;
  to: number;
  active: boolean;
}

export function highlights(state: EditorState, threads: Thread[], active: string | null): Highlight[] {
  const out: Highlight[] = [];
  for (const t of threads) {
    if (t.resolved) continue;
    const r = resolveAnchor(state, t.anchor);
    if (r) out.push({ id: t.id, ...r, active: t.id === active });
  }
  return out;
}

export const scholiaKey = new PluginKey<DecorationSet>('scholia');

/** Evidenzia i passi commentati; i passi si impostano con setScholia (meta della transazione). */
export const ScholiaHighlight = Extension.create<{ onClick: (id: string) => void }>({
  name: 'scholiaHighlight',
  addOptions() {
    return { onClick: () => undefined };
  },
  addProseMirrorPlugins() {
    const onClick = this.options.onClick;
    return [
      new Plugin<DecorationSet>({
        key: scholiaKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const next = tr.getMeta(scholiaKey) as Highlight[] | undefined;
            if (next) {
              const max = tr.doc.content.size;
              return DecorationSet.create(
                tr.doc,
                next
                  .filter((h) => h.from >= 0 && h.to <= max)
                  .map((h) => Decoration.inline(h.from, h.to, { class: h.active ? 'scholion-mark is-active' : 'scholion-mark' }, { id: h.id })),
              );
            }
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => scholiaKey.getState(state),
          handleClick(view, pos) {
            const found = scholiaKey.getState(view.state)?.find(pos, pos);
            if (found?.length) onClick((found[0].spec as { id: string }).id);
            return false;
          },
        },
      }),
    ];
  },
});
