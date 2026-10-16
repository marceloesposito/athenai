// Ospite da un link privato: un clic per entrare. Il nome lo sceglie Athenai, fra i personaggi
// del mondo greco classico; resta per questa scheda.
import { useState } from 'react';
import { t, useLang } from '../i18n';
import { useSession } from '../state/session';
import { Logo } from '../brand/Logo';

export function GuestJoin() {
  useLang();
  const { guestInvite, joinAsGuest, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!guestInvite) return null;
  return (
    <div className="welcome">
      <header className="welcome__bar">
        <Logo size={26} withName />
      </header>
      <main className="welcome__main">
        <div className="auth-card">
          <h1>{t('guest.title', { name: guestInvite.symposionName })}</h1>
          <p>{t(guestInvite.mode === 'edit' ? 'guest.canEdit' : 'guest.canComment')}</p>
          <p className="hint">{t('guest.howNames')}</p>
          {error && <p className="error">{t('guest.invalid')}</p>}
          <button
            className="btn btn--primary btn--large"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await joinAsGuest();
              setBusy(false);
              if (r !== 'ok') setError(true);
            }}
          >
            {t('guest.enter')}
          </button>
          <p className="auth-card__alt">
            <button className="link-btn" onClick={() => void signOut()}>
              {t('guest.haveAccount')}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
