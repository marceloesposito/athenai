// Akropolis: la casa dopo l'ingresso. Interfaccia minimale: il logo, il menu del profilo e le Polis.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { t, useLang } from '../i18n';
import { useSession } from '../state/session';
import { Kylix, Meander } from '../brand/Kylix';
import { ProfileMenu } from './ProfileMenu';

export function Akropolis() {
  useLang();
  const user = useSession((s) => s.user);
  const [soon, setSoon] = useState(false);
  return (
    <div className="akropolis">
      <header className="topbar">
        <Kylix size={28} title="Athenai" />
        <span className="topbar__name">Athenai</span>
        <span className="topbar__spacer" />
        <ProfileMenu />
      </header>
      <main className="akropolis__main">
        <h1 className="display">{t('akropolis.welcome', { name: user?.name ?? '' })}</h1>
        <Meander width={140} />
        <section className="akropolis__empty">
          <h2>{t('akropolis.polis')}</h2>
          <p>{t('akropolis.empty')}</p>
          <button className="btn btn--primary" onClick={() => setSoon(true)}>
            <Plus size={16} /> {t('akropolis.found')}
          </button>
          {soon && <p className="hint">{t('akropolis.soon')}</p>}
        </section>
      </main>
    </div>
  );
}
