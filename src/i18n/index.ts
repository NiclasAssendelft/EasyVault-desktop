import { create } from "zustand";
import en from "./en";
import sv from "./sv";
import fi from "./fi";
import type { TranslationKeys as RawKeys } from "./en";

// Derive plural base keys: "foo_one" | "foo_other" → "foo"
type PluralSuffix = `${string}_one` | `${string}_other`;
type StripSuffix<K extends string> = K extends `${infer Base}_one` ? Base : K extends `${infer Base}_other` ? Base : never;
type PluralBaseKeys = StripSuffix<Extract<RawKeys, PluralSuffix>>;
type TKey = RawKeys | PluralBaseKeys;

export type Locale = "en" | "sv" | "fi";

const STORAGE_KEY = "easyvault_locale";

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const dictionaries: Record<Locale, Record<string, string>> = { en, sv, fi };

function loadLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "sv" || stored === "fi") return stored;
  return "en";
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: loadLocale(),
  setLocale: (locale) => {
    localStorage.setItem(STORAGE_KEY, locale);
    set({ locale });
  },
}));

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

function resolve(dict: Record<string, string>, key: string, vars?: Record<string, string | number>): string {
  let resolved: string;
  if (vars && typeof vars.count === "number") {
    const pluralKey = vars.count === 1 ? `${key}_one` : `${key}_other`;
    resolved = dict[pluralKey] ?? dict[key] ?? key;
  } else {
    resolved = dict[key] ?? key;
  }
  return interpolate(resolved, vars);
}

/** Bare translation function for non-React contexts (editor adapters, status messages). */
export function t(key: TKey, vars?: Record<string, string | number>): string {
  const locale = useLocaleStore.getState().locale;
  return resolve(dictionaries[locale], key, vars);
}

/** React hook — subscribes to locale changes so components re-render on language switch. */
export function useT(): (key: TKey, vars?: Record<string, string | number>) => string {
  const locale = useLocaleStore((s) => s.locale);
  return (key, vars) => resolve(dictionaries[locale], key, vars);
}

export type { TKey };
