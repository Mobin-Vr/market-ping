import { DEFAULT_LANG, type Lang } from '../types';

export interface UserRow {
   chat_id: number;
   username: string | null;
   first_name: string | null;
   subscribed: number;
   joined_at: number | null;
   blocked: number;
   last_manual_at: number | null;
   lang: string | null;
}

export interface UpsertUserInput {
   chatId: number;
   username: string | null;
   firstName: string | null;
   joinedAt: number;
}

export interface BroadcastTarget {
   chatId: number;
   lang: Lang;
}

const USER_COLUMNS =
   'chat_id, username, first_name, subscribed, joined_at, blocked, last_manual_at, lang';

/** Creates the user on first contact (Persian by default) and clears a "blocked" flag. */
export async function upsertUser(db: D1Database, input: UpsertUserInput): Promise<void> {
   await db
      .prepare(
         `INSERT INTO users (chat_id, username, first_name, subscribed, joined_at, blocked, last_manual_at, lang)
          VALUES (?1, ?2, ?3, 0, ?4, 0, NULL, '${DEFAULT_LANG}')
          ON CONFLICT(chat_id) DO UPDATE SET
            username = excluded.username,
            first_name = excluded.first_name,
            blocked = 0`,
      )
      .bind(input.chatId, input.username, input.firstName, input.joinedAt)
      .run();
}

export async function getUser(db: D1Database, chatId: number): Promise<UserRow | null> {
   return (
      (await db
         .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE chat_id = ?1`)
         .bind(chatId)
         .first<UserRow>()) ?? null
   );
}

/** Persists the chosen message language. */
export async function setUserLang(db: D1Database, chatId: number, lang: Lang): Promise<void> {
   await db
      .prepare('UPDATE users SET lang = ?2 WHERE chat_id = ?1')
      .bind(chatId, lang)
      .run();
}

export async function setSubscribed(db: D1Database, chatId: number, subscribed: boolean): Promise<void> {
   await db
      .prepare('UPDATE users SET subscribed = ?2 WHERE chat_id = ?1')
      .bind(chatId, subscribed ? 1 : 0)
      .run();
}

/** Telegram says the bot can no longer reach this chat: unsubscribe and flag it. */
export async function markBlocked(db: D1Database, chatId: number): Promise<void> {
   await db
      .prepare('UPDATE users SET blocked = 1, subscribed = 0 WHERE chat_id = ?1')
      .bind(chatId)
      .run();
}

export async function touchManual(db: D1Database, chatId: number, epochSec: number): Promise<void> {
   await db
      .prepare('UPDATE users SET last_manual_at = ?2 WHERE chat_id = ?1')
      .bind(chatId, epochSec)
      .run();
}

export async function countSubscribers(db: D1Database): Promise<number> {
   const row = await db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE subscribed = 1 AND blocked = 0')
      .first<{ n: number }>();
   return Number(row?.n ?? 0);
}

/**
 * Broadcast targets (chat id + language), index-backed by idx_users_subscribed_lang.
 * Ordered by chat_id so chunking is deterministic; the language is resolved per row.
 */
export async function listSubscribedTargets(db: D1Database): Promise<BroadcastTarget[]> {
   const result = await db
      .prepare(
         'SELECT chat_id, lang FROM users WHERE subscribed = 1 AND blocked = 0 ORDER BY chat_id ASC',
      )
      .all<{ chat_id: number; lang: string | null }>();
   return (result.results ?? []).map((row) => ({
      chatId: Number(row.chat_id),
      lang: row.lang === 'en' ? 'en' : DEFAULT_LANG,
   }));
}