// Il segno di Athenai: una A semplice in un quadrato smussato, nei colori del tema.
export function Logo({ size = 24, withName = false }: { size?: number; withName?: boolean }) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill="var(--accent)" />
        <path d="M9 24 L16 7 L23 24 M11.8 18 H20.2" fill="none" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withName && <span className="logo__name">Athenai</span>}
    </span>
  );
}
