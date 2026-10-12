// Un Oikos: i suoi Tomoi come carte e una sola azione, "Nuovo Tomos". La ricerca (Heuresis) avviene
// tutta qui nel browser: i testi si decifrano solo quando si cerca.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import { can } from '@athenai/protocol';
import { t, useLang, getLang } from '../i18n';
import { usePolis } from '../state/polis';
import { TopBar } from './Akropolis';
import { search, type Searchable } from '../grapheion/heuresis';
import { tomosText } from '../grapheion/texts';

export function OikosView() {
  useLang();
  const { current, view, tomoi, go, newTomos } = usePolis();
  const [query, setQuery] = useState('');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const oikosId = view.kind === 'oikos' ? view.oikosId : '';
  const oikos = current?.oikos.find((o) => o.id === oikosId);

  // i testi si aprono alla prima ricerca
  useEffect(() => {
    if (!query.trim() || !tomoi) return;
    let alive = true;
    void (async () => {
      for (const tm of tomoi) {
        const text = await tomosText(oikosId, tm.id, tm.updatedAt).catch(() => null);
        if (!alive) return;
        if (text !== null) setTexts((x) => (x[tm.id] === text ? x : { ...x, [tm.id]: text }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [query, tomoi, oikosId]);

  const hits = useMemo(() => {
    const items: Searchable[] = (tomoi ?? []).map((tm) => ({ id: tm.id, title: tm.title || t('tomos.untitled'), text: texts[tm.id] ?? null }));
    return search(query, items);
  }, [query, tomoi, texts]);

  if (!current || !oikos) return null;
  const fmt = new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const open = (tomosId: string) => void go({ kind: 'tomos', id: current.id, oikosId, tomosId });
  return (
    <div className="akropolis">
      <TopBar>
        <button className="icon-btn" aria-label={t('common.back')} onClick={() => void go({ kind: 'polis', id: current.id })}>
          <ArrowLeft size={16} />
        </button>
        <span className="topbar__name">
          <span className="topbar__crumb">{current.name} ·</span> {oikos.name}
        </span>
      </TopBar>
      <main className="polis">
        {!!tomoi?.length && (
          <label className="heuresis">
            <Search size={15} aria-hidden />
            <input className="heuresis__input" type="search" placeholder={t('heuresis.placeholder')} aria-label="Heuresis" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}
        {query.trim() ? (
          <section className="hits" aria-label="Heuresis">
            {hits.map((h) => (
              <button key={h.id} className="hit" onClick={() => open(h.id)}>
                <strong>{h.title}</strong>
                {h.snippet && <span className="hint">{h.snippet}</span>}
              </button>
            ))}
            {!hits.length && <p className="hint">{t('heuresis.none')}</p>}
          </section>
        ) : (
          <section className="cards" aria-label="Tomoi">
            {tomoi?.map((tm) => (
              <button key={tm.id} className="card card--tomos" onClick={() => open(tm.id)}>
                <strong className="card__title">{tm.title || t('tomos.untitled')}</strong>
                <span className="card__meta">{fmt.format(new Date(tm.updatedAt))}</span>
              </button>
            ))}
            {can.write(current.role) && (
              <button
                className="card card--add"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await newTomos();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Plus size={18} /> {t('tomos.create')}
              </button>
            )}
          </section>
        )}
        {tomoi?.length === 0 && <p className="hint">{t(can.write(current.role) ? 'tomos.empty' : 'tomos.emptyRead')}</p>}
        <p className="hint hint--soft">{t('oikos.soon')}</p>
      </main>
    </div>
  );
}
