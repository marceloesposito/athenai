// Akropolis: le Polis dell'utente. Minimale: il logo, il menu del profilo, le Polis come carte.
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { t, useLang } from '../i18n';
import { useSession } from '../state/session';
import { usePolis } from '../state/polis';
import { Kylix, Meander } from '../brand/Kylix';
import { ProfileMenu } from './ProfileMenu';
import { InviteBanner } from './InviteBanner';
import { KeryxBell } from './KeryxBell';

export function TopBar({ children, end }: { children?: React.ReactNode; end?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Kylix size={28} title="Athenai" />
      {children ?? <span className="topbar__name">Athenai</span>}
      <span className="topbar__spacer" />
      {end}
      <KeryxBell />
      <ProfileMenu />
    </header>
  );
}

export function Akropolis() {
  useLang();
  const user = useSession((s) => s.user);
  const { list, refresh, go, found, busy } = usePolis();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <div className="akropolis">
      <TopBar />
      <main className="akropolis__main">
        <InviteBanner />
        <h1 className="display">{t('akropolis.welcome', { name: user?.name ?? '' })}</h1>
        <Meander width={140} />
        <section className="cards" aria-label={t('akropolis.polis')}>
          {list?.map((p) => (
            <button key={p.id} className="card" onClick={() => void go({ kind: 'polis', id: p.id })}>
              <strong className="card__title">{p.name}</strong>
              <span className="card__meta">{t(`role.${p.role}`)}</span>
            </button>
          ))}
          {naming ? (
            <form
              className="card card--form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (name.trim()) await found(name);
              }}
            >
              <input className="input" autoFocus placeholder={t('polis.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              <div className="row">
                <button type="button" className="btn" onClick={() => setNaming(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn--primary" disabled={!name.trim() || busy}>
                  {t('akropolis.found')}
                </button>
              </div>
            </form>
          ) : (
            <button className="card card--add" onClick={() => setNaming(true)}>
              <Plus size={18} /> {t('akropolis.found')}
            </button>
          )}
        </section>
        {list?.length === 0 && !naming && <p className="hint">{t('akropolis.empty')}</p>}
      </main>
    </div>
  );
}
