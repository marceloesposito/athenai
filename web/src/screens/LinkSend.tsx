// Dispositivo gia' sbloccato: legge il codice del nuovo, mostra il codice di verifica e, se
// l'utente conferma, invia la chiave principale cifrata per quel dispositivo.
import { useState } from 'react';
import { t, useLang } from '../i18n';
import { parseLinkCode, sealMasterFor, verificationCode } from '../crypto/deviceLink';
import { serverRelay } from '../crypto/relay';
import { useSession } from '../state/session';
import { Modal } from '../components/Modal';

export function LinkSend({ onClose }: { onClose: () => void }) {
  useLang();
  const identity = useSession((s) => s.identity);
  const [text, setText] = useState('');
  const [target, setTarget] = useState<{ channel: string; publicKey: Uint8Array; code: string } | null>(null);
  const [state, setState] = useState<'idle' | 'invalid' | 'done'>('idle');

  return (
    <Modal title={t('link.send.title')} onClose={onClose}>
      {state === 'done' ? (
        <p className="ok">{t('link.send.done')}</p>
      ) : target ? (
        <div className="form">
          <p>{t('link.send.check', { code: target.code })}</p>
          <div className="row">
            <button className="btn" onClick={() => setTarget(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn btn--primary"
              onClick={async () => {
                if (!identity) return;
                await serverRelay().send(target.channel, await sealMasterFor(identity.master, target.publicKey));
                setState('done');
              }}
            >
              {t('link.send.confirm')}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const p = await parseLinkCode(text);
            if (!p) return setState('invalid');
            setState('idle');
            setTarget({ ...p, code: await verificationCode(p.publicKey) });
          }}
        >
          <label className="form__col">
            <span>{t('link.send.paste')}</span>
            <input className="input" autoComplete="off" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {state === 'invalid' && (
            <p className="error" role="alert">
              {t('link.send.invalid')}
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={!text.trim()}>
              {t('common.continue')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
