// Sblocco: passkey (custodita dal server, sincronizzata dal portachiavi) se c'e', altrimenti le 12
// parole, oppure un altro dispositivo gia' sbloccato. Il resto e' nascosto.
import { useState } from 'react';
import { Fingerprint as FpIcon } from 'lucide-react';
import { t, useLang } from '../i18n';
import { useSession } from '../state/session';
import { Kylix } from '../brand/Kylix';
import { LinkReceive } from './LinkReceive';

export function Unlock() {
  useLang();
  const { account, unlockWithPasskey } = useSession();
  const hasPasskey = !!account?.passkeys.length;
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<'main' | 'phrase' | 'link'>(hasPasskey ? 'main' : 'phrase');
  if (mode === 'link') return <LinkReceive onUsePhrase={() => setMode('phrase')} />;
  return (
    <main className="symbolon">
      <section className="panel">
        <Kylix size={48} />
        <h1 className="display">{t('unlock.title')}</h1>
        {hasPasskey && (
          <button
            className="btn btn--primary btn--large"
            onClick={async () => {
              setFailed(!(await unlockWithPasskey()));
            }}
          >
            <FpIcon size={18} /> {t('unlock.passkey')}
          </button>
        )}
        {failed && (
          <p className="error" role="alert">
            {t('unlock.failed')}
          </p>
        )}
        {mode === 'phrase' ? (
          <PhraseUnlock onLink={() => setMode('link')} />
        ) : (
          <div className="row">
            <button className="link-btn" onClick={() => setMode('phrase')}>
              {t('unlock.phrase')}
            </button>
            <button className="link-btn" onClick={() => setMode('link')}>
              {t('unlock.linkInstead')}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

/** Le 12 parole del Symbolon. */
export function PhraseUnlock({ onLink }: { onLink?: () => void }) {
  const adoptPhrase = useSession((s) => s.adoptPhrase);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await adoptPhrase(text);
        setErr(r === 'ok' ? null : t(r === 'bad' ? 'unlock.bad' : r === 'offline' ? 'offline.text' : 'unlock.other'));
        if (r === 'ok') setText('');
      }}
    >
      <label className="form__col">
        <span>{t('unlock.phrase')}</span>
        <textarea className="input phrase-input" rows={3} autoComplete="off" autoCapitalize="none" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
      <div className="row">
        {onLink && (
          <button type="button" className="link-btn" onClick={onLink}>
            {t('unlock.linkInstead')}
          </button>
        )}
        <button type="submit" className="btn btn--primary" disabled={!text.trim()}>
          {t('unlock.go')}
        </button>
      </div>
    </form>
  );
}
