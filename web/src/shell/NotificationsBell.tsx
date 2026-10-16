// Notifiche: la campanella si vede solo quando c'e' qualcosa.
import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { t, useLang } from '../i18n';
import { useNotices } from '../state/notices';

export function NotificationsBell() {
  useLang();
  const { items, open, dismissAll } = useNotices();
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setShown(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [shown]);
  if (!items.length) return null;
  const label = t('notices.title', { n: items.length });
  return (
    <div className="dropdown" ref={ref}>
      <button className="icon-btn bell" aria-haspopup="menu" aria-expanded={shown} aria-label={label} title={label} onClick={() => setShown(!shown)}>
        <Bell size={16} />
        <span className="badge-count">{items.length}</span>
      </button>
      {shown && (
        <div className="menu menu--right notices" role="menu">
          {items.map((it) => (
            <button
              key={it.id}
              role="menuitem"
              className="menu__item notices__item"
              onClick={() => {
                setShown(false);
                void open(it.id);
              }}
            >
              <strong>{t('notices.mention', { name: it.from })}</strong>
              <span className="hint">
                {it.polis} · {it.document || t('doc.untitled')}
              </span>
              <span className="notices__excerpt">{it.notice.excerpt}</span>
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
            {t('notices.clear')}
          </button>
        </div>
      )}
    </div>
  );
}
