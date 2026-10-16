import { useEffect } from 'react';
import { useSession } from './state/session';
import { usePrefs } from './state/prefs';
import { useWork } from './state/work';
import { useLang } from './i18n';
import { Welcome } from './screens/Welcome';
import { GuestJoin } from './screens/GuestJoin';
import { Home } from './screens/Home';
import { SymposionView } from './screens/SymposionView';
import { Shell } from './shell/Shell';
import { Logo } from './brand/Logo';

export default function App() {
  useLang();
  usePrefs();
  const { phase, init } = useSession();
  const view = useWork((s) => s.view.kind);
  const started = useWork((s) => s.polis !== null || s.view.kind === 'symposion');
  useEffect(() => {
    void init();
  }, [init]);
  // appena dentro (account o ospite) si apre il lavoro
  useEffect(() => {
    if (phase === 'ready' || phase === 'guest') void useWork.getState().start();
  }, [phase]);
  switch (phase) {
    case 'loading':
      return (
        <main className="splash" aria-busy="true">
          <Logo size={40} />
        </main>
      );
    case 'signedOut':
      return <Welcome />;
    case 'guestInvite':
      return <GuestJoin />;
    case 'ready':
    case 'guest':
      if (!started)
        return (
          <main className="splash" aria-busy="true">
            <Logo size={40} />
          </main>
        );
      return <Shell>{view === 'symposion' ? <SymposionView /> : <Home />}</Shell>;
  }
}
