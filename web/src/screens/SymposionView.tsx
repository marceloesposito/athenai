// Un Symposion: una delle tre sezioni. Agora' e Anamnesis arrivano nelle prossime fasi.
import { LayoutDashboard, History } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { t, useLang } from '../i18n';
import { useWork } from '../state/work';

// l'editor (TipTap) si scarica solo quando serve
const Grapheion = lazy(() => import('./Grapheion').then((m) => ({ default: m.Grapheion })));

export function SymposionView() {
  useLang();
  const view = useWork((s) => s.view);
  if (view.kind !== 'symposion') return null;
  if (view.section === 'grapheion')
    return (
      <Suspense fallback={<main className="loading" aria-busy="true" />}>
        <Grapheion />
      </Suspense>
    );
  const Icon = view.section === 'agora' ? LayoutDashboard : History;
  return (
    <main className="soon">
      <Icon size={36} strokeWidth={1.4} className="soon__icon" style={{ color: view.section === 'agora' ? 'var(--series-1)' : 'var(--series-3)' }} />
      <h1>{t(`section.${view.section}`)}</h1>
      <p>{t(`section.${view.section}.about`)}</p>
      <p className="hint">{t('section.soon')}</p>
    </main>
  );
}
