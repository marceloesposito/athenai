// Creazione del Symbolon: racconto -> 12 parole -> controllo di tre parole -> come sbloccare.
import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { t, useLang, getLang } from '../i18n';
import { newRecoveryPhrase, phraseWords, confirmationPositions, normalizePhrase } from '../crypto/recovery';
import { useSession } from '../state/session';
import { Kylix } from '../brand/Kylix';
import { LinkReceive } from './LinkReceive';
import { PhraseUnlock } from './Unlock';

type Step = 'intro' | 'words' | 'confirm' | 'have' | 'link';

export function SymbolonCreate() {
  useLang();
  const [step, setStep] = useState<Step>('intro');
  const phrase = useMemo(() => newRecoveryPhrase(getLang()), []);
  const words = phraseWords(phrase);
  const positions = useMemo(() => confirmationPositions(3), []);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [wrong, setWrong] = useState(false);
  const adoptPhrase = useSession((s) => s.adoptPhrase);

  if (step === 'link') return <LinkReceive onUsePhrase={() => setStep('have')} />;

  return (
    <main className="symbolon">
      <section className="panel">
        <Kylix size={48} />
        <h1 className="display">{t('symbolon.title')}</h1>

        {step === 'intro' && (
          <>
            <p>{t('symbolon.intro')}</p>
            <div className="row">
              <button className="btn btn--primary" onClick={() => setStep('words')}>
                <ShieldCheck size={16} /> {t('symbolon.create')}
              </button>
              <button className="btn" onClick={() => setStep('link')}>
                {t('symbolon.haveOne')}
              </button>
            </div>
          </>
        )}

        {step === 'have' && <PhraseUnlock onLink={() => setStep('link')} />}

        {step === 'words' && (
          <>
            <p>{t('symbolon.write')}</p>
            <ol className="words">
              {words.map((w, i) => (
                <li key={i}>
                  <span className="words__n">{i + 1}</span> {w}
                </li>
              ))}
            </ol>
            <p className="warning">{t('symbolon.warn')}</p>
            <div className="row">
              <button className="btn" onClick={() => setStep('intro')}>
                {t('common.back')}
              </button>
              <button className="btn btn--primary" onClick={() => setStep('confirm')}>
                {t('symbolon.written')}
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = positions.every((p, i) => normalizePhrase(answers[i]) === words[p]);
              setWrong(!ok);
              if (ok) await adoptPhrase(phrase); // poi la sessione passa alla scelta dello sblocco
            }}
          >
            <p>{t('symbolon.confirm')}</p>
            {positions.map((p, i) => (
              <label key={p} className="form__row">
                <span>{t('symbolon.word', { n: p + 1 })}</span>
                <input
                  className="input"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={answers[i]}
                  onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))}
                />
              </label>
            ))}
            {wrong && (
              <p className="error" role="alert">
                {t('symbolon.wrong')}
              </p>
            )}
            <div className="row">
              <button type="button" className="btn" onClick={() => setStep('words')}>
                {t('common.back')}
              </button>
              <button type="submit" className="btn btn--primary">
                {t('symbolon.check')}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
