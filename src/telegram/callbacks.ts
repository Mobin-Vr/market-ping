import { handleAdminCallback } from '../admin/panel';
import { getSnapshotForUser } from '../broadcast/snapshot';
import { CALLBACK_ALLOWLIST, CALLBACK_DATA } from '../config';
import { isServiceEnabled } from '../db/settings';
import { setSubscribed } from '../db/users';
import { t, type Lang } from '../i18n';
import { errorName, logEvent } from '../log';
import { isWithinSendHours, nowSec } from '../time';
import type { Env, TgCallbackQuery } from '../types';
import { editOrSend, tgAnswerCallbackQuery, tgSendMessage } from './api';
import { leaveQueue, sendPriceOnDemand, switchLanguage, userLang } from './commands';
import { subscribedKeyboard } from './keyboards';

/** Join flow: subscribe, edit the panel, then add prices or the next update time. */
async function joinQueue(env: Env, chatId: number, lang: Lang, messageId: number | null): Promise<void> {
   const token = env.TELEGRAM_BOT_TOKEN;
   const strings = t(lang);
   await setSubscribed(env.DB, chatId, true);
   await editOrSend(token, chatId, messageId, strings.joined, subscribedKeyboard(lang));

   if (!(await isServiceEnabled(env.DB))) {
      await tgSendMessage(token, chatId, strings.paused);
      return;
   }
   const now = nowSec();
   if (isWithinSendHours(now)) {
      const snapshot = await getSnapshotForUser(env, now, lang);
      if (snapshot !== null) {
         await tgSendMessage(token, chatId, snapshot.html);
         return;
      }
   }
   await tgSendMessage(token, chatId, strings.nextUpdateText(now));
}

/** Entry point for every callback_query update. Always answers the callback. */
export async function handleCallbackQueryUpdate(env: Env, query: TgCallbackQuery): Promise<void> {
   const token = env.TELEGRAM_BOT_TOKEN;
   const chatId = query.message?.chat.id ?? query.from.id;
   const messageId = query.message?.message_id ?? null;
   const data = query.data ?? '';
   let lang: Lang = 'fa';
   try {
      lang = await userLang(env, chatId);
   } catch (err) {
      logEvent('callback.lang_lookup_failed', { error: errorName(err) });
   }

   try {
      if (!CALLBACK_ALLOWLIST.includes(data)) {
         logEvent('callback.rejected', { data: data.slice(0, 32) });
         await tgAnswerCallbackQuery(token, query.id);
         return;
      }
      let toast: string | null = null;
      if (data === CALLBACK_DATA.join) {
         await joinQueue(env, chatId, lang, messageId);
      } else if (data === CALLBACK_DATA.leave) {
         await leaveQueue(env, chatId, messageId);
      } else if (data === CALLBACK_DATA.price) {
         await sendPriceOnDemand(env, chatId);
      } else if (data === CALLBACK_DATA.langFa || data === CALLBACK_DATA.langEn) {
         const next: Lang = data === CALLBACK_DATA.langFa ? 'fa' : 'en';
         await switchLanguage(env, chatId, next, messageId);
         toast = t(next).languageChangedToast;
      } else if (data.startsWith('admin:')) {
         toast = await handleAdminCallback(env, query, data);
      }
      await tgAnswerCallbackQuery(token, query.id, toast ?? undefined);
   } catch (err) {
      logEvent('callback.failed', { data: data.slice(0, 32), error: errorName(err) });
      await tgAnswerCallbackQuery(token, query.id);
      await tgSendMessage(token, chatId, t(lang).genericError);
   }
}