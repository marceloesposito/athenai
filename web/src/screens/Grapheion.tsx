// Grapheion: si scrive insieme. A sinistra i documenti del Symposion (con la ricerca), al centro il
// foglio, a destra gli Scholia quando servono. Chi c'e' e il salvataggio stanno nella barra in alto.
// Tutto cio' che si scrive parte cifrato (vedi grapheion/sync.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquareText, Plus, Search, Trash2, FileText, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEditor, EditorContent, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { can, canPush } from '@athenai/protocol';
import { countText } from 'logos/doc/counts';
import { t, useLang } from '../i18n';
import { useWork, symposionKeys, myRole, people } from '../state/work';
import { useSession } from '../state/session';
import { usePrefs } from '../state/prefs';
import { useDocStatus } from '../state/doc';
import { notifyMentions } from '../state/notices';
import { live } from '../live/socket';
import { DocSync } from '../grapheion/sync';
import { TEXT_FIELD, search } from '../grapheion/search';
import { documentText } from '../grapheion/texts';
import { ScholiaHighlight, scholiaKey, anchorFromSelection, highlights, resolveAnchor } from '../grapheion/anchors';
import { addScholion, addReply, listThreads, setResolved, removeScholion, findMentions, excerpt, newId, type Thread, type Anchor } from '../grapheion/scholia';
import { ScholiaPanel } from './ScholiaPanel';

/** Colore della presenza, stabile per persona (dai token del tema). */
export function presenceColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--series-${(h % 8) + 1})`;
}

export function Grapheion() {
  useLang();
  const view = useWork((s) => s.view);
  const [sideOpen, setSideOpen] = useState(true);
  if (view.kind !== 'symposion') return null;
  return (
    <div className="grapheion">
      {sideOpen ? (
        <DocList symposionId={view.symposionId} active={view.documentId} onCollapse={() => setSideOpen(false)} />
      ) : (
        <button className="side-tab" onClick={() => setSideOpen(true)} title={t('doc.list')} aria-label={t('doc.list')}>
          <PanelLeftOpen size={15} />
        </button>
      )}
      {view.documentId ? <Editor key={view.documentId} symposionId={view.symposionId} documentId={view.documentId} /> : <EmptyDocs />}
    </div>
  );
}

function EmptyDocs() {
  const { newDocument } = useWork();
  const role = myRole();
  return (
    <main className="soon">
      <FileText size={36} strokeWidth={1.4} className="soon__icon" />
      <p>{t(can.write(role.role, role.mode) ? 'doc.empty' : 'doc.emptyRead')}</p>
      {can.write(role.role, role.mode) && (
        <button className="btn btn--primary" onClick={() => void newDocument()}>
          <Plus size={15} /> {t('doc.new')}
        </button>
      )}
    </main>
  );
}

/** I documenti del Symposion; la ricerca guarda anche dentro i testi (decifrati qui, in memoria). */
function DocList({ symposionId, active, onCollapse }: { symposionId: string; active: string | null; onCollapse: () => void }) {
  const { docs, openDocument, newDocument } = useWork();
  const role = myRole();
  const [query, setQuery] = useState('');
  const [texts, setTexts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!query.trim() || !docs) return;
    let alive = true;
    void (async () => {
      for (const d of docs) {
        const text = await documentText(symposionId, d.id, d.updatedAt).catch(() => null);
        if (!alive) return;
        if (text !== null) setTexts((x) => (x[d.id] === text ? x : { ...x, [d.id]: text }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [query, docs, symposionId]);
  const hits = useMemo(() => search(query, (docs ?? []).map((d) => ({ id: d.id, title: d.title || t('doc.untitled'), text: texts[d.id] ?? null }))), [query, docs, texts]);
  return (
    <aside className="side" aria-label={t('doc.list')}>
      <div className="side__head">
        <span className="side__title">{t('doc.list')}</span>
        {can.write(role.role, role.mode) && (
          <button className="icon-btn" onClick={() => void newDocument()} title={t('doc.new')} aria-label={t('doc.new')}>
            <Plus size={15} />
          </button>
        )}
        <button className="icon-btn" onClick={onCollapse} title={t('common.collapse')} aria-label={t('common.collapse')}>
          <PanelLeftClose size={15} />
        </button>
      </div>
      <label className="side__search">
        <Search size={13} aria-hidden />
        <input type="search" placeholder={t('doc.search')} aria-label={t('doc.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul className="side__list">
        {query.trim()
          ? hits.map((h) => (
              <li key={h.id}>
                <button className={`side__item ${h.id === active ? 'is-active' : ''}`} onClick={() => openDocument(h.id)}>
                  <span>{h.title}</span>
                  {h.snippet && <span className="side__snippet">{h.snippet}</span>}
                </button>
              </li>
            ))
          : docs?.map((d) => (
              <li key={d.id}>
                <button className={`side__item ${d.id === active ? 'is-active' : ''}`} onClick={() => openDocument(d.id)}>
                  <FileText size={14} className="side__icon" />
                  <span>{d.title || t('doc.untitled')}</span>
                </button>
              </li>
            ))}
        {query.trim() && !hits.length && <li className="hint side__none">{t('doc.noMatch')}</li>}
      </ul>
    </aside>
  );
}

/** Il foglio di un documento: sincronizzazione cifrata, editor, commenti. */
function Editor({ symposionId, documentId }: { symposionId: string; documentId: string }) {
  const identity = useSession((s) => s.identity);
  const [sync, setSync] = useState<DocSync | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!identity) return;
    const s = new DocSync({
      documentId,
      accountId: myRole().id,
      signSk: identity.sign.privateKey,
      keys: () => symposionKeys(symposionId),
      signPkOf: (a) => people(symposionId).find((p) => p.id === a)?.signPk,
      transport: live,
      canPush: (stream) => {
        const r = myRole();
        return canPush(r.role, stream, r.mode);
      },
      refreshKeys: () => useWork.getState().reload(),
    });
    setSync(s);
    let alive = true;
    void s.loaded.then(() => alive && setReady(true));
    return () => {
      alive = false;
      s.destroy();
      setSync(null);
      setReady(false);
      useDocStatus.setState({ status: null, present: [] });
    };
  }, [documentId, symposionId, identity]);
  if (!sync || !ready) return <main className="loading" aria-busy="true" />;
  return <Sheet sync={sync} symposionId={symposionId} documentId={documentId} />;
}

function Sheet({ sync, symposionId, documentId }: { sync: DocSync; symposionId: string; documentId: string }) {
  const { docs, renameDocument, deleteDocument } = useWork();
  const guest = useSession((s) => s.guest);
  const myName = usePrefs((s) => s.name);
  const role = myRole();
  const writer = can.write(role.role, role.mode);
  const me = role.id;
  const displayName = guest?.name ?? myName;

  const doc = docs?.find((x) => x.id === documentId);
  const [title, setTitle] = useState(doc?.title ?? '');
  const editingTitle = useRef(false);
  useEffect(() => {
    if (!editingTitle.current) setTitle(doc?.title ?? '');
  }, [doc?.title]);

  const [threads, setThreads] = useState<Thread[]>(() => listThreads(sync.scholia));
  const [panel, setPanel] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<Anchor | null>(null);
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null);
  const [words, setWords] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

  const everyone = people(symposionId);
  const names = useMemo(() => new Map(everyone.filter((p) => p.name).map((p) => [p.id, p.name])), [everyone]);
  const mentionable = useMemo(() => everyone.filter((p) => !p.me && p.role !== 'xenos' && p.name).map((p) => ({ accountId: p.id, name: p.name })), [everyone]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Placeholder.configure({ placeholder: writer ? t('doc.placeholder') : '' }),
        Collaboration.configure({ document: sync.text, field: TEXT_FIELD }),
        CollaborationCaret.configure({ provider: { awareness: sync.awareness }, user: { name: displayName || '…', color: presenceColor(me) } }),
        ScholiaHighlight.configure({
          onClick: (id) => {
            setActive(id);
            setPanel(true);
          },
        }),
      ],
      editable: writer,
      editorProps: { attributes: { class: 'sheet__text', 'aria-label': 'Grapheion' } },
    },
    [sync],
  );

  // commenti: dal documento Yjs alla lista, e dalle ancore alle evidenziazioni nel testo
  useEffect(() => {
    const update = () => setThreads(listThreads(sync.scholia));
    sync.scholia.on('update', update);
    return () => sync.scholia.off('update', update);
  }, [sync]);

  useEffect(() => {
    if (!editor) return;
    const paint = () => {
      if (editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setMeta(scholiaKey, highlights(editor.state, threads, active)).setMeta('addToHistory', false));
    };
    paint();
    const onText = () => requestAnimationFrame(paint);
    sync.text.on('afterTransaction', onText);
    return () => sync.text.off('afterTransaction', onText);
  }, [editor, threads, active, sync]);

  // stato e presenza per la barra in alto
  useEffect(() => {
    const publish = () => {
      const present = [...sync.presentAccounts()].map(([key, u]) => ({ key, name: u.name ?? '…', color: u.color ?? 'var(--muted)' }));
      useDocStatus.setState({ status: sync.status, present });
    };
    publish();
    const off = sync.onChange(publish);
    sync.awareness.on('change', publish);
    return () => {
      off();
      sync.awareness.off('change', publish);
    };
  }, [sync]);

  // arrivati da una notifica: il commento si apre da se'
  const focus = useWork((s) => s.focus);
  useEffect(() => {
    if (!focus || !threads.some((x) => x.id === focus)) return;
    setPanel(true);
    setActive(focus);
    useWork.getState().setFocus(null);
  }, [focus, threads]);

  // conteggio delle parole e pulsante "Commenta" sulla selezione
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => setWords(countText(editor.getText({ blockSeparator: '\n' })).words);
    const onSelection = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || !pageRef.current) return setBubble(null);
      const end = editor.view.coordsAtPos(to);
      const start = editor.view.coordsAtPos(from);
      const box = pageRef.current.getBoundingClientRect();
      setBubble({ top: Math.min(start.top, end.top) - box.top + pageRef.current.scrollTop - 40, left: (start.left + end.left) / 2 - box.left });
    };
    const onBlur = () => setTimeout(() => setBubble((b) => (document.activeElement?.closest('.comment-bubble') ? b : null)), 150);
    onUpdate();
    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onSelection);
    editor.on('blur', onBlur);
    return () => {
      editor.off('update', onUpdate);
      editor.off('selectionUpdate', onSelection);
      editor.off('blur', onBlur);
    };
  }, [editor]);

  const startComment = (ed: TiptapEditor | null) => {
    const a = ed ? anchorFromSelection(ed.state) : null;
    if (!a) return;
    setDraft(a);
    setPanel(true);
    setBubble(null);
  };

  // Mod+Alt+M: commenta la selezione
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        startComment(editor);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  const mention = (scholionId: string, body: string) => {
    const ids = findMentions(body, mentionable);
    if (ids.length) void notifyMentions(ids, { symposionId, documentId, scholionId }, excerpt(body)).catch(() => undefined);
  };

  const select = (id: string) => {
    setActive(id);
    const th = threads.find((x) => x.id === id);
    const r = editor && th ? resolveAnchor(editor.state, th.anchor) : null;
    if (editor && r) editor.chain().setTextSelection(r).scrollIntoView().run();
  };

  const saveTitle = () => {
    editingTitle.current = false;
    if (writer && title.trim() !== (doc?.title ?? '')) void renameDocument(documentId, title);
  };

  const openCount = threads.filter((x) => !x.resolved).length;

  return (
    <div className={`grapheion__body ${panel ? 'with-panel' : ''}`}>
      <main className="sheet" ref={pageRef}>
        <div className="sheet__tools">
          <button className={`btn btn--ghost btn--small ${panel ? 'is-on' : ''}`} aria-pressed={panel} onClick={() => setPanel(!panel)} title={t('comments.toggle')}>
            <MessageSquareText size={14} /> Scholia{openCount ? ` · ${openCount}` : ''}
          </button>
          {writer && role.role !== 'xenos' && (
            <button className="btn btn--ghost btn--small" onClick={() => (confirmDelete ? void deleteDocument(documentId) : setConfirmDelete(true))} onBlur={() => setConfirmDelete(false)}>
              <Trash2 size={14} /> {confirmDelete ? t('doc.deleteConfirm') : t('doc.delete')}
            </button>
          )}
        </div>
        <input
          className="sheet__title"
          value={title}
          readOnly={!writer}
          placeholder={t('doc.untitled')}
          aria-label={t('doc.title')}
          maxLength={200}
          autoFocus={writer && !doc?.title}
          onFocus={() => (editingTitle.current = true)}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              saveTitle();
              editor?.commands.focus('start');
            }
          }}
        />
        {!writer && <p className="note">{t('doc.commentOnly')}</p>}
        <EditorContent editor={editor} />
        {bubble && (
          <button className="btn btn--small comment-bubble" style={{ top: bubble.top, left: bubble.left }} onMouseDown={(e) => e.preventDefault()} onClick={() => startComment(editor)}>
            <MessageSquareText size={14} /> {t('comments.add')}
          </button>
        )}
        <span className="counts">{t('doc.words', { n: words })}</span>
      </main>
      {panel && (
        <ScholiaPanel
          threads={threads}
          names={names}
          me={me}
          people={mentionable}
          canComment
          active={active}
          draft={draft}
          onSelect={select}
          onCancelDraft={() => setDraft(null)}
          onCreate={(body) => {
            if (!draft) return;
            const id = newId();
            addScholion(sync.scholia, { id, author: me, authorName: displayName, body, created: new Date().toISOString(), anchor: draft, resolved: false, mentions: findMentions(body, mentionable) });
            setDraft(null);
            setActive(id);
            mention(id, body);
          }}
          onReply={(parent, body) => {
            addReply(sync.scholia, { id: newId(), parent, author: me, authorName: displayName, body, created: new Date().toISOString(), mentions: findMentions(body, mentionable) });
            mention(parent, body);
          }}
          onResolve={(id, resolved) => setResolved(sync.scholia, id, resolved)}
          onDelete={(id) => removeScholion(sync.scholia, id, me)}
          onClose={() => (setPanel(false), setDraft(null))}
        />
      )}
    </div>
  );
}
