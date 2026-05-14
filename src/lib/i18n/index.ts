import type { BotLocale, SupportedLanguage } from "./types";
import { SUPPORTED_LANGUAGES } from "./types";
import { ar } from "./locales/ar";
import { de } from "./locales/de";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { he } from "./locales/he";
import { ru } from "./locales/ru";

const locales: Record<SupportedLanguage, BotLocale> = { ar, de, en, es, fr, he, ru };

function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang);
}

/**
 * Fallback chain: requested language → en → he
 */
export function getLocale(language?: string | null): BotLocale {
  if (language && isSupportedLanguage(language)) {
    return locales[language];
  }
  return locales.en ?? locales.he;
}

export type { BotLocale, SupportedLanguage };
export { SUPPORTED_LANGUAGES };
