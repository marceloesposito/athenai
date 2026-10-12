import { useEffect } from 'react';
import { useSession } from './state/session';
import { usePrefs } from './state/prefs';
import { useLang, t } from './i18n';
import { Propylaia } from './screens/Propylaia';
import { SymbolonCreate } from './screens/SymbolonCreate';
import { ProtectStep } from './screens/ProtectStep';
import { Unlock } from './screens/Unlock';
import { Akropolis } from './screens/Akropolis';
import { PolisView } from './screens/PolisView';
import { usePolis } from './state/polis';
import { Kylix } from './brand/Kylix';
import { Offline } from './screens/Offline';

export default function App() {
  useLang();
  usePrefs();
  const { phase, init } = useSession();
  const view = usePolis((s) => s.view.kind);
  useEffect(() => {
    void init();
  }, [init]);
  switch (phase) {
    case 'loading':
      return (
        <main className="splash" aria-busy="true">
          <Kylix size={56} title={t('auth.returning')} />
        </main>
      );
    case 'offline':
      return <Offline />;
    case 'signedOut':
      return <Propylaia />;
    case 'needsSymbolon':
      return <SymbolonCreate />;
    case 'protect':
      return <ProtectStep />;
    case 'locked':
      return <Unlock />;
    case 'ready':
      return view === 'polis' ? <PolisView /> : <Akropolis />;
  }
}
