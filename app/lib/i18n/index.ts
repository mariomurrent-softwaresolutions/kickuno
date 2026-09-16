import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import commonDe from './locales/de/common.json';
import profilDe from './locales/de/profil.json';
import einstellungenDe from './locales/de/einstellungen.json';
import hallenDe from './locales/de/hallen.json';
import saisonsDe from './locales/de/saisons.json';
import gruppeDe from './locales/de/gruppe.json';
import startDe from './locales/de/start.json';
import termineDe from './locales/de/termine.json';
import neuerTerminDe from './locales/de/neuerTermin.json';
import terminDetailDe from './locales/de/terminDetail.json';
import ergebnisDe from './locales/de/ergebnis.json';
import statistikDe from './locales/de/statistik.json';
import uebersichtDe from './locales/de/uebersicht.json';
import spielerprofilDe from './locales/de/spielerprofil.json';
import loginDe from './locales/de/login.json';
import joinDe from './locales/de/join.json';
import commonEn from './locales/en/common.json';
import profilEn from './locales/en/profil.json';
import einstellungenEn from './locales/en/einstellungen.json';
import hallenEn from './locales/en/hallen.json';
import saisonsEn from './locales/en/saisons.json';
import gruppeEn from './locales/en/gruppe.json';
import startEn from './locales/en/start.json';
import termineEn from './locales/en/termine.json';
import neuerTerminEn from './locales/en/neuerTermin.json';
import terminDetailEn from './locales/en/terminDetail.json';
import ergebnisEn from './locales/en/ergebnis.json';
import statistikEn from './locales/en/statistik.json';
import uebersichtEn from './locales/en/uebersicht.json';
import spielerprofilEn from './locales/en/spielerprofil.json';
import loginEn from './locales/en/login.json';
import joinEn from './locales/en/join.json';

/**
 * Multi-language support — feature-plan-i18n-localization.md. Scope is
 * `app/` only: the backend stays German unconditionally (see that plan's
 * "Backend stays German" section), so this module and its catalogs are the
 * entire i18n surface.
 *
 * Language is a per-user, app-level preference (not per-group): it
 * defaults to the phone's language on first login and can be changed any
 * time from the Profil tab, independently of what any other member of the
 * same group has chosen. German is the fallback whenever the device's
 * language isn't one the app ships yet.
 */
export const SUPPORTED_LANGUAGES = ['de', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'de';

export function isSupportedLanguage(code: string | null | undefined): code is SupportedLanguage {
  return !!code && (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

/**
 * The language to boot the app with, before any account is known: the
 * device's own preferred language if the app ships it, German otherwise.
 * Only ever consulted once, at app start — from then on a signed-in user's
 * saved `users.locale` (applied via `applyUserLocale` below) wins.
 */
export function resolveDeviceLanguage(): SupportedLanguage {
  const deviceCode = Localization.getLocales()[0]?.languageCode;
  return isSupportedLanguage(deviceCode) ? deviceCode : DEFAULT_LANGUAGE;
}

/**
 * A BCP-47 tag suitable for `Intl`/`toLocaleDateString` calls, derived from
 * the currently active app language — used anywhere a screen used to call
 * `toLocaleDateString('de-AT', …)` with a hardcoded locale (e.g. the
 * Saisons screen's date-range subtitle). Not the same thing as
 * `i18next.language` itself: a two-letter language code like `'en'` works
 * for translation lookups but under-specifies date conventions (day/month
 * order, separators), so this picks one concrete region per supported
 * language.
 */
export function dateFnsLocaleTag(): string {
  return i18next.language === 'en' ? 'en-GB' : 'de-AT';
}

void i18next.use(initReactI18next).init({
  lng: resolveDeviceLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: 'common',
  ns: ['common', 'profil', 'einstellungen', 'hallen', 'saisons', 'gruppe', 'start', 'termine', 'neuerTermin', 'terminDetail', 'ergebnis', 'statistik', 'uebersicht', 'spielerprofil', 'login', 'join'],
  resources: {
    de: { common: commonDe, profil: profilDe, einstellungen: einstellungenDe, hallen: hallenDe, saisons: saisonsDe, gruppe: gruppeDe, start: startDe, termine: termineDe, neuerTermin: neuerTerminDe, terminDetail: terminDetailDe, ergebnis: ergebnisDe, statistik: statistikDe, uebersicht: uebersichtDe, spielerprofil: spielerprofilDe, login: loginDe, join: joinDe },
    en: { common: commonEn, profil: profilEn, einstellungen: einstellungenEn, hallen: hallenEn, saisons: saisonsEn, gruppe: gruppeEn, start: startEn, termine: termineEn, neuerTermin: neuerTerminEn, terminDetail: terminDetailEn, ergebnis: ergebnisEn, statistik: statistikEn, uebersicht: uebersichtEn, spielerprofil: spielerprofilEn, login: loginEn, join: joinEn },
  },
  interpolation: { escapeValue: false }, // React already escapes — i18next's own HTML-escaping would double-encode.
  react: { useSuspense: false },
});

/**
 * Switches the running app to a signed-in user's saved language choice —
 * call this once a `users` record is known (auth-context.tsx: on session
 * restore, and right after login/register). A `locale` of `undefined`
 * (never chosen yet) or an unrecognized value leaves whatever
 * `resolveDeviceLanguage()` already picked untouched.
 */
export function applyUserLocale(locale: string | null | undefined): void {
  if (isSupportedLanguage(locale) && locale !== i18next.language) {
    void i18next.changeLanguage(locale);
  }
}

export default i18next;
