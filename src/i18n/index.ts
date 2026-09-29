import { DEFAULT_LANG, LANGS, type Lang, type MetricName, type SourceName } from '../types';
import { en } from './en';
import { fa } from './fa';

export { DEFAULT_LANG, LANGS };
export type { Lang, MetricName, SourceName };

/** Metric labels, units and footnote wording of one rendered message. */
export interface MessageStrings {
   title: string;
   headingRates: string;
   headingGold: string;
   headingCoins: string;
   metricLabels: Record<MetricName, string>;
   /** Value shown for a metric that could not be resolved, e.g. "N/A" / "ناموجود". */
   na: string;
   /** Suffix of a Toman value, e.g. " T" / " تومان". */
   tomanSuffix: string;
   /** Formats the digits of a USD value, e.g. "$4,142" / "4,142 دلار". */
   formatUsdValue(digits: string): string;
   sourceNames: Record<SourceName, string>;
   /** "* USD: last update 6 Mehr 1405 20:58" */
   staleOne(label: string, whenShortDate: string): string;
   /** "* Stale: USD (…), Bitcoin (…) +1 more" */
   staleMany(items: readonly string[], extra: number): string;
   /** "~ via USDT rate" */
   approximateNote: string;
   /** "T = Toman | Source: Nerkh, Megaweb" */
   footer(sources: readonly SourceName[]): string;
   /** "3Shanbe, 7 Mehr 1405 | 09:00 Tehran" */
   header(epochSec: number): string;
   /** "6 Mehr 1405 20:58" */
   shortDate(epochSec: number): string;
}

export interface TelegramCommand {
   command: string;
   description: string;
}

/** setMyCommands / setMyDescription / setMyShortDescription payloads. */
export interface ProfileStrings {
   commands: readonly TelegramCommand[];
   /** setMyDescription limit: 512 characters. */
   description: string;
   /** setMyShortDescription limit: 120 characters. */
   shortDescription: string;
}

/**
 * Every user-visible string, in one language. Both bundles are annotated with this type,
 * so a missing or misspelled key is a compile error.
 *
 * The admin panel, admin alerts and the API-health report are English only: they are always
 * rendered through t('en'), even though both bundles define the admin keys.
 */
export interface TextBundle {
   /* buttons */
   buttonJoin: string;
   buttonLeave: string;
   buttonPrices: string;
   /** Label of the button that switches to the other language ("🌐 English" / "🌐 فارسی"). */
   buttonOtherLanguage: string;
   buttonLangFa: string;
   buttonLangEn: string;

   /* user-facing texts */
   welcome: string;
   joined: string;
   left: string;
   paused: string;
   cooldown: string;
   priceNotReady: string;
   help: string;
   languagePicker: string;
   languageChangedToast: string;
   /** Shown when a handler fails. Never contains internal error details. */
   genericError: string;
   /** "Next update: today at 14:00 Tehran." */
   nextUpdateText(epochSec: number): string;
   /** "just now" / "12 min ago" / "3 h ago" */
   ageAgoText(ageSec: number): string;
   /** "🕒 Last update: 17:00 Tehran (12 min ago)" */
   lastUpdateLine(createdAtEpochSec: number, nowEpochSec: number): string;

   /* admin (rendered with t('en') only) */
   adminTitle: string;
   adminLastBroadcastNone: string;
   adminNoSubscribers: string;
   adminAllSourcesFailed: string;
   adminServiceOffToast: string;
   adminCancelledToast: string;
   adminSendStartedToast: string;
   adminButtonOn: string;
   adminButtonOff: string;
   adminButtonSend: string;
   adminButtonHealth: string;
   adminButtonRefresh: string;
   adminButtonYes: string;
   adminButtonCancel: string;
   adminSendConfirmText(subscribers: number): string;
   adminBroadcastQueuedText(recipients: number, chunks: number): string;
   /** Admin alert when every source failed and the broadcast was skipped. */
   allSourcesFailedText(epochSec: number): string;

   /* nested groups */
   message: MessageStrings;
   profile: ProfileStrings;
}

const BUNDLES: Record<Lang, TextBundle> = { fa, en };

export function isLang(value: unknown): value is Lang {
   return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** Unknown or missing values fall back to the default language (fa). */
export function resolveLang(value: unknown): Lang {
   return isLang(value) ? value : DEFAULT_LANG;
}

/** Text bundle for a language. */
export function t(lang: Lang): TextBundle {
   return BUNDLES[resolveLang(lang)];
}

export { en, fa };