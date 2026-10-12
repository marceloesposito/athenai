// Identita' di Athenai: i nomi degli spazi sono nomi propri greci, uguali in tutte le lingue
// (mai tradotti), con la maiuscola. Glossario completo in docs/GLOSSARIO.md; qui quelli gia' in uso
// nell'interfaccia, controllati da un test in ogni lingua.

export interface GlossaryTerm {
  pattern: RegExp;
  /** traduzioni da evitare in qualunque lingua */
  avoid: RegExp[];
}

export const GLOSSARY: Record<string, GlossaryTerm> = {
  Athenai: { pattern: /\bAthenai\b/, avoid: [/\bAtene\b/, /\bAthens\b/] },
  Polis: { pattern: /\bPolis\b/, avoid: [/\bteam\b/i, /\bsquadr/i, /\bworkspace\b/i] },
  Oikos: { pattern: /\bOikos\b/, avoid: [/\bprogett[oi]\b/i, /\bprojects?\b/i] },
  Agorà: { pattern: /\bAgorà/, avoid: [/\bAgora\b/, /\bboard\b/i, /\blavagn/i] },
  Propylaia: { pattern: /\bPropylaia\b/, avoid: [] },
  Akropolis: { pattern: /\bAkropolis\b/, avoid: [/\bAcropoli\b/, /\bAcropolis\b/] },
  Symbolon: { pattern: /\bSymbolon\b/, avoid: [] },
  Nomoi: { pattern: /\bNomoi\b/, avoid: [/\bimpostazioni\b/i, /\bsettings\b/i, /\bpreferenze\b/i, /\bpreferences\b/i] },
  Tomos: { pattern: /\bTomo(s|i)\b/, avoid: [/\bTomo\b/] },
  Grapheion: { pattern: /\bGrapheion\b/, avoid: [] },
  Scholia: { pattern: /\bScholi(a|on)\b/, avoid: [/\bScolio\b/i, /\bScoli\b/i] },
  Keryx: { pattern: /\bKeryx\b/, avoid: [/\bAraldo\b/] },
  Heuresis: { pattern: /\bHeuresis\b/, avoid: [] },
  Symposion: { pattern: /\bSymposion\b/, avoid: [/\bSimposio\b/] },
  Mentore: { pattern: /\bMentore\b/, avoid: [/\bMentor\b/] },
  Xenos: { pattern: /\bXenos\b/, avoid: [] },
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
