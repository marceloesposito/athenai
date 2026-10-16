// Impostazioni: nome, aspetto, lingua, password e codice di recupero.
import { useState } from 'react';
import { MIN_PASSWORD } from '@athenai/protocol';
import { t, useLang, type Lang } from '../i18n';
import { usePrefs, type Theme } from '../state/prefs';
import { useSession } from '../state/session';
import { useWork } from '../state/work';
import { Modal } from '../components/Modal';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  useLang();
  const prefs = usePrefs();
  const { account, changePassword, createRecoveryCode, removeRecovery } = useSession();
  const updateProfiles = useWork((s) => s.updateProfiles);
  const [name, setName] = useState(prefs.name);
  const [password, setPassword] = useState('');
  const [pwDone, setPwDone] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  return (
    <Modal title={t('settings.title')} onClose={onClose}>
      <form
        className="dialog-section"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || name.trim() === prefs.name) return;
          await prefs.update({ name: name.trim() });
          await updateProfiles(name.trim());
        }}
      >
        <h3>{t('field.name')}</h3>
        <div className="row row--start">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label={t('field.name')} />
          <button className="btn" type="submit" disabled={!name.trim() || name.trim() === prefs.name}>
            {t('common.save')}
          </button>
        </div>
      </form>
      <section className="dialog-section">
        <h3>{t('settings.theme')}</h3>
        <div className="seg-group" role="radiogroup">
          {(['system', 'light', 'dark'] as Theme[]).map((th) => (
            <button key={th} role="radio" aria-checked={prefs.theme === th} className={`seg ${prefs.theme === th ? 'is-on' : ''}`} onClick={() => void prefs.update({ theme: th })}>
              {t(`settings.theme.${th}`)}
            </button>
          ))}
        </div>
        <h3>{t('settings.lang')}</h3>
        <div className="seg-group" role="radiogroup">
          {(['it', 'en'] as Lang[]).map((l) => (
            <button key={l} role="radio" aria-checked={prefs.lang === l} className={`seg ${prefs.lang === l ? 'is-on' : ''}`} onClick={() => void prefs.update({ lang: l })}>
              {l === 'it' ? 'Italiano' : 'English'}
            </button>
          ))}
        </div>
      </section>
      <form
        className="dialog-section"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password.length < MIN_PASSWORD) return;
          if (await changePassword(password)) {
            setPassword('');
            setPwDone(true);
          }
        }}
      >
        <h3>{t('settings.password')}</h3>
        <div className="row row--start">
          <input className="input" type="password" autoComplete="new-password" placeholder={t('field.newPassword')} value={password} onChange={(e) => (setPassword(e.target.value), setPwDone(false))} />
          <button className="btn" type="submit" disabled={password.length < MIN_PASSWORD}>
            {t('settings.changePassword')}
          </button>
        </div>
        {pwDone && <p className="ok">{t('settings.passwordChanged')}</p>}
      </form>
      <section className="dialog-section">
        <h3>{t('settings.recovery')}</h3>
        <p className="hint">{t('settings.recoveryHint')}</p>
        {code ? (
          <>
            <code className="recovery-code">{code}</code>
            <p className="warning">{t('settings.recoveryOnce')}</p>
          </>
        ) : account?.hasRecovery ? (
          <div className="row row--start">
            <span className="ok">{t('settings.recoveryOn')}</span>
            <button className="btn" onClick={async () => setCode(await createRecoveryCode())}>
              {t('settings.recoveryNew')}
            </button>
            <button className="btn btn--ghost" onClick={() => void removeRecovery()}>
              {t('settings.recoveryRemove')}
            </button>
          </div>
        ) : (
          <button className="btn btn--primary" onClick={async () => setCode(await createRecoveryCode())}>
            {t('settings.recoveryCreate')}
          </button>
        )}
      </section>
    </Modal>
  );
}
