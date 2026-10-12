// Preferenze di questo browser (tema e lingua): comodita' locali, non dati dell'account.
import { create } from 'zustand';
import { setLang, getLang, type Lang } from '../i18n';

export type Theme = 'light' | 'dark' | 'system';

function read<T extends string>(key: string, ok: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && ok.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* solo per questa sessione */
  }
}

export function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

interface Prefs {
  theme: Theme;
  lang: Lang;
  setTheme(t: Theme): void;
  setLang(l: Lang): void;
}

export const usePrefs = create<Prefs>((set) => {
  const theme = read<Theme>('athenai:theme', ['light', 'dark', 'system'], 'system');
  const lang = read<Lang>('athenai:lang', ['it', 'en'], getLang());
  applyTheme(theme);
  setLang(lang);
  return {
    theme,
    lang,
    setTheme(t) {
      applyTheme(t);
      write('athenai:theme', t);
      set({ theme: t });
    },
    setLang(l) {
      setLang(l);
      write('athenai:lang', l);
      set({ lang: l });
    },
  };
});
