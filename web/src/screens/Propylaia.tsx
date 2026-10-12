// Propylaia: l'ingresso monumentale. Passkey ed email per primi (Zitadel), Google e GitHub dopo.
import { KeyRound, Lock, Globe2, HeartHandshake, Download } from 'lucide-react';
import { t, useLang } from '../i18n';
import { auth } from '../auth';
import { useSession } from '../state/session';
import { Kylix, Meander } from '../brand/Kylix';

const SOURCE = 'https://github.com/marceloesposito/athenai';

export function Propylaia() {
  useLang();
  const { signIn, error } = useSession();
  return (
    <main className="propylaia">
      <section className="propylaia__card">
        <Kylix size={88} title="Athenai" />
        <h1 className="display">{t('app.name')}</h1>
        <Meander width={180} />
        <p className="propylaia__tagline">{t('propylaia.tagline')}</p>

        <div className="propylaia__actions">
          <button className="btn btn--primary btn--large" onClick={() => void signIn()}>
            <KeyRound size={16} /> {t(auth.configured ? 'propylaia.enter' : 'propylaia.dev')}
          </button>
          {!auth.configured && <p className="hint">{t('propylaia.devNote')}</p>}
        </div>
        {error && (
          <p className="error" role="alert">
            {t('auth.error', { error })}
          </p>
        )}
      </section>

      <ul className="principles">
        <li>
          <Lock size={16} /> {t('propylaia.p.e2ee')}
        </li>
        <li>
          <Globe2 size={16} /> {t('propylaia.p.eu')}
        </li>
        <li>
          <HeartHandshake size={16} /> {t('propylaia.p.open')}
        </li>
        <li>
          <Download size={16} /> {t('propylaia.p.own')}
        </li>
      </ul>
      <a className="propylaia__source" href={SOURCE} target="_blank" rel="noreferrer noopener">
        {t('propylaia.source')}
      </a>
    </main>
  );
}
