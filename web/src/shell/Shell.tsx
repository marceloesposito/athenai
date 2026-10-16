// La cornice dell'app, sul modello di Alexandria: in alto la Polis e il Symposion, le tre sezioni
// (Agora', Grapheion, Anamnesis) come schede con icona e nome, a destra chi c'e', il salvataggio,
// "Condividi", le notifiche e il profilo. Mod+1/2/3 cambia sezione, Mod+K cerca e va ovunque.
import { useEffect, useState, type ReactNode } from 'react';
import { LayoutDashboard, PenLine, History, CircleCheck, LoaderCircle, CircleAlert, CloudOff, Search, Share2 } from 'lucide-react';
import { can } from '@athenai/protocol';
import { t, useLang } from '../i18n';
import { useWork, myRole, type Section } from '../state/work';
import { useSession } from '../state/session';
import { useDocStatus } from '../state/doc';
import { live } from '../live/socket';
import { Logo } from '../brand/Logo';
import { ProfileMenu } from './ProfileMenu';
import { NotificationsBell } from './NotificationsBell';
import { PolisSwitcher } from './PolisSwitcher';
import { QuickOpen } from './QuickOpen';
import { ShareDialog } from '../screens/ShareDialog';

export const SECTIONS: { id: Section; icon: typeof PenLine; color: string }[] = [
  { id: 'agora', icon: LayoutDashboard, color: 'var(--series-1)' },
  { id: 'grapheion', icon: PenLine, color: 'var(--series-2)' },
  { id: 'anamnesis', icon: History, color: 'var(--series-3)' },
];

const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

export function Shell({ children }: { children: ReactNode }) {
  useLang();
  const view = useWork((s) => s.view);
  const polis = useWork((s) => s.polis);
  const guest = useSession((s) => s.guest);
  const { setSection, go } = useWork();
  const [quick, setQuick] = useState(false);
  const [share, setShare] = useState(false);
  const inSymposion = view.kind === 'symposion';
  const symposionName = inSymposion ? (guest?.symposionName ?? polis?.symposia.find((s) => s.id === view.symposionId)?.name ?? '') : '';
  const governs = !guest && polis && can.govern(polis.role);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isMod(e) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuick((q) => !q);
      } else if (isMod(e) && !e.shiftKey && !e.altKey && ['1', '2', '3'].includes(e.key) && useWork.getState().view.kind === 'symposion') {
        e.preventDefault();
        setSection(SECTIONS[Number(e.key) - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSection]);

  return (
    <div className="app">
      <header className="topbar">
        <button className="topbar__home" onClick={() => !guest && void go({ kind: 'home' })} aria-label={t('nav.home')} title={t('nav.home')}>
          <Logo size={22} />
        </button>
        <nav className="crumbs" aria-label={t('nav.where')}>
          {guest ? <span className="crumbs__item">{guest.symposionName}</span> : <PolisSwitcher />}
          {inSymposion && !guest && (
            <>
              <span className="crumbs__sep">/</span>
              <span className="crumbs__item crumbs__item--strong">{symposionName}</span>
            </>
          )}
        </nav>
        {inSymposion && (
          <div className="sections" role="tablist" aria-label={t('nav.sections')}>
            {SECTIONS.map((s, i) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={view.section === s.id}
                className={`sections__tab ${view.section === s.id ? 'is-active' : ''}`}
                style={{ '--section': s.color } as React.CSSProperties}
                title={`${t(`section.${s.id}`)} (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}${i + 1})`}
                onClick={() => setSection(s.id)}
              >
                <s.icon size={16} strokeWidth={1.8} className="sections__icon" />
                <span>{t(`section.${s.id}`)}</span>
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        {inSymposion && <DocPresence />}
        <button className="icon-btn" onClick={() => setQuick(true)} title={t('quick.title')} aria-label={t('quick.title')}>
          <Search size={16} />
        </button>
        {inSymposion && governs && (
          <button className="btn btn--primary btn--small" onClick={() => setShare(true)}>
            <Share2 size={14} /> {t('share.button')}
          </button>
        )}
        {!guest && <NotificationsBell />}
        <ProfileMenu />
      </header>
      <div className="app__body">{children}</div>
      {quick && <QuickOpen onClose={() => setQuick(false)} onShare={governs && inSymposion ? () => setShare(true) : undefined} />}
      {share && inSymposion && <ShareDialog symposionId={view.symposionId} onClose={() => setShare(false)} />}
    </div>
  );
}

/** Chi c'e' nel documento e lo stato del salvataggio. */
function DocPresence() {
  const { status, present } = useDocStatus();
  const [online, setOnline] = useState(live.online);
  useEffect(() => live.onStatus(setOnline), []);
  const role = myRole();
  if (!status) return null;
  const state = !online ? 'offline' : status === 'saving' ? 'saving' : status === 'error' ? 'error' : 'saved';
  const Icon = state === 'saved' ? CircleCheck : state === 'saving' ? LoaderCircle : state === 'offline' ? CloudOff : CircleAlert;
  return (
    <>
      {!!present.length && (
        <span className="presence" aria-label={t('presence.label')}>
          {present.slice(0, 5).map((p) => (
            <span key={p.key} className="avatar avatar--small" style={{ background: p.color }} title={p.name}>
              {(p.name[0] ?? '?').toUpperCase()}
            </span>
          ))}
          {present.length > 5 && <span className="presence__more">+{present.length - 5}</span>}
        </span>
      )}
      <span className={`save save--${state}`} title={t(`save.${state}`)}>
        <Icon size={14} className={state === 'saving' ? 'spin' : ''} />
        <span className="save__label">{role.role === 'xenos' && role.mode === 'comment' && state === 'saved' ? t('save.commentOnly') : t(`save.${state}`)}</span>
      </span>
    </>
  );
}

