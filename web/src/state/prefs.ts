// Preferenze dell'utente (tema, lingua, modo di sblocco): stanno sul server, cifrate con una chiave
// derivata dalla sua chiave principale. Prima dell'accesso valgono quelle del browser; nulla si
// salva in locale.
import { create } from 'zustand';
import { setLang, getLang, type Lang } from '../i18n';

export type Theme = 'light' | 'dark' | 'system';
export type UnlockMode = 'passkey' | 'device' | 'phrase';

export interface UserPrefs {
  theme: Theme;
  lang: Lang;
  /** come l'utente ha scelto di sbloccare (assente = da scegliere) */
  unlock?: UnlockMode;
}

export function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

interface PrefsState extends UserPrefs {
  /** chi salva (impostato dalla sessione quando l'utente e' sbloccato) */
  saver: ((p: UserPrefs) => Promise<void>) | null;
  apply(p: Partial<UserPrefs>): void;
  update(p: Partial<UserPrefs>): Promise<void>;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  theme: 'system',
  lang: getLang(),
  saver: null,
  apply(p) {
    if (p.theme) applyTheme(p.theme);
    if (p.lang) setLang(p.lang);
    set(p);
  },
  async update(p) {
    get().apply(p);
    const { theme, lang, unlock, saver } = get();
    await saver?.({ theme, lang, unlock });
  },
}));
