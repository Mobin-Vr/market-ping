import { formatTehranClock, formatTehranHeader, formatTehranShort, nextSendTimeEpochSec, tehranParts } from '../time';
import type { SourceName } from '../types';
import type { MessageStrings, ProfileStrings, TextBundle } from './index';

function ageAgoText(ageSec: number): string {
   const age = Math.max(0, Math.floor(ageSec));
   if (age < 60) return 'همین حالا';
   if (age < 3600) return `${Math.floor(age / 60)} دقیقه پیش`;
   return `${Math.floor(age / 3600)} ساعت پیش`;
}

const message: MessageStrings = {
   title: '📈 <b>Market Ping</b>',
   headingRates: '💱 <b>نرخ‌ها</b>',
   headingGold: '🥇 <b>طلا (هر گرم)</b>',
   headingCoins: '🪙 <b>سکه‌ها</b>',
   metricLabels: {
      usd_toman: 'دلار',
      btc_usd: 'بیت‌کوین',
      ounce_usd: 'اونس طلا',
      gold18_toman: 'طلای 18 عیار',
      coin_quarter_toman: 'ربع سکه',
      coin_half_toman: 'نیم سکه',
      coin_bahar_toman: 'تمام سکه (بهار آزادی)',
      coin_emami_toman: 'سکه امامی',
   },
   na: 'ناموجود',
   tomanSuffix: ' تومان',
   formatUsdValue: (digits: string): string => `${digits} دلار`,
   sourceNames: {
      nerkh: 'نرخ',
      navasan: 'نوسان',
      megaweb: 'مگاوب',
      zipodo: 'زیپودو',
   },
   staleOne: (label: string, whenShortDate: string): string =>
      `* ${label}: آخرین به‌روزرسانی ${whenShortDate}`,
   staleMany: (items: readonly string[], extra: number): string =>
      `* قدیمی: ${items.join('، ')}${extra > 0 ? ` (+${extra} مورد دیگر)` : ''}`,
   approximateNote: '~ بر اساس نرخ تتر',
   footer: (sources: readonly SourceName[]): string => {
      const names = sources.map((source) => message.sourceNames[source]);
      return names.length > 0
         ? `تومان | منبع: ${names.join('، ')}`
         : 'تومان';
   },
   header: (epochSec: number): string => formatTehranHeader(epochSec, 'fa'),
   shortDate: (epochSec: number): string => formatTehranShort(epochSec, 'fa'),
};

const profile: ProfileStrings = {
   commands: [
      { command: 'start', description: 'منوی اصلی' },
      { command: 'price', description: 'دریافت آخرین قیمت‌ها' },
      { command: 'language', description: 'تغییر زبان' },
      { command: 'stop', description: 'لغو عضویت' },
      { command: 'help', description: 'راهنما' },
   ],
   description:
      'Market Ping هر ساعت، از 09:00 تا 21:00 به وقت تهران، یک گزارش مرتب از قیمت بازار ایران برای شما می‌فرستد.\n' +
      '\n' +
      '💵 دلار (تومان)\n' +
      '🥇 اونس طلا (دلار)، طلای 18 عیار (گرم) و سکه‌ها\n' +
      '₿ بیت‌کوین (دلار)\n' +
      '\n' +
      'دکمه‌ی Start و سپس «عضویت» را بزنید. هر وقت خواستید لغو کنید.',
   shortDescription:
      'قیمت ساعتی دلار، طلا، سکه و بیت‌کوین بازار ایران، از 09:00 تا 21:00 به وقت تهران.',
};

export const fa: TextBundle = {
   buttonJoin: '✅ عضویت در قیمت‌های ساعتی',
   buttonLeave: '🚪 لغو عضویت',
   buttonPrices: '💵 دریافت قیمت‌ها',
   buttonOtherLanguage: '🌐 English',
   buttonLangFa: '🇮🇷 فارسی',
   buttonLangEn: '🇬🇧 English',

   welcome:
      'سلام 👋 به Market Ping خوش آمدید\n' +
      '\n' +
      'هر ساعت، از 09:00 تا 21:00 به وقت تهران، یک گزارش مرتب و خلاصه از قیمت بازار ایران برای شما ارسال می‌کنیم:\n' +
      '\n' +
      '💵 نرخ دلار (تومان)\n' +
      '🥇 طلا: اونس (دلار)، طلای 18 عیار (هر گرم) و سکه‌ها (ربع، نیم، تمام، امامی)\n' +
      '₿ ارز دیجیتال: بیت‌کوین (دلار)\n' +
      '\n' +
      'برای دریافت خودکار قیمت‌ها دکمه‌ی «عضویت» را بزنید. هر زمان خواستید می‌توانید لغو کنید.',
   joined:
      'عضو شدید ✅ قیمت‌ها هر ساعت از 09:00 تا 21:00 به وقت تهران ارسال می‌شود.',
   left: 'عضویت شما لغو شد. هر زمان خواستید می‌توانید دوباره عضو شوید.',
   paused: 'سرویس توسط مدیر موقتاً متوقف شده است. لطفاً بعداً دوباره تلاش کنید.',
   cooldown: 'لطفاً کمی صبر کنید و بعد دوباره درخواست دهید.',
   priceNotReady: 'قیمت‌ها هنوز آماده نیستند. لطفاً یک دقیقه‌ی دیگر دوباره تلاش کنید.',
   help:
      'راهنمای Market Ping:\n' +
      '• قیمت دلار، طلا، سکه و بیت‌کوین هر ساعت از 09:00 تا 21:00 به وقت تهران ارسال می‌شود.\n' +
      '• برای آخرین قیمت‌ها دکمه‌ی «💵 دریافت قیمت‌ها» را بزنید یا /price را بفرستید.\n' +
      '• برای لغو عضویت دکمه‌ی «🚪 لغو عضویت» را بزنید یا /stop را بفرستید.\n' +
      '• برای تغییر زبان /language را بفرستید.\n' +
      '• /help همین متن را نشان می‌دهد.\n\n' +
      'چه اطلاعاتی ذخیره می‌شود: شناسه‌ی چت، نام، نام کاربری و زمان عضویت. چیز دیگری ذخیره نمی‌شود.',
   languagePicker: 'زبان پیام‌ها را انتخاب کنید:',
   languageChangedToast: 'زبان تغییر کرد.',
   genericError: 'خطای موقت رخ داد. لطفاً بعداً دوباره تلاش کنید.',

   nextUpdateText: (epochSec: number): string => {
      const next = nextSendTimeEpochSec(epochSec);
      const now = tehranParts(epochSec);
      const then = tehranParts(next);
      const sameDay =
         now.year === then.year && now.month === then.month && now.day === then.day;
      return `به‌روزرسانی بعدی: ${sameDay ? 'امروز' : 'فردا'} ساعت ${formatTehranClock(next)} به وقت تهران.`;
   },
   ageAgoText,
   lastUpdateLine: (createdAtEpochSec: number, nowEpochSec: number): string => {
      const ageSec = Math.max(0, nowEpochSec - createdAtEpochSec);
      return `🕒 آخرین به‌روزرسانی: ${formatTehranClock(createdAtEpochSec)} به وقت تهران (${ageAgoText(ageSec)})`;
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