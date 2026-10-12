// Frase di recupero (Symbolon): 12 parole BIP39 = 128 bit casuali. E' la radice di tutte le chiavi
// dell'utente: chi la conosce ricostruisce l'identita' su qualunque dispositivo, nessun altro puo'.
// Si accetta in italiano o in inglese; si mostra nella lingua dell'interfaccia.
import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import { wordlist as italian } from '@scure/bip39/wordlists/italian.js';

export type PhraseLang = 'it' | 'en';

const LISTS: Record<PhraseLang, string[]> = { it: italian, en: english };

export function newRecoveryPhrase(lang: PhraseLang): string {
  return generateMnemonic(LISTS[lang], 128);
}

/** Spazi, maiuscole e accenti come li scrive una persona: forma canonica della frase. */
export function normalizePhrase(phrase: string): string {
  return phrase
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .join(' ');
}

/** I 16 byte casuali della frase, in qualunque lingua supportata; null se la frase non e' valida. */
export function phraseEntropy(phrase: string): Uint8Array | null {
  const p = normalizePhrase(phrase);
  for (const lang of Object.keys(LISTS) as PhraseLang[]) {
    const list = LISTS[lang];
    if (validateMnemonic(p, list)) return mnemonicToEntropy(p, list);
  }
  return null;
}

export function phraseWords(phrase: string): string[] {
  return normalizePhrase(phrase).split(' ');
}

/** Posizioni (da 0) da far riscrivere per controllare che la frase sia stata copiata. */
export function confirmationPositions(count: number, random: () => number = Math.random): number[] {
  const all = Array.from({ length: 12 }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count).sort((a, b) => a - b);
}
