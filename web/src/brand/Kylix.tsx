// Logo: una kylix (la coppa del simposio) vista dall'alto, con il meandro sul bordo e un tondo
// centrale a figure rosse. Disegnata con i token: si adatta al tema.
export function Kylix({ size = 40, title }: { size?: number; title?: string }) {
  const meander = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    const x = 50 + Math.cos(a) * 38;
    const y = 50 + Math.sin(a) * 38;
    return <rect key={i} x={x - 2.2} y={y - 2.2} width={4.4} height={4.4} transform={`rotate(${(a * 180) / Math.PI + 45} ${x} ${y})`} />;
  });
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={title ? undefined : true}>
      <circle cx="50" cy="50" r="46" fill="var(--vase-red)" />
      <circle cx="50" cy="50" r="42" fill="none" stroke="var(--vase-black)" strokeWidth="1.5" />
      <g fill="var(--vase-black)">{meander}</g>
      <circle cx="50" cy="50" r="32" fill="none" stroke="var(--vase-black)" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="24" fill="var(--vase-black)" />
      {/* il tondo: un ramo d'ulivo stilizzato a figure rosse */}
      <path d="M38 58 C 46 50, 54 46, 62 42" stroke="var(--vase-red)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <g fill="var(--vase-red)">
        <ellipse cx="44" cy="51" rx="4" ry="1.8" transform="rotate(-50 44 51)" />
        <ellipse cx="50" cy="51" rx="4" ry="1.8" transform="rotate(30 50 51)" />
        <ellipse cx="52" cy="45" rx="4" ry="1.8" transform="rotate(-55 52 45)" />
        <ellipse cx="58" cy="47" rx="4" ry="1.8" transform="rotate(25 58 47)" />
        <circle cx="60" cy="40" r="2" />
      </g>
    </svg>
  );
}

/** Fascia a meandro (greca) per i dettagli: piccola, mai invadente. */
export function Meander({ width = 160 }: { width?: number }) {
  return (
    <svg width={width} height={10} viewBox={`0 0 ${width} 10`} aria-hidden className="meander">
      <path
        d={Array.from({ length: Math.floor(width / 10) }, (_, i) => `M${i * 10} 9 V1 H${i * 10 + 8} V7 H${i * 10 + 4} V4`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}
