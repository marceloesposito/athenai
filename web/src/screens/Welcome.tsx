// Ingresso: la pagina di benvenuto, la registrazione (una schermata, poi si scrive), l'accesso e il
// recupero con il codice. La privacy c'e' ma non si fa notare: una riga, non un percorso.
import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD, isEmail } from '@athenai/protocol';
import { t, useLang } from '../i18n';
import { useSession } from '../state/session';
import { passwordStrength } from '../crypto/password';
import { Logo } from '../brand/Logo';

type Mode = 'landing' | 'signup' | 'signin' | 'recover';

export function Welcome() {
  useLang();
  const invited = useSession((s) => !!s.pendingInvite);
  const [mode, setMode] = useState<Mode>(invited ? 'signup' : 'landing');
  return (
    <div className="welcome">
      <header className="welcome__bar">
        <Logo size={26} withName />
        <span className="spacer" />
        {mode !== 'signin' && (
          <button className="btn btn--ghost" onClick={() => setMode('signin')}>
            {t('auth.signin')}
          </button>
        )}
      </header>
      <main className="welcome__main">
        {mode === 'landing' && <Landing onStart={() => setMode('signup')} />}
        {mode === 'signup' && <SignUp onSignIn={() => setMode('signin')} />}
        {mode === 'signin' && <SignIn onSignUp={() => setMode('signup')} onRecover={() => setMode('recover')} />}
        {mode === 'recover' && <Recover onBack={() => setMode('signin')} />}
      </main>
    </div>
  );
}

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <section className="landing">
      <h1 className="landing__title">{t('landing.title')}</h1>
      <p className="landing__lead">{t('landing.lead')}</p>
      <ul className="landing__points">
        <li>
          <strong>Agorà</strong> {t('landing.agora')}
        </li>
        <li>
          <strong>Grapheion</strong> {t('landing.grapheion')}
        </li>
        <li>
          <strong>Anamnesis</strong> {t('landing.anamnesis')}
        </li>
      </ul>
      <button className="btn btn--primary btn--large" onClick={onStart}>
        {t('landing.start')}
      </button>
      <p className="hint">{t('landing.privacy')}</p>
    </section>
  );
}

function Field(p: { label: string; type?: string; value: string; onChange(v: string): void; autoComplete?: string; autoFocus?: boolean; hint?: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{p.label}</span>
      <input className="input" type={p.type ?? 'text'} value={p.value} onChange={(e) => p.onChange(e.target.value)} autoComplete={p.autoComplete} autoFocus={p.autoFocus} required />
      {p.hint}
    </label>
  );
}

function Strength({ password }: { password: string }) {
  if (!password) return null;
  const s = passwordStrength(password);
  return (
    <span className={`strength strength--${s}`}>
      <span className="strength__bar" />
      {t(`password.strength.${s}`)}
    </span>
  );
}

const errorText = (r: string) => t(`auth.error.${r}`);

function SignUp({ onSignIn }: { onSignIn: () => void }) {
  const { signUp } = useSession();
  const invited = useSession((s) => !!s.pendingInvite);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim() && isEmail(email) && password.length >= MIN_PASSWORD;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    const r = await signUp(name, email, password, remember);
    setBusy(false);
    if (r !== 'ok') setError(errorText(r));
  };
  return (
    <form className="auth-card" onSubmit={submit}>
      <h1>{t('signup.title')}</h1>
      {invited && <p className="note">{t('signup.invited')}</p>}
      <Field label={t('field.name')} value={name} onChange={setName} autoComplete="name" autoFocus />
      <Field label={t('field.email')} type="email" value={email} onChange={setEmail} autoComplete="email" />
      <Field
        label={t('field.password')}
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={password.length > 0 && password.length < MIN_PASSWORD ? <span className="hint">{t('password.min', { n: MIN_PASSWORD })}</span> : <Strength password={password} />}
      />
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('auth.remember')}
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn btn--primary btn--large" type="submit" disabled={!valid || busy}>
        {busy ? t('signup.busy') : t('signup.submit')}
      </button>
      <p className="hint">{t('signup.note')}</p>
      <p className="auth-card__alt">
        {t('signup.haveAccount')}{' '}
        <button type="button" className="link-btn" onClick={onSignIn}>
          {t('auth.signin')}
        </button>
      </p>
    </form>
  );
}

function SignIn({ onSignUp, onRecover }: { onSignUp: () => void; onRecover: () => void }) {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await signIn(email, password, remember);
    setBusy(false);
    if (r !== 'ok') setError(errorText(r));
  };
  return (
    <form className="auth-card" onSubmit={submit}>
      <h1>{t('signin.title')}</h1>
      <Field label={t('field.email')} type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
      <Field label={t('field.password')} type="password" value={password} onChange={setPassword} autoComplete="current-password" />
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('auth.remember')}
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn btn--primary btn--large" type="submit" disabled={!email || !password || busy}>
        {busy ? t('signin.busy') : t('auth.signin')}
      </button>
      <p className="auth-card__alt">
        <button type="button" className="link-btn" onClick={onRecover}>
          {t('signin.forgot')}
        </button>
        {' · '}
        <button type="button" className="link-btn" onClick={onSignUp}>
          {t('signin.create')}
        </button>
      </p>
    </form>
  );
}

function Recover({ onBack }: { onBack: () => void }) {
  const { recover } = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await recover(email, code, password);
    setBusy(false);
    if (r !== 'ok') setError(errorText(r === 'bad' ? 'badCode' : r));
  };
  return (
    <form className="auth-card" onSubmit={submit}>
      <h1>{t('recover.title')}</h1>
      <p className="hint">{t('recover.intro')}</p>
      <Field label={t('field.email')} type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
      <Field label={t('field.recoveryCode')} value={code} onChange={setCode} autoComplete="off" />
      <Field label={t('field.newPassword')} type="password" value={password} onChange={setPassword} autoComplete="new-password" hint={<Strength password={password} />} />
      {error && <p className="error">{error}</p>}
      <button className="btn btn--primary btn--large" type="submit" disabled={!email || !code || password.length < MIN_PASSWORD || busy}>
        {t('recover.submit')}
      </button>
      <p className="hint">{t('recover.noCode')}</p>
      <p className="auth-card__alt">
        <button type="button" className="link-btn" onClick={onBack}>
          {t('common.back')}
        </button>
      </p>
    </form>
  );
}
