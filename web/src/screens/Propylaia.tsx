// Propylaia: l'ingresso monumentale. Passkey ed email per primi (Zitadel), Google e GitHub dopo.
import { KeyRound, GitBranch, Lock, Globe2, HeartHandshake, Download } from 'lucide-react';
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

        {auth.configured ? (
          <div className="propylaia__actions">
            <button className="btn btn--primary btn--large" onClick={() => void signIn()}>
              <KeyRound size={16} /> {t('propylaia.enter')}
            </button>
            {auth.providers.length > 0 && <div className="propylaia__or">{t('propylaia.or')}</div>}
            {auth.providers.includes('google') && (
              <button className="btn btn--large" onClick={() => void signIn('google')}>
                <span className="provider-g" aria-hidden>
                  G
                </span>{' '}
                {t('propylaia.google')}
              </button>
            )}
            {auth.providers.includes('github') && (
              <button className="btn btn--large" onClick={() => void signIn('github')}>
                <GitBranch size={16} /> {t('propylaia.github')}
              </button>
            )}
            {auth.providers.length > 0 && <p className="hint">{t('propylaia.providerNote')}</p>}
          </div>
        ) : (
          <div className="propylaia__actions">
            <button className="btn btn--primary btn--large" onClick={() => void signIn()}>
              <KeyRound size={16} /> {t('propylaia.dev')}
            </button>
            <p className="hint">{t('propylaia.devNote')}</p>
          </div>
        )}
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
