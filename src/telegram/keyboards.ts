import { CALLBACK_DATA } from '../config';
import { t } from '../i18n';
import type { InlineKeyboardMarkup, Lang } from '../types';

/**
 * Row 1: the state action plus "Get prices now".
 * Row 2: the language toggle, labelled with the *other* language.
 */
export function welcomeKeyboard(lang: Lang): InlineKeyboardMarkup {
   const strings = t(lang);
   return {
      inline_keyboard: [
         [
            { text: strings.buttonJoin, callback_data: CALLBACK_DATA.join },
            { text: strings.buttonPrices, callback_data: CALLBACK_DATA.price },
         ],
         [{ text: strings.buttonOtherLanguage, callback_data: otherLangCallback(lang) }],
      ],
   };
}

/** Subscribed: [🚪 Leave / لغو عضویت] [Get prices now] + the language toggle. */
export function subscribedKeyboard(lang: Lang): InlineKeyboardMarkup {
   const strings = t(lang);
   return {
      inline_keyboard: [
         [
            { text: strings.buttonLeave, callback_data: CALLBACK_DATA.leave },
            { text: strings.buttonPrices, callback_data: CALLBACK_DATA.price },
         ],
         [{ text: strings.buttonOtherLanguage, callback_data: otherLangCallback(lang) }],
      ],
   };
}

/** The /language picker. */
export function languageKeyboard(): InlineKeyboardMarkup {
   return {
      inline_keyboard: [
         [
            { text: t('fa').buttonLangFa, callback_data: CALLBACK_DATA.langFa },
            { text: t('en').buttonLangEn, callback_data: CALLBACK_DATA.langEn },
         ],
      ],
   };
}

/** Callback that switches to the other language. */
export function otherLangCallback(lang: Lang): string {
   return lang === 'fa' ? CALLBACK_DATA.langEn : CALLBACK_DATA.langFa;
}