import { useEffect } from 'react';
import { useSession } from './state/session';
import { usePrefs } from './state/prefs';
import { useLang, t } from './i18n';
import { Propylaia } from './screens/Propylaia';
import { SymbolonCreate } from './screens/SymbolonCreate';
import { ProtectStep } from './screens/ProtectStep';
import { Unlock } from './screens/Unlock';
import { Akropolis } from './screens/Akropolis';
import { Kylix } from './brand/Kylix';

export default function App() {
  useLang();
  usePrefs();
  const { phase, init } = useSession();
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
    case 'signedOut':
      return <Propylaia />;
    case 'needsSymbolon':
      return <SymbolonCreate />;
    case 'protect':
      return <ProtectStep />;
    case 'locked':
      return <Unlock />;
    case 'ready':
      return <Akropolis />;
  }
}
