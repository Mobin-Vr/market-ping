import { sendAdminPanel } from '../admin/panel';
import { getSnapshotForUser } from '../broadcast/snapshot';
import { MANUAL_COOLDOWN_SEC } from '../config';
import { isServiceEnabled } from '../db/settings';
import { getUser, setSubscribed, setUserLang, touchManual, upsertUser } from '../db/users';
import { resolveLang, t, type Lang } from '../i18n';
import { errorName, logEvent } from '../log';
import { parseAdminIds } from '../security';
import { nowSec } from '../time';
import type { Env, TgMessage } from '../types';
import { editOrSend, tgSendMessage } from './api';
import { languageKeyboard, subscribedKeyboard, welcomeKeyboard } from './keyboards';
import { renderProfileReport, setupBotProfile } from './profile';

/** Stored language of a chat (unknown users fall back to the default: Persian). */
export async function userLang(env: Env, chatId: number): Promise<Lang> {
   const user = await getUser(env.DB, chatId);
   return resolveLang(user?.lang);
}

/**
 * Welcome text with the button set matching the user's state. Edits the message in place
 * when a message id is known (language toggle), otherwise sends a new one.
 */
export async function sendWelcome(
   env: Env,
   chatId: number,
   lang: Lang,
   messageId: number | null = null,
): Promise<void> {
   const user = await getUser(env.DB, chatId);
   const strings = t(lang);
   const keyboard = user?.subscribed === 1 ? subscribedKeyboard(lang) : welcomeKeyboard(lang);
   await editOrSend(env.TELEGRAM_BOT_TOKEN, chatId, messageId, strings.welcome, keyboard);
}

/** /language picker, localized. */
export async function sendLanguagePicker(
   env: Env,
   chatId: number,
   lang: Lang,
   messageId: number | null = null,
): Promise<void> {
   await editOrSend(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      messageId,
      t(lang).languagePicker,
      languageKeyboard(),
   );
}

/**
 * Manual price request (/price or the "Get prices now" button) in the user's language.
 * Serves the stored snapshot; the price APIs are never called once per user.
 */
export async function sendPriceOnDemand(env: Env, chatId: number): Promise<void> {
   const token = env.TELEGRAM_BOT_TOKEN;
   const lang = await userLang(env, chatId);
   const strings = t(lang);
   if (!(await isServiceEnabled(env.DB))) {
      await tgSendMessage(token, chatId, strings.paused);
      return;
   }
   const now = nowSec();
   const user = await getUser(env.DB, chatId);
   const lastManual = user?.last_manual_at ?? null;
   if (lastManual !== null && now - lastManual < MANUAL_COOLDOWN_SEC) {
      await tgSendMessage(token, chatId, strings.cooldown);
      return;
   }
   await touchManual(env.DB, chatId, now);
   const snapshot = await getSnapshotForUser(env, now, lang);
   if (snapshot !== null) {
      await tgSendMessage(token, chatId, snapshot.html);
      return;
   }
   await tgSendMessage(token, chatId, strings.priceNotReady);
}

/** Leaves the queue; edits the panel in place when a message id is known. */
export async function leaveQueue(env: Env, chatId: number, messageId: number | null): Promise<void> {
   const lang = await userLang(env, chatId);
   await setSubscribed(env.DB, chatId, false);
   await editOrSend(env.TELEGRAM_BOT_TOKEN, chatId, messageId, t(lang).left, welcomeKeyboard(lang));
}

/** Stores the chosen language and rewrites the current message in that language. */
export async function switchLanguage(
   env: Env,
   chatId: number,
   lang: Lang,
   messageId: number | null,
): Promise<void> {
   await setUserLang(env.DB, chatId, lang);
   logEvent('user.language_changed', { lang });
   await sendWelcome(env, chatId, lang, messageId);
}

/** Entry point for every private-chat message update. */
export async function handleMessageUpdate(env: Env, msg: TgMessage): Promise<void> {
   const chatId = msg.chat.id;
   const userId = msg.from?.id ?? chatId;
   const text = (msg.text ?? '').trim();

   try {
      await upsertUser(env.DB, {
         chatId,
         username: msg.from?.username ?? msg.chat.username ?? null,
         firstName: msg.from?.first_name ?? msg.chat.first_name ?? null,
         joinedAt: nowSec(),
      });
   } catch (err) {
      logEvent('db.upsert_user_failed', { error: errorName(err) });
   }

   const lang = await userLang(env, chatId);
   const strings = t(lang);
   const command = text.startsWith('/') ? (text.split(/[\s@]/)[0] ?? '').toLowerCase() : '';

   try {
      switch (command) {
         case '/start':
         case '/menu':
            await sendWelcome(env, chatId, lang);
            return;
         case '/help':
            await tgSendMessage(env.TELEGRAM_BOT_TOKEN, chatId, strings.help);
            return;
         case '/price':
            await sendPriceOnDemand(env, chatId);
            return;
         case '/stop':
            await leaveQueue(env, chatId, null);
            return;
         case '/language':
            await sendLanguagePicker(env, chatId, lang);
            return;
         case '/admin': {
            if (!parseAdminIds(env.ADMIN_IDS).includes(userId)) return; // non-admins: no response
            await sendAdminPanel(env, chatId);
            return;
         }
         case '/setup_profile': {
            if (!parseAdminIds(env.ADMIN_IDS).includes(userId)) return;
            const results = await setupBotProfile(env);
            await tgSendMessage(env.TELEGRAM_BOT_TOKEN, chatId, renderProfileReport(results));
            return;
         }
         default:
            // Every other text (and unknown slash command) returns the localized welcome menu.
            await sendWelcome(env, chatId, lang);
      }
   } catch (err) {
      logEvent('message.handler_failed', { error: errorName(err), command: command.slice(0, 16) });
      await tgSendMessage(env.TELEGRAM_BOT_TOKEN, chatId, strings.genericError);
   }
}