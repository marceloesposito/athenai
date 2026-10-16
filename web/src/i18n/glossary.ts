// I nomi greci di Athenai: pochi, solo per i luoghi (come i nomi latini di Alexandria), uguali in
// tutte le lingue e con la maiuscola. Tutto il resto si dice con parole semplici. Glossario completo
// in docs/GLOSSARIO.md; un test controlla questi in ogni lingua.

export interface GlossaryTerm {
  pattern: RegExp;
  /** traduzioni da evitare in qualunque lingua */
  avoid: RegExp[];
}

export const GLOSSARY: Record<string, GlossaryTerm> = {
  Athenai: { pattern: /\bAthenai\b/, avoid: [/\bAtene\b/, /\bAthens\b/] },
  Polis: { pattern: /\bPolis\b/, avoid: [/\bteam\b/i, /\bsquadr/i, /\bworkspace\b/i] },
  Symposion: { pattern: /\bSymposi(on|a)\b/, avoid: [/\bSymposium\b/, /\bSimposio\b/] },
  Agorà: { pattern: /\bAgorà/, avoid: [/\bAgora\b/] },
  Grapheion: { pattern: /\bGrapheion\b/, avoid: [] },
  Anamnesis: { pattern: /\bAnamnesis\b/, avoid: [] },
  Scholia: { pattern: /\bScholi(a|on)\b/, avoid: [/\bScolii?\b/] },
  Archon: { pattern: /\bArchon\b/, avoid: [/\bArconte\b/, /\bArkon\b/] },
  Polites: { pattern: /\bPolit(es|ai)\b/, avoid: [/\bPoliti\b/] },
  Xenos: { pattern: /\bXen(os|oi)\b/, avoid: [] },
};

/** Chiavi in cui `text` non rispetta il glossario rispetto al riferimento `ref` (inglese). */
export function glossaryViolations(ref: Record<string, string>, text: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(text)) {
    const base = ref[key];
    if (base === undefined) continue;
    for (const [name, term] of Object.entries(GLOSSARY)) {
      if (term.pattern.test(base) && !term.pattern.test(value)) out.push(`${key}: manca ${name}`);
      for (const bad of term.avoid) if (bad.test(value)) out.push(`${key}: ${name} tradotto (${bad.source})`);
    }
  }
  return out;
}
