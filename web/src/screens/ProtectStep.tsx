// Dopo aver creato o ritrovato il Symbolon: come sbloccare Athenai su questo dispositivo.
import { useState } from 'react';
import { Fingerprint as FpIcon, Monitor, KeySquare } from 'lucide-react';
import { t, useLang } from '../i18n';
import { useSession, usePublicIdentity, type Protection } from '../state/session';
import { passkeysAvailable } from '../crypto/passkey';
import { Fingerprint } from '../components/Fingerprint';

export function ProtectStep({ onDone }: { onDone?: () => void }) {
  useLang();
  const { protect } = useSession();
  const pub = usePublicIdentity();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = async (k: Protection) => {
    setBusy(true);
    const r = await protect(k);
    setBusy(false);
    if (r === 'ok') onDone?.();
    else setMsg(t(r === 'noPrf' ? 'symbolon.protect.noPrf' : 'symbolon.protect.failed'));
  };
  return (
    <main className="symbolon">
      <section className="panel">
        <h1 className="display">{t('symbolon.protect.title')}</h1>
        <div className="choices">
          {passkeysAvailable() && (
            <button className="choice" disabled={busy} onClick={() => void choose('passkey')}>
              <FpIcon size={20} />
              <span>
                <strong>{t('symbolon.protect.passkey')}</strong>
                <small>{t('symbolon.protect.passkeyHint')}</small>
              </span>
            </button>
          )}
          <button className="choice" disabled={busy} onClick={() => void choose('device')}>
            <Monitor size={20} />
            <span>
              <strong>{t('symbolon.protect.device')}</strong>
              <small>{t('symbolon.protect.deviceHint')}</small>
            </span>
          </button>
          <button className="choice" disabled={busy} onClick={() => void choose('phrase')}>
            <KeySquare size={20} />
            <span>
              <strong>{t('symbolon.protect.none')}</strong>
            </span>
          </button>
        </div>
        {msg && (
          <p className="error" role="alert">
            {msg}
          </p>
        )}
        {pub && (
          <div className="fp-box">
            <span>{t('symbolon.fingerprint')}</span>
            <Fingerprint identity={pub} />
            <small className="hint">{t('symbolon.fingerprintHint')}</small>
          </div>
        )}
      </section>
    </main>
  );
}
