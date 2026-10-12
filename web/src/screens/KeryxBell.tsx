// Keryx, l'araldo: la campanella con le notifiche. Si vede solo quando c'e' qualcosa da dire.
import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { t, useLang } from '../i18n';
import { useKeryx } from '../state/keryx';

export function KeryxBell() {
  useLang();
  const { items, open, dismissAll } = useKeryx();
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setShown(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [shown]);
  if (!items.length) return null;
  return (
    <div className="keryx" ref={ref}>
      <button className="icon-btn keryx__bell" aria-haspopup="menu" aria-expanded={shown} aria-label={t('keryx.title', { n: items.length })} title={t('keryx.title', { n: items.length })} onClick={() => setShown(!shown)}>
        <Bell size={16} />
        <span className="keryx__count">{items.length}</span>
      </button>
      {shown && (
        <div className="menu keryx__menu" role="menu">
          {items.map((it) => (
            <button
              key={it.id}
              role="menuitem"
              className="menu__item keryx__item"
              onClick={() => {
                setShown(false);
                void open(it.id);
              }}
            >
              <strong>{t('keryx.mention', { name: it.from })}</strong>
              <span className="hint">
                {it.polis} · {it.tomos || t('tomos.untitled')}
              </span>
              <span className="keryx__excerpt">{it.notice.excerpt}</span>
            </button>
          ))}
          <button
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setShown(false);
              void dismissAll();
            }}
          >
            {t('keryx.clear')}
          </button>
        </div>
      )}
    </div>
  );
}
