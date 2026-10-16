// Menu del profilo: impostazioni e uscita. Per un ospite: il suo nome e la strada per un account.
import { useEffect, useRef, useState } from 'react';
import { Settings, LogOut, UserPlus } from 'lucide-react';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { usePrefs } from '../state/prefs';
import { SettingsDialog } from '../screens/SettingsDialog';

export function ProfileMenu() {
  const { guest, account, signOut } = useSession();
  const name = usePrefs((s) => s.name);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const shown = guest ? guest.name : name || account?.email || '?';
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
    <div className="dropdown" ref={ref}>
      <button className={`avatar ${guest ? 'avatar--guest' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={shown}>
        {(shown[0] ?? '?').toUpperCase()}
      </button>
      {open && (
        <div className="menu menu--right" role="menu">
          <div className="menu__head">
            <strong>{shown}</strong>
            <span className="hint">{guest ? t('profile.guest') : account?.email}</span>
          </div>
          {guest ? (
            <>
              {item(<UserPlus size={15} />, t('profile.createAccount'), () => void signOut())}
              {item(<LogOut size={15} />, t('profile.leave'), () => void signOut())}
            </>
          ) : (
            <>
              {item(<Settings size={15} />, t('settings.title'), () => setSettings(true))}
              {item(<LogOut size={15} />, t('profile.signout'), () => void signOut())}
            </>
          )}
        </div>
      )}
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </div>
  );
}
