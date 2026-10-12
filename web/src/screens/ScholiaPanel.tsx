// Scholia: le note a margine del Tomos. Una colonna a destra, aperta solo quando serve: per leggere le
// discussioni, rispondere, segnare come risolte. Le @menzioni avvisano (Keryx) chi viene chiamato.
import { useState } from 'react';
import { Check, RotateCcw, Trash2, X } from 'lucide-react';
import { t, useLang, getLang } from '../i18n';
import type { Thread, Anchor, Mentionable } from '../grapheion/scholia';
import { MentionInput } from './MentionInput';

interface Props {
  threads: Thread[];
  names: Map<string, string>;
  me: string;
  people: Mentionable[];
  canComment: boolean;
  active: string | null;
  /** nuovo Scholion in preparazione sulla selezione */
  draft: Anchor | null;
  onSelect(id: string): void;
  onCreate(body: string): void;
  onCancelDraft(): void;
  onReply(id: string, body: string): void;
  onResolve(id: string, resolved: boolean): void;
  onDelete(id: string): void;
  onClose(): void;
}

export function ScholiaPanel(p: Props) {
  useLang();
  const [draft, setDraft] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  const fmt = new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const open = p.threads.filter((x) => !x.resolved);
  const resolved = p.threads.filter((x) => x.resolved);
  const name = (id: string) => p.names.get(id) ?? '…';

  const thread = (x: Thread) => (
    <article key={x.id} className={`scholion ${x.id === p.active ? 'is-active' : ''} ${x.resolved ? 'is-resolved' : ''}`} onClick={() => p.onSelect(x.id)}>
      {x.anchor?.quote && <blockquote className="scholion__quote">{x.anchor.quote}</blockquote>}
      <header className="scholion__head">
        <strong>{name(x.author)}</strong>
        <span className="hint">{fmt.format(new Date(x.created))}</span>
        <span className="topbar__spacer" />
        {p.canComment && (
          <button className="icon-btn" title={x.resolved ? t('scholia.reopen') : t('scholia.resolve')} aria-label={x.resolved ? t('scholia.reopen') : t('scholia.resolve')} onClick={(e) => (e.stopPropagation(), p.onResolve(x.id, !x.resolved))}>
            {x.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
          </button>
        )}
        {x.author === p.me && (
          <button className="icon-btn" title={t('scholia.delete')} aria-label={t('scholia.delete')} onClick={(e) => (e.stopPropagation(), p.onDelete(x.id))}>
            <Trash2 size={14} />
          </button>
        )}
      </header>
      <p className="scholion__body">{x.body}</p>
      {x.replies.map((r) => (
        <div key={r.id} className="scholion__reply">
          <strong>{name(r.author)}</strong> <span className="hint">{fmt.format(new Date(r.created))}</span>
          <p className="scholion__body">{r.body}</p>
        </div>
      ))}
      {p.canComment && !x.resolved && x.id === p.active && (
        <div onClick={(e) => e.stopPropagation()}>
          <MentionInput
            value={replies[x.id] ?? ''}
            onChange={(v) => setReplies({ ...replies, [x.id]: v })}
            onSubmit={() => {
              const body = (replies[x.id] ?? '').trim();
              if (!body) return;
              p.onReply(x.id, body);
              setReplies({ ...replies, [x.id]: '' });
            }}
            people={p.people}
            placeholder={t('scholia.reply')}
          />
        </div>
      )}
    </article>
  );

  return (
    <aside className="scholia" aria-label="Scholia">
      <header className="scholia__head">
        <h2>Scholia</h2>
        <button className="icon-btn" aria-label={t('common.close')} onClick={p.onClose}>
          <X size={16} />
        </button>
      </header>
      {p.draft && (
        <form
          className="scholion scholion--draft"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            p.onCreate(draft.trim());
            setDraft('');
          }}
        >
          <blockquote className="scholion__quote">{p.draft.quote}</blockquote>
          <MentionInput
            autoFocus
            value={draft}
            onChange={setDraft}
            onSubmit={() => {
              if (!draft.trim()) return;
              p.onCreate(draft.trim());
              setDraft('');
            }}
            onCancel={p.onCancelDraft}
            people={p.people}
            placeholder={t('scholia.placeholder')}
          />
          <div className="row">
            <button type="button" className="btn" onClick={p.onCancelDraft}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
              {t('scholia.add')}
            </button>
          </div>
        </form>
      )}
      {open.map(thread)}
      {!open.length && !p.draft && <p className="hint">{t(p.canComment ? 'scholia.empty' : 'scholia.emptyRead')}</p>}
      {!!resolved.length && (
        <button className="link-btn" onClick={() => setShowResolved(!showResolved)}>
          {t(showResolved ? 'scholia.hideResolved' : 'scholia.showResolved', { n: resolved.length })}
        </button>
      )}
      {showResolved && resolved.map(thread)}
    </aside>
  );
}
