// Preferenze dell'utente (nome, tema, lingua): stanno sul server, cifrate con una chiave derivata
// dalla sua chiave principale. Prima dell'accesso valgono quelle del browser; nulla si salva in locale.
import { create } from 'zustand';
import { setLang, getLang, type Lang } from '../i18n';

export type Theme = 'light' | 'dark' | 'system';

export interface UserPrefs {
  name: string;
  theme: Theme;
  lang: Lang;
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
}

interface PrefsState extends UserPrefs {
  /** chi salva (impostato dalla sessione quando l'utente e' dentro) */
  saver: ((p: UserPrefs) => Promise<void>) | null;
  apply(p: Partial<UserPrefs>): void;
  update(p: Partial<UserPrefs>): Promise<void>;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  name: '',
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
    const { name, theme, lang, saver } = get();
    await saver?.({ name, theme, lang });
  },
}));
