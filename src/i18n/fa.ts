import {
   formatTehranClock,
   formatTehranHeader,
   formatTehranShort,
   nextSendTimeEpochSec,
   tehranParts,
} from '../time';
import { RLM } from '../types';
import type { MessageStrings, ProfileStrings, TextBundle } from './index';

function ageAgoText(ageSec: number): string {
   const age = Math.max(0, Math.floor(ageSec));
   if (age < 60) return 'همین حالا';
   if (age < 3600) return `${Math.floor(age / 60)} دقیقه پیش`;
   return `${Math.floor(age / 3600)} ساعت پیش`;
}

const message: MessageStrings = {
   // Persian title: no Latin letters anywhere in a Persian message line.
   title: `${RLM}📈 <b>مارکت پینگ</b>`,
   headingCurrency: '💱 <b>نرخ ارز</b>',
   headingGoldCoins: '🥇 <b>طلا و سکه</b>',
   headingCrypto: '₿ <b>ارز دیجیتال</b>',
   metricLabels: {
      usd_toman: 'دلار',
      btc_usd: 'بیت‌کوین',
      ounce_usd: 'اونس طلا',
      gold18_toman: 'طلا گرم 18 عیار',
      coin_quarter_toman: 'ربع سکه',
      coin_half_toman: 'نیم سکه',
      coin_bahar_toman: 'تمام سکه',
      coin_emami_toman: 'سکه امامی',
   },
   na: 'ناموجود',
   tomanSuffix: ' تومان',
   formatUsdValue: (digits: string): string => `${digits} دلار`,
   staleOne: (label: string, whenShortDate: string): string =>
      `* ${label}: آخرین به‌روزرسانی ${whenShortDate}`,
   staleMany: (items: readonly string[], extra: number): string =>
      `* به‌روز نیست: ${items.join('، ')}${extra > 0 ? ` (و ${extra} مورد دیگر)` : ''}`,
   approximateNote: '~ بر اساس نرخ تتر',
   header: (epochSec: number): string => formatTehranHeader(epochSec, 'fa'),
   shortDate: (epochSec: number): string => formatTehranShort(epochSec, 'fa'),
};

const profile: ProfileStrings = {
   commands: [
      { command: 'start', description: 'شروع و نمایش منوی اصلی' },
      { command: 'menu', description: 'نمایش منوی اصلی' },
      { command: 'price', description: 'دریافت آخرین قیمت‌ها' },
      { command: 'language', description: 'تغییر زبان' },
      { command: 'stop', description: 'لغو عضویت' },
      { command: 'help', description: 'راهنما' },
   ],
   description:
      'Market Ping هر ساعت، از 09:00 تا 21:00، گزارشی مرتب از قیمت بازار ایران برای شما ارسال می‌کند.\n' +
      '\n' +
      '💵 دلار\n' +
      '🥇 اونس طلا، طلا گرم 18 عیار و سکه‌ها\n' +
      '₿ بیت‌کوین\n' +
      '\n' +
      'ابتدا Start و سپس «عضویت» را بزنید. هر زمان خواستید می‌توانید لغو کنید.',
   shortDescription:
      'قیمت ساعتی دلار، طلا، سکه و بیت‌کوین بازار ایران، از 09:00 تا 21:00.',
};

export const fa: TextBundle = {
   buttonJoin: '✅ عضویت در قیمت‌های ساعتی',
   buttonLeave: '🚪 لغو عضویت',
   buttonPrices: '💵 دریافت قیمت‌ها',
   buttonOtherLanguage: '🌐 English',
   buttonLangFa: '🇮🇷 فارسی',
   buttonLangEn: '🇬🇧 English',

   welcome:
      'سلام 👋\n' +
      '\n' +
      'هر ساعت، از 09:00 تا 21:00، یک گزارش مرتب و خلاصه از قیمت بازار ایران برای شما ارسال می‌کنیم:\n' +
      '\n' +
      '💵 دلار\n' +
      '🥇 طلا: اونس، طلا گرم 18 عیار و سکه‌ها (ربع، نیم، تمام، امامی)\n' +
      '₿ ارز دیجیتال: بیت‌کوین\n' +
      '\n' +
      'برای دریافت خودکار قیمت‌ها، دکمه‌ی «عضویت» را بزنید. هر زمان خواستید می‌توانید لغو کنید.',
   joined:
      'عضو شدید ✅\nقیمت‌ها هر ساعت، از 09:00 تا 21:00، برای شما ارسال می‌شود.',
   left: 'عضویت شما لغو شد. هر زمان خواستید می‌توانید دوباره عضو شوید.',
   joinedToast: 'عضو شدید ✅',
   leftToast: 'عضویت لغو شد.',
   priceSentToast: 'قیمت‌ها ارسال شد ✅',
   paused:
      'سرویس موقتاً توسط مدیر متوقف شده است. لطفاً بعداً دوباره تلاش کنید.',
   cooldown: 'لطفاً کمی صبر کنید و سپس دوباره تلاش کنید.',
   priceNotReady:
      'قیمت‌ها هنوز آماده نیستند. لطفاً چند لحظه‌ی دیگر دوباره تلاش کنید.',
   help:
      'راهنمای Market Ping\n' +
      '\n' +
      '• هر ساعت، از 09:00 تا 21:00، قیمت دلار، طلا، سکه و بیت‌کوین برای اعضا ارسال می‌شود.\n' +
      '• برای دریافت آخرین قیمت‌ها، دکمه‌ی «💵 دریافت قیمت‌ها» را بزنید یا /price را بفرستید.\n' +
      '• برای لغو عضویت، دکمه‌ی «🚪 لغو عضویت» را بزنید یا /stop را بفرستید.\n' +
      '• برای بازگشت به منوی اصلی، /menu را بفرستید.\n' +
      '• برای تغییر زبان، /language را بفرستید.\n' +
      '\n' +
      'اطلاعات ذخیره‌شده: شناسه‌ی چت، نام، نام کاربری و زمان عضویت. هیچ اطلاعات دیگری ذخیره نمی‌شود.',
   languagePicker: 'زبان پیام‌ها را انتخاب کنید:',
   languageChangedToast: 'زبان تغییر کرد.',
   genericError: 'مشکلی پیش آمد. لطفاً کمی بعد دوباره تلاش کنید.',

   nextUpdateText: (epochSec: number): string => {
      const next = nextSendTimeEpochSec(epochSec);
      const now = tehranParts(epochSec);
      const then = tehranParts(next);
      const sameDay =
         now.year === then.year &&
         now.month === then.month &&
         now.day === then.day;
      return `به‌روزرسانی بعدی: ${sameDay ? 'امروز' : 'فردا'} ساعت ${formatTehranClock(next)}`;
   },
   ageAgoText,
   lastUpdateLine: (createdAtEpochSec: number, nowEpochSec: number): string => {
      const ageSec = Math.max(0, nowEpochSec - createdAtEpochSec);
      return `${RLM}🕒 آخرین به‌روزرسانی: ساعت ${formatTehranClock(createdAtEpochSec)} (${ageAgoText(ageSec)})`;
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
   adminToggledToast: 'Service updated.',
   adminRefreshedToast: 'Panel refreshed.',
   adminHealthToast: 'Health checked.',
   adminSendConfirmText: (subscribers: number): string =>
      `Send prices to ${subscribers} subscriber${subscribers === 1 ? '' : 's'} now?`,
   adminBroadcastQueuedText: (recipients: number, chunks: number): string =>
      `📤 Queued for ${recipients} subscriber${recipients === 1 ? '' : 's'} in ${chunks} chunk${chunks === 1 ? '' : 's'}.`,
   allSourcesFailedText: (epochSec: number): string =>
      `All price sources failed at ${formatTehranClock(epochSec)}. Broadcast skipped.`,

   message,
   profile,
};
