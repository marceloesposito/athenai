// La Polis attuale nella barra: un clic apre l'elenco delle proprie Polis e "Nuova Polis".
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Check } from 'lucide-react';
import { t } from '../i18n';
import { useWork } from '../state/work';

export function PolisSwitcher() {
  const { polis, polisList, openPolis, newPolis } = useWork();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && (setOpen(false), setNaming(false));
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <button className="crumbs__item crumbs__button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={t('polis.switch')}>
        {polis?.name ?? '…'} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu__label">Polis</div>
          {polisList?.map((p) => (
            <button
              key={p.id}
              role="menuitem"
              className="menu__item"
              onClick={() => {
                setOpen(false);
                void openPolis(p.id);
              }}
            >
              <span className="menu__check">{p.id === polis?.id && <Check size={14} />}</span>
              {p.name}
              <span className="hint menu__end">{t(`role.${p.role}`)}</span>
            </button>
          ))}
          {naming ? (
            <form
              className="menu__form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim()) return;
                setOpen(false);
                setNaming(false);
                await newPolis(name);
                setName('');
              }}
            >
              <input className="input input--small" autoFocus placeholder={t('polis.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </form>
          ) : (
            <button role="menuitem" className="menu__item" onClick={() => setNaming(true)}>
              <span className="menu__check">
                <Plus size={14} />
              </span>
              {t('polis.new')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
