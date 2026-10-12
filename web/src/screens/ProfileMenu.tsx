// Menu del profilo: tutto quello che non serve sempre sta qui (Nomoi, dispositivi, blocca, esci).
import { useEffect, useRef, useState } from 'react';
import { Settings2, Smartphone, Lock, LogOut } from 'lucide-react';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { auth } from '../auth';
import { Nomoi } from './Nomoi';
import { LinkSend } from './LinkSend';

export function ProfileMenu() {
  const { user, lock, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'nomoi' | 'link' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const item = (icon: React.ReactNode, label: string, run: () => void) => (
    <button
      role="menuitem"
      className="menu__item"
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      {icon} {label}
    </button>
  );
  return (
    <div className="profile" ref={ref}>
      {!auth.configured && <span className="badge">{t('dev.badge')}</span>}
      <button className="avatar" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={user?.name}>
        {initials}
      </button>
      {open && (
        <div className="menu" role="menu">
          {item(<Settings2 size={15} />, t('menu.nomoi'), () => setDialog('nomoi'))}
          {item(<Smartphone size={15} />, t('menu.link'), () => setDialog('link'))}
          {item(<Lock size={15} />, t('menu.lock'), () => void lock())}
          {item(<LogOut size={15} />, t('menu.signout'), () => void signOut())}
        </div>
      )}
      {dialog === 'nomoi' && <Nomoi onClose={() => setDialog(null)} />}
      {dialog === 'link' && <LinkSend onClose={() => setDialog(null)} />}
    </div>
  );
}
