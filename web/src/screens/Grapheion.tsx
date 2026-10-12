// Grapheion: si scrive insieme un Tomos. Il foglio al centro e nient'altro: chi c'e' (Symposion) in
// alto, gli Scholia a destra solo quando servono, il pulsante per commentare solo con del testo
// selezionato. Tutto cio' che si scrive parte cifrato (vedi grapheion/sync.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, MessageSquareText, MoreHorizontal, Trash2 } from 'lucide-react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { can, canPush } from '@athenai/protocol';
import { countText } from 'logos/doc/counts';
import { t, useLang } from '../i18n';
import { usePolis, oikosKeys } from '../state/polis';
import { useSession } from '../state/session';
import { notifyMentions } from '../state/keryx';
import { live } from '../live/socket';
import { TomosSync, type SyncStatus } from '../grapheion/sync';
import { TEXT_FIELD } from '../grapheion/heuresis';
import { ScholiaHighlight, scholiaKey, anchorFromSelection, highlights, resolveAnchor } from '../grapheion/anchors';
import { addScholion, addReply, listThreads, setResolved, removeScholion, findMentions, excerpt, newId, type Thread, type Anchor } from '../grapheion/scholia';
import { TopBar } from './Akropolis';
import { ScholiaPanel } from './ScholiaPanel';

/** Colore della presenza, stabile per account (dai token del tema). */
export function presenceColor(accountId: string): string {
  let h = 0;
  for (const c of accountId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--presence-${(h % 6) + 1})`;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function Grapheion() {
  useLang();
  const { current, view } = usePolis();
  const identity = useSession((s) => s.identity);
  const account = useSession((s) => s.account);
  const tomosId = view.kind === 'tomos' ? view.tomosId : '';
  const oikosId = view.kind === 'tomos' ? view.oikosId : '';
  const [sync, setSync] = useState<TomosSync | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!tomosId || !identity || !account) return;
    const s = new TomosSync({
      tomosId,
      accountId: account.accountId,
      signSk: identity.sign.privateKey,
      keys: () => oikosKeys(oikosId),
      signPkOf: (a) => usePolis.getState().current?.members.find((m) => m.accountId === a)?.signPk,
      transport: live,
      canPush: (stream) => {
        const role = usePolis.getState().current?.role;
        return !!role && canPush(role, stream);
      },
      refreshKeys: () => usePolis.getState().reload(),
    });
    setSync(s);
    setReady(false);
    let alive = true;
    void s.loaded.then(() => alive && setReady(true));
    return () => {
      alive = false;
      s.destroy();
      setSync(null);
    };
  }, [tomosId, oikosId, identity, account]);

  if (!current || !sync) return null;
  return ready ? <Sheet key={tomosId} sync={sync} /> : <Loading />;
}

function Loading() {
  return (
    <div className="akropolis">
      <TopBar />
      <main className="sheet sheet--loading" aria-busy="true">
        <p className="hint">{t('grapheion.opening')}</p>
      </main>
    </div>
  );
}

function Sheet({ sync }: { sync: TomosSync }) {
  const { current, view, tomoi, go, renameTomos, deleteTomos } = usePolis();
  const account = useSession((s) => s.account)!;
  const user = useSession((s) => s.user);
  const tomosId = view.kind === 'tomos' ? view.tomosId : '';
  const oikosId = view.kind === 'tomos' ? view.oikosId : '';
  const role = current!.role;
  const writer = can.write(role);
  const commenter = can.comment(role);
  const me = account.accountId;

  const tomos = tomoi?.find((x) => x.id === tomosId);
  const [title, setTitle] = useState(tomos?.title ?? '');
  const editingTitle = useRef(false);
  useEffect(() => {
    if (!editingTitle.current) setTitle(tomos?.title ?? '');
  }, [tomos?.title]);

  const [threads, setThreads] = useState<Thread[]>(() => listThreads(sync.scholia));
  const [panel, setPanel] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<Anchor | null>(null);
  const [status, setStatus] = useState<SyncStatus>(sync.status);
  const [online, setOnline] = useState(live.online);
  const [present, setPresent] = useState(sync.presentAccounts());
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null);
  const [words, setWords] = useState(0);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

  const names = useMemo(() => new Map(current!.members.map((m) => [m.accountId, m.name])), [current]);
  const people = useMemo(() => current!.members.filter((m) => !m.me).map((m) => ({ accountId: m.accountId, name: m.name })), [current]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Placeholder.configure({ placeholder: writer ? t('grapheion.placeholder') : '' }),
        Collaboration.configure({ document: sync.text, field: TEXT_FIELD }),
        CollaborationCaret.configure({ provider: { awareness: sync.awareness }, user: { name: user?.name ?? '…', color: presenceColor(me) } }),
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

  // Scholia: dal documento Yjs alla lista, e dalle ancore alle evidenziazioni nel testo
  useEffect(() => {
    const update = () => setThreads(listThreads(sync.scholia));
    sync.scholia.on('update', update);
    return () => sync.scholia.off('update', update);
  }, [sync]);

  useEffect(() => {
    if (!editor) return;
    const paint = () => {
      const hs = highlights(editor.state, threads, active);
      editor.view.dispatch(editor.state.tr.setMeta(scholiaKey, hs).setMeta('addToHistory', false));
    };
    paint();
    // il testo cambia sotto le ancore: si ridipingono quando il documento Yjs cambia
    const onText = () => requestAnimationFrame(paint);
    sync.text.on('afterTransaction', onText);
    return () => sync.text.off('afterTransaction', onText);
  }, [editor, threads, active, sync]);

  // stato del salvataggio, connessione, presenza
  useEffect(() => sync.onChange(() => setStatus(sync.status)), [sync]);
  useEffect(() => live.onStatus(setOnline), []);
  useEffect(() => {
    const onAw = () => setPresent(sync.presentAccounts());
    sync.awareness.on('change', onAw);
    return () => sync.awareness.off('change', onAw);
  }, [sync]);

  // conteggio delle parole e pulsante "commenta" sulla selezione
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => setWords(countText(editor.getText({ blockSeparator: '\n' })).words);
    const onSelection = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || !commenter || !pageRef.current) return setBubble(null);
      const end = editor.view.coordsAtPos(to);
      const start = editor.view.coordsAtPos(from);
      const box = pageRef.current.getBoundingClientRect();
      setBubble({ top: Math.min(start.top, end.top) - box.top - 40, left: (start.left + end.left) / 2 - box.left });
    };
    // uscendo dal testo il pulsante sparisce (a meno di averlo appena cliccato)
    const onBlur = () => setTimeout(() => setBubble((b) => (document.activeElement?.closest('.scholion-bubble') ? b : null)), 150);
    onUpdate();
    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onSelection);
    editor.on('blur', onBlur);
    return () => {
      editor.off('update', onUpdate);
      editor.off('selectionUpdate', onSelection);
      editor.off('blur', onBlur);
    };
  }, [editor, commenter]);

  const startScholion = (ed: Editor | null) => {
    if (!ed) return;
    const a = anchorFromSelection(ed.state);
    if (!a) return;
    setDraft(a);
    setPanel(true);
    setBubble(null);
  };

  // Ctrl/Cmd+Alt+M: commenta la selezione
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'm' && commenter) {
        e.preventDefault();
        startScholion(editor);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, commenter]);

  const mention = (scholionId: string, body: string) => {
    const ids = findMentions(body, people);
    if (ids.length) void notifyMentions(ids, { polisId: current!.id, oikosId, tomosId, scholionId }, excerpt(body)).catch(() => undefined);
  };

  // arrivati da una notifica: lo Scholion si apre da se'
  const focus = usePolis((s) => s.focus);
  useEffect(() => {
    if (!focus || !threads.some((x) => x.id === focus)) return;
    setPanel(true);
    setActive(focus);
    usePolis.getState().setFocus(null);
  }, [focus, threads]);

  const select = (id: string) => {
    setActive(id);
    const th = threads.find((x) => x.id === id);
    const r = editor && th ? resolveAnchor(editor.state, th.anchor) : null;
    if (editor && r) editor.chain().setTextSelection(r).scrollIntoView().run();
  };

  const saveTitle = () => {
    editingTitle.current = false;
    if (writer && title.trim() !== (tomos?.title ?? '')) void renameTomos(tomosId, title);
  };

  const others = [...present.entries()];
  const openCount = threads.filter((x) => !x.resolved).length;
  const statusText = !online ? t('grapheion.offline') : status === 'saving' ? t('grapheion.saving') : status === 'error' ? t('grapheion.error') : t('grapheion.saved');

  return (
    <div className="akropolis grapheion">
      <TopBar
        end={
          <>
            <span className={`sync-status ${!online || status === 'error' ? 'is-bad' : ''}`} aria-live="polite">
              {statusText}
            </span>
            {!!others.length && (
              <span className="avatars avatars--static" title="Symposion" aria-label="Symposion">
                {others.slice(0, 5).map(([id, u]) => (
                  <span key={id} className="avatar avatar--small avatar--presence" style={{ background: u.color }} title={u.name}>
                    {initials(u.name ?? '')}
                  </span>
                ))}
              </span>
            )}
            <button className={`icon-btn ${panel ? 'is-on' : ''}`} aria-pressed={panel} title="Scholia" aria-label="Scholia" onClick={() => setPanel(!panel)}>
              <MessageSquareText size={16} />
              {!!openCount && <span className="icon-btn__count">{openCount}</span>}
            </button>
            {writer && (
              <div className="profile">
                <button className="icon-btn" aria-haspopup="menu" aria-expanded={menu} aria-label={t('grapheion.more')} onClick={() => (setMenu(!menu), setConfirmDelete(false))}>
                  <MoreHorizontal size={16} />
                </button>
                {menu && (
                  <div className="menu" role="menu">
                    <button role="menuitem" className="menu__item menu__item--danger" onClick={() => (confirmDelete ? void deleteTomos(tomosId) : setConfirmDelete(true))}>
                      <Trash2 size={15} /> {confirmDelete ? t('tomos.deleteConfirm') : t('tomos.delete')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        }
      >
        <button className="icon-btn" aria-label={t('common.back')} onClick={() => void go({ kind: 'oikos', id: current!.id, oikosId })}>
          <ArrowLeft size={16} />
        </button>
        <span className="topbar__name topbar__crumb">{current!.oikos.find((o) => o.id === oikosId)?.name}</span>
      </TopBar>
      <div className={`grapheion__body ${panel ? 'with-panel' : ''}`}>
        <main className="sheet" ref={pageRef}>
          <input
            className="sheet__title"
            value={title}
            readOnly={!writer}
            placeholder={t('tomos.untitled')}
            aria-label={t('tomos.title')}
            maxLength={200}
            onFocus={() => (editingTitle.current = true)}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                editor?.commands.focus('start');
              }
            }}
          />
          {!writer && <p className="hint">{t(commenter ? 'grapheion.readComment' : 'grapheion.readOnly')}</p>}
          <EditorContent editor={editor} />
          {bubble && (
            <button className="btn scholion-bubble" style={{ top: bubble.top, left: bubble.left }} onMouseDown={(e) => e.preventDefault()} onClick={() => startScholion(editor)}>
              <MessageSquareText size={14} /> {t('scholia.comment')}
            </button>
          )}
          <footer className="sheet__foot hint">{t('grapheion.words', { n: words })}</footer>
        </main>
        {panel && (
          <ScholiaPanel
            threads={threads}
            names={names}
            me={me}
            people={people}
            canComment={commenter}
            active={active}
            draft={draft}
            onSelect={select}
            onCancelDraft={() => setDraft(null)}
            onCreate={(body) => {
              if (!draft) return;
              const id = newId();
              addScholion(sync.scholia, { id, author: me, body, created: new Date().toISOString(), anchor: draft, resolved: false, mentions: findMentions(body, people) });
              setDraft(null);
              setActive(id);
              mention(id, body);
            }}
            onReply={(parent, body) => {
              addReply(sync.scholia, { id: newId(), parent, author: me, body, created: new Date().toISOString(), mentions: findMentions(body, people) });
              mention(parent, body);
            }}
            onResolve={(id, resolved) => setResolved(sync.scholia, id, resolved)}
            onDelete={(id) => removeScholion(sync.scholia, id, me)}
            onClose={() => (setPanel(false), setDraft(null))}
          />
        )}
      </div>
    </div>
  );
}
