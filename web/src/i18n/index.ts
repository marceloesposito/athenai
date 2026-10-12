// i18n minimale (come in Alexandria): dizionari piatti, fallback inglese, interpolazione {nome}.
import { useSyncExternalStore } from 'react';
import { it } from './it';
import { en } from './en';

export type Lang = 'it' | 'en';
export type Dict = Record<string, string>;

const dicts: Record<Lang, Dict> = { it, en };
let current: Lang = typeof navigator !== 'undefined' && navigator.language?.startsWith('it') ? 'it' : 'en';
const listeners = new Set<() => void>();

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export function getLang(): Lang {
  return current;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = dicts[current][key] ?? dicts.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
