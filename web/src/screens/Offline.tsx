// Server non raggiungibile: Athenai non tiene copie locali, quindi senza server si aspetta.
import { CloudOff } from 'lucide-react';
import { t, useLang } from '../i18n';
import { useSession } from '../state/session';

export function Offline() {
  useLang();
  const init = useSession((s) => s.init);
  return (
    <main className="symbolon">
      <section className="panel panel--center">
        <CloudOff size={36} />
        <h1 className="display">{t('offline.title')}</h1>
        <p>{t('offline.text')}</p>
        <button className="btn btn--primary" onClick={() => void init()}>
          {t('offline.retry')}
        </button>
      </section>
    </main>
  );
}
