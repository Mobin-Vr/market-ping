/** All metric identifiers used across the bot. */
export const METRIC_NAMES = [
   'usd_toman',
   'btc_usd',
   'ounce_usd',
   'gold18_toman',
   'coin_quarter_toman',
   'coin_half_toman',
   'coin_bahar_toman',
   'coin_emami_toman',
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

/** Upstream price sources. */
export const SOURCE_NAMES = ['nerkh', 'navasan', 'megaweb', 'zipodo'] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];

/**
 * Message languages. Both use ASCII digits (0-9) everywhere, including prices, dates and
 * times. Persian is the default for new users.
 */
export type Lang = 'fa' | 'en';
export const LANGS: readonly Lang[] = ['fa', 'en'];
export const DEFAULT_LANG: Lang = 'fa';

/** A single normalised value from one source (all Iranian prices are Toman). */
export interface Candidate {
   metric: MetricName;
   value: number;
   source: SourceName;
   updatedAtEpochSec: number | null;
   approximate: boolean;
}

/** The resolved value for one metric after priority + freshness + sanity checks. */
export interface ResolvedMetric {
   metric: MetricName;
   value: number | null;
   source: SourceName | null;
   updatedAtEpochSec: number | null;
   stale: boolean;
   approximate: boolean;
}

export type ResolvedMetrics = Record<MetricName, ResolvedMetric>;

/** Payload stored in snapshots.data_json. */
export interface SnapshotData {
   hourKey: string;
   createdAt: number;
   metrics: ResolvedMetrics;
   sources: SourceName[];
}

/** Queue message produced by the cron run and consumed in chunks. */
export interface BroadcastMessage {
   snapshotId: number;
   hourKey: string;
   chatIds: number[];
   /** Re-enqueue attempt counter (1 = first delivery). Guards against infinite retries. */
   attempt: number;
   /**
    * Language of this chunk. Optional so queue messages written by an older deployment still
    * validate; the consumer then falls back to the English message_html.
    */
   lang?: Lang;
}

export interface Env {
   DB: D1Database;
   BROADCAST_QUEUE: Queue<BroadcastMessage>;
   TELEGRAM_BOT_TOKEN: string;
   WEBHOOK_SECRET: string;
   NERKH_API_KEY: string;
   NAVASAN_API_KEY: string;
   ADMIN_IDS: string;
}

/* ------------------------------- Telegram ------------------------------- */
/* Only fields that are actually used are declared (verified against the Bot API). */

export interface InlineKeyboardButton {
   text: string;
   callback_data?: string;
}

export interface InlineKeyboardMarkup {
   inline_keyboard: InlineKeyboardButton[][];
}

export interface TgChat {
   id: number;
   type: string;
   first_name?: string;
   username?: string;
}

export interface TgUser {
   id: number;
   first_name?: string;
   username?: string;
   is_bot?: boolean;
}

export interface TgMessage {
   message_id: number;
   date?: number;
   chat: TgChat;
   from?: TgUser;
   text?: string;
}

export interface TgCallbackQuery {
   id: string;
   from: TgUser;
   message?: TgMessage;
   data?: string;
}

export interface TgChatMember {
   status: string;
   user?: TgUser;
}

export interface TgChatMemberUpdated {
   chat: TgChat;
   from: TgUser;
   date?: number;
   old_chat_member: TgChatMember;
   new_chat_member: TgChatMember;
}

export interface TgUpdate {
   update_id: number;
   message?: TgMessage;
   callback_query?: TgCallbackQuery;
   my_chat_member?: TgChatMemberUpdated;
   chat_member?: TgChatMemberUpdated;
}

/** ResponseParameters.retry_after is documented as "seconds left to wait before the request can be repeated". */
export interface TelegramApiResponse<T = unknown> {
   ok: boolean;
   status: number;
   result: T | null;
   errorCode: number | null;
   description: string | null;
   retryAfterSec: number | null;
}
