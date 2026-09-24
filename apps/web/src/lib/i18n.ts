import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import es from '../locales/es.json';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
] as const;
export type Language = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'testrex-language';

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'es') return stored;
  } catch {
    // Storage unavailable: fall back to the browser language.
  }
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language);
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // The choice then lasts for this visit only.
  }
}

export function formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(i18n.language, options ?? { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

export function formatDateTime(value: string | Date): string {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' });
}

export default i18n;
