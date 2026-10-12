// Dispositivo nuovo: mostra il codice (QR) e aspetta la chiave cifrata dall'altro dispositivo.
import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { t, useLang } from '../i18n';
import { createLinkRequest, openLinkedMaster, verificationCode, type LinkRequest } from '../crypto/deviceLink';
import { localRelay } from '../crypto/relay';
import { useSession } from '../state/session';
import { Qr } from '../components/Qr';
import { Kylix } from '../brand/Kylix';

export function LinkReceive({ onUsePhrase }: { onUsePhrase: () => void }) {
  useLang();
  const adoptMaster = useSession((s) => s.adoptMaster);
  const [req, setReq] = useState<LinkRequest | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    void (async () => {
      const r = await createLinkRequest();
      setReq(r);
      setCode(await verificationCode(r.publicKey));
      try {
        const sealed = await localRelay().receive(r.channel, ctl.signal);
        const master = await openLinkedMaster(sealed, r);
        if (!master) return setErr(t('link.failed'));
        if ((await adoptMaster(master)) === 'other') setErr(t('link.mismatch'));
      } catch {
        /* annullato */
      }
    })();
    return () => ctl.abort();
  }, [adoptMaster]);

  return (
    <main className="symbolon">
      <section className="panel panel--center">
        <Kylix size={40} />
        <h1 className="display">{t('link.title')}</h1>
        <p>{t('link.intro')}</p>
        {req && <Qr text={req.code} />}
        {code && (
          <div className="verify">
            <span>{t('link.verify')}</span>
            <strong>{code}</strong>
            <small className="hint">{t('link.verifyHint')}</small>
          </div>
        )}
        {req && (
          <details className="code-box">
            <summary>{t('link.codeLabel')}</summary>
            <div className="row">
              <code className="code">{req.code}</code>
              <button
                className="icon-btn"
                aria-label={t('common.copy')}
                onClick={async () => {
                  await navigator.clipboard.writeText(req.code);
                  setCopied(true);
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </details>
        )}
        <p className="hint pulse">{t('link.waiting')}</p>
        {err && (
          <p className="error" role="alert">
            {err}
          </p>
        )}
        <button className="link-btn" onClick={onUsePhrase}>
          {t('link.usePhrase')}
        </button>
      </section>
    </main>
  );
}
