// Cerca e vai (Mod+K), come il Quick switcher di Alexandria: documenti del Symposion aperto,
// Symposia della Polis e le azioni principali, con la ricerca approssimata di logos.
import { useEffect, useMemo, useState } from 'react';
import { FileText, Folder, Plus, Share2, LayoutDashboard, PenLine, History } from 'lucide-react';
import { fuzzyFilter } from 'logos/lib/fuzzy';
import { can } from '@athenai/protocol';
import { t } from '../i18n';
import { useWork, myRole } from '../state/work';
import { useSession } from '../state/session';

interface Item {
  key: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run(): void;
}

export function QuickOpen({ onClose, onShare }: { onClose: () => void; onShare?: () => void }) {
  const { view, docs, polis, go, openDocument, setSection, newDocument } = useWork();
  const guest = useSession((s) => s.guest);
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState(0);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const role = myRole();
    if (view.kind === 'symposion') {
      for (const d of docs ?? []) out.push({ key: `d${d.id}`, label: d.title || t('doc.untitled'), hint: t('quick.document'), icon: <FileText size={15} />, run: () => openDocument(d.id) });
      if (can.write(role.role, role.mode)) out.push({ key: 'new-doc', label: t('doc.new'), icon: <Plus size={15} />, run: () => void newDocument() });
      out.push({ key: 's-agora', label: t('section.agora'), hint: t('quick.section'), icon: <LayoutDashboard size={15} />, run: () => setSection('agora') });
      out.push({ key: 's-grapheion', label: t('section.grapheion'), hint: t('quick.section'), icon: <PenLine size={15} />, run: () => setSection('grapheion') });
      out.push({ key: 's-anamnesis', label: t('section.anamnesis'), hint: t('quick.section'), icon: <History size={15} />, run: () => setSection('anamnesis') });
      if (onShare) out.push({ key: 'share', label: t('share.button'), icon: <Share2 size={15} />, run: onShare });
    }
    if (!guest)
      for (const s of polis?.symposia ?? [])
        out.push({ key: `s${s.id}`, label: s.name, hint: 'Symposion', icon: <Folder size={15} />, run: () => void go({ kind: 'symposion', symposionId: s.id, section: 'grapheion', documentId: null }) });
    return out;
  }, [view, docs, polis, guest, go, openDocument, setSection, newDocument, onShare]);

  const shown = useMemo(() => fuzzyFilter(items, query, (i) => i.label, 30), [items, query]);
  useEffect(() => setPick(0), [query]);
  const run = (i: Item | undefined) => {
    if (!i) return;
    onClose();
    i.run();
  };

  return (
    <div className="modal-backdrop modal-backdrop--top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quick" role="dialog" aria-modal="true" aria-label={t('quick.title')}>
        <input
          className="quick__input"
          autoFocus
          placeholder={t('quick.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') (e.preventDefault(), setPick((pick + 1) % Math.max(1, shown.length)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setPick((pick - 1 + shown.length) % Math.max(1, shown.length)));
            else if (e.key === 'Enter') (e.preventDefault(), run(shown[pick]));
          }}
        />
        <ul className="quick__list" role="listbox">
          {shown.map((i, n) => (
            <li key={i.key}>
              <button role="option" aria-selected={n === pick} className={`quick__item ${n === pick ? 'is-on' : ''}`} onMouseEnter={() => setPick(n)} onClick={() => run(i)}>
                {i.icon}
                <span className="quick__label">{i.label}</span>
                {i.hint && <span className="hint">{i.hint}</span>}
              </button>
            </li>
          ))}
          {!shown.length && <li className="hint quick__empty">{t('quick.none')}</li>}
        </ul>
      </div>
    </div>
  );
}
