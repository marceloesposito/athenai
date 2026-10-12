// Nomoi (le leggi): poche scelte. Lingua, tema, il proprio Symbolon.
import { t, useLang, type Lang } from '../i18n';
import { usePrefs, type Theme } from '../state/prefs';
import { useSession } from '../state/session';
import { Modal } from '../components/Modal';
import { Fingerprint } from '../components/Fingerprint';

export function Nomoi({ onClose }: { onClose: () => void }) {
  useLang();
  const { theme, lang, setTheme, setLang } = usePrefs();
  const { record, forgetDevice } = useSession();
  return (
    <Modal title={t('nomoi.title')} onClose={onClose}>
      <div className="form">
        <label className="form__row">
          <span>{t('nomoi.lang')}</span>
          <select className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </label>
        <div className="form__row">
          <span>{t('nomoi.theme')}</span>
          <div className="seg-group" role="radiogroup" aria-label={t('nomoi.theme')}>
            {(['light', 'dark', 'system'] as Theme[]).map((x) => (
              <button key={x} role="radio" aria-checked={theme === x} className={`seg ${theme === x ? 'is-on' : ''}`} onClick={() => setTheme(x)}>
                {t(`nomoi.theme.${x}`)}
              </button>
            ))}
          </div>
        </div>
        {record && (
          <div className="fp-box">
            <span>{t('nomoi.symbolon')} · {t('symbolon.fingerprint')}</span>
            <Fingerprint identity={record.identity} />
            <small className="hint">{t('symbolon.fingerprintHint')}</small>
          </div>
        )}
        <details className="danger-zone">
          <summary>{t('nomoi.forget')}</summary>
          <p className="hint">{t('nomoi.forgetHint')}</p>
          <button
            className="btn btn--danger"
            onClick={() => {
              onClose();
              void forgetDevice();
            }}
          >
            {t('nomoi.forget')}
          </button>
        </details>
      </div>
    </Modal>
  );
}
