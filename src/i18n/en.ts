import { formatTehranClock, formatTehranHeader, formatTehranShort, nextSendTimeEpochSec, tehranParts } from '../time';
import type { SourceName } from '../types';
import type { MessageStrings, ProfileStrings, TextBundle } from './index';

function ageAgoText(ageSec: number): string {
   const age = Math.max(0, Math.floor(ageSec));
   if (age < 60) return 'just now';
   if (age < 3600) return `${Math.floor(age / 60)} min ago`;
   return `${Math.floor(age / 3600)} h ago`;
}

const message: MessageStrings = {
   title: '📈 <b>Market Ping</b>',
   headingRates: '💱 <b>Rates</b>',
   headingGold: '🥇 <b>Gold (per gram)</b>',
   headingCoins: '🪙 <b>Coins</b>',
   metricLabels: {
      usd_toman: 'USD',
      btc_usd: 'Bitcoin',
      ounce_usd: 'Gold Ounce',
      gold18_toman: 'Tala Garam',
      coin_quarter_toman: 'Rob Seke',
      coin_half_toman: 'Nim Seke',
      coin_bahar_toman: 'Tamam Seke',
      coin_emami_toman: 'Emami',
   },
   na: 'N/A',
   tomanSuffix: ' T',
   formatUsdValue: (digits: string): string => `$${digits}`,
   sourceNames: {
      nerkh: 'Nerkh',
      navasan: 'Navasan',
      megaweb: 'Megaweb',
      zipodo: 'Zipodo',
   },
   staleOne: (label: string, whenShortDate: string): string =>
      `* ${label}: last update ${whenShortDate}`,
   staleMany: (items: readonly string[], extra: number): string =>
      `* Stale: ${items.join(', ')}${extra > 0 ? ` +${extra} more` : ''}`,
   approximateNote: '~ via USDT rate',
   footer: (sources: readonly SourceName[]): string => {
      const names = sources.map((source) => message.sourceNames[source]);
      return names.length > 0
         ? `T = Toman | Source: ${names.join(', ')}`
         : 'T = Toman';
   },
   header: (epochSec: number): string => formatTehranHeader(epochSec, 'en'),
   shortDate: (epochSec: number): string => formatTehranShort(epochSec, 'en'),
};

const profile: ProfileStrings = {
   commands: [
      { command: 'start', description: 'Main menu' },
      { command: 'price', description: 'Latest prices' },
      { command: 'language', description: 'Change language' },
      { command: 'stop', description: 'Leave hourly updates' },
      { command: 'help', description: 'How it works' },
   ],
   description:
      'Market Ping sends a clean price snapshot of the Iranian market every hour, from 09:00 to 21:00 Tehran time.\n' +
      '\n' +
      '💵 USD (Toman)\n' +
      '🥇 Gold Ounce (USD), Tala Garam (18K) and coins\n' +
      '₿ Bitcoin (USD)\n' +
      '\n' +
      'Tap Start, then Join to get hourly updates. Leave anytime.',
   shortDescription:
      'Hourly USD, Bitcoin, gold and coin prices for the Iranian market, 09:00-21:00 Tehran time.',
};

export const en: TextBundle = {
   buttonJoin: '✅ Join hourly updates',
   buttonLeave: '🚪 Leave',
   buttonPrices: '💵 Get prices now',
   buttonOtherLanguage: '🌐 فارسی',
   buttonLangFa: '🇮🇷 فارسی',
   buttonLangEn: '🇬🇧 English',

   welcome:
      'Market Ping sends a clean price snapshot of the Iranian market every hour, from 09:00 to 21:00 (Tehran time).\n' +
      '\n' +
      '- USD (Toman) 💵\n' +
      '- Gold Ounce (USD), Tala Garam (18K) and Rob, Nim, Tamam, Emami coins 🥇\n' +
      '- Bitcoin (USD) ₿\n' +
      '\n' +
      'Tap Join below to get hourly updates. Leave anytime.',
   joined: "You're in ✅ Prices arrive every hour, 09:00-21:00 Tehran time.",
   left: "You've left the queue. You can join again anytime.",
   paused: 'Service is paused by the admin. Please try again later.',
   cooldown: 'Please wait a moment before requesting again.',
   priceNotReady: 'Prices are not available yet. Please try again in a minute.',
   help:
      'How Market Ping works:\n' +
      '• USD, Gold, Coin and Bitcoin prices are sent every hour from 09:00 to 21:00 Tehran time.\n' +
      '• Tap 💵 Get prices now (or send /price) for the latest snapshot.\n' +
      '• Tap 🚪 Leave (or send /stop) to leave the queue; you can join again anytime.\n' +
      '• Send /language to switch between Persian and English.\n' +
      '• /help shows this text.\n\n' +
      'What is stored about you: your chat id, first name, username and join time. Nothing else.',
   languagePicker: 'Choose the language of the messages:',
   languageChangedToast: 'Language updated.',
   genericError: 'Something went wrong. Please try again later.',

   nextUpdateText: (epochSec: number): string => {
      const next = nextSendTimeEpochSec(epochSec);
      const now = tehranParts(epochSec);
      const then = tehranParts(next);
      const sameDay =
         now.year === then.year && now.month === then.month && now.day === then.day;
      return `Next update: ${sameDay ? 'today' : 'tomorrow'} at ${formatTehranClock(next)} Tehran.`;
   },
   ageAgoText,
   lastUpdateLine: (createdAtEpochSec: number, nowEpochSec: number): string => {
      const ageSec = Math.max(0, nowEpochSec - createdAtEpochSec);
      return `🕒 Last update: ${formatTehranClock(createdAtEpochSec)} Tehran (${ageAgoText(ageSec)})`;
   },

   adminTitle: '🛠 <b>Market Ping admin</b>',
   adminLastBroadcastNone: 'none yet',
   adminNoSubscribers: 'No subscribers yet.',
   adminAllSourcesFailed: 'All price sources failed, so nothing was sent.',
   adminServiceOffToast: 'Service is OFF. Turn it on first.',
   adminCancelledToast: 'Cancelled.',
   adminSendStartedToast: 'Sending now.',
   adminButtonOn: '🟢 Turn ON',
   adminButtonOff: '🔴 Turn OFF',
   adminButtonSend: '📤 Send now',
   adminButtonHealth: '📡 API health',
   adminButtonRefresh: '🔄 Refresh',
   adminButtonYes: 'Yes',
   adminButtonCancel: 'Cancel',
   adminSendConfirmText: (subscribers: number): string =>
      `Send prices to ${subscribers} subscriber${subscribers === 1 ? '' : 's'} now?`,
   adminBroadcastQueuedText: (recipients: number, chunks: number): string =>
      `📤 Queued for ${recipients} subscriber${recipients === 1 ? '' : 's'} in ${chunks} chunk${chunks === 1 ? '' : 's'}.`,
   allSourcesFailedText: (epochSec: number): string =>
      `All price sources failed at ${formatTehranClock(epochSec)} Tehran. Broadcast skipped.`,

   message,
   profile,
};