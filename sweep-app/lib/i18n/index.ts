// lib/i18n/index.ts
//
// Language selection and string lookup.
//
// Follows the same shape as the theme and connection stores: an observable
// value the whole tree reads, so changing language re-renders everything at
// once rather than needing screens to refetch or remount.
//
// Defaults to the phone's language when we support it, English otherwise. A
// stored choice always wins — someone with a Spanish phone who picked English
// meant it.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { getLocales } from "expo-localization";
import { type Language, type Translations, translations } from "./translations";

const KEY = "sweep.language";

export const LANGUAGES: { code: Language; label: string; english: string }[] = [
  // Labelled in their own language: someone who can't read the current UI
  // still has to be able to find theirs.
  { code: "en", label: "English", english: "English" },
  { code: "es", label: "Español", english: "Spanish" },
];

function deviceDefault(): Language {
  const codes = getLocales().map((l) => l.languageCode);
  for (const code of codes) {
    if (code && code in translations) return code as Language;
  }
  return "en";
}

let language: Language = deviceDefault();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Read the stored choice. Call once at start-up. */
export async function loadLanguage() {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored && stored in translations && stored !== language) {
      language = stored as Language;
      emit();
    }
  } catch {
    // A failed read just means the device default, which is a fine answer.
  }
}

export function setLanguage(next: Language) {
  if (language === next) return;
  language = next;
  emit();
  void AsyncStorage.setItem(KEY, next).catch(() => {});
}

/** For non-React callers — notably the API client's Accept-Language header. */
export function currentLanguage(): Language {
  return language;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, () => language, () => "en");
}

type Dict = Record<string, Record<string, string>>;

/**
 * Every key that actually exists, as "section.name".
 *
 * Derived from the English bundle rather than maintained by hand, so it can't
 * drift from it. This is what makes a renamed or misspelled key a compile
 * error instead of a screen showing `plans.createAccount` to a user — which
 * has happened, and which checkKeys.mjs only catches for keys written as
 * literals at the call site. A key computed at runtime was invisible to both
 * until this existed.
 */
export type TranslationKey = {
  [Section in keyof Translations & string]: Translations[Section] extends Record<
    string,
    unknown
  >
    ? `${Section}.${keyof Translations[Section] & string}`
    : never;
}[keyof Translations & string];

/**
 * Look up a dotted key, e.g. t("profile.signOut").
 *
 * A missing key returns the English string rather than the key itself. A user
 * seeing one English sentence among Spanish ones is a small blemish; seeing
 * `profile.signOut` is a bug report.
 */
export function translate(
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const [section, name] = key.split(".");
  const dict = translations[language] as unknown as Dict;
  const fallback = translations.en as unknown as Dict;

  let text = dict?.[section]?.[name] ?? fallback?.[section]?.[name];
  if (text === undefined) {
    if (__DEV__) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return text;
}

/** The shape of `translate`, for helpers that take it as a parameter. */
export type Translate = typeof translate;

/**
 * Hook form. Subscribes the component so a language change re-renders it —
 * calling `translate` directly in a component would render stale text until
 * something else happened to update it.
 */
export function useTranslate() {
  useLanguage();
  return translate;
}
