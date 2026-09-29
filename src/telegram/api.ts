import { FETCH_TIMEOUT_MS } from "../config";
import type { InlineKeyboardMarkup, TelegramApiResponse } from "../types";

const API_BASE = "https://api.telegram.org";

interface RawApiResponse<T> {
  ok?: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

/**
 * Single low-level caller for the Telegram Bot HTTP API.
 * The token is only used to build the request URL inside this function and is never logged.
 */
async function callTelegram<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<TelegramApiResponse<T>> {
  if (!token) {
    return { ok: false, status: 0, result: null, errorCode: null, description: "missing bot token", retryAfterSec: null };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let raw: RawApiResponse<T> | null = null;
    try {
      raw = (await response.json()) as RawApiResponse<T>;
    } catch {
      raw = null;
    }
    if (!raw || typeof raw !== "object") {
      return { ok: false, status: response.status, result: null, errorCode: null, description: "non-json response", retryAfterSec: null };
    }
    return {
      ok: raw.ok === true,
      status: response.status,
      result: raw.result ?? null,
      errorCode: typeof raw.error_code === "number" ? raw.error_code : null,
      description: typeof raw.description === "string" ? raw.description : null,
      retryAfterSec: typeof raw.parameters?.retry_after === "number" ? raw.parameters.retry_after : null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      result: null,
      errorCode: null,
      description: err instanceof Error ? err.name : "fetch failed",
      retryAfterSec: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function replyMarkup(keyboard?: InlineKeyboardMarkup): Record<string, unknown> {
  return keyboard ? { reply_markup: keyboard } : {};
}

/**
 * Generic Bot API call for methods without a dedicated wrapper (setMyCommands,
 * setMyDescription, setMyShortDescription). The token is never logged.
 */
export function tgCall<T = unknown>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<TelegramApiResponse<T>> {
  return callTelegram<T>(token, method, payload);
}
export function tgSendMessage(
  token: string,
  chatId: number,
  html: string,
  keyboard?: InlineKeyboardMarkup,
): Promise<TelegramApiResponse<unknown>> {
  return callTelegram(token, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...replyMarkup(keyboard),
  });
}

export function tgEditMessageText(
  token: string,
  chatId: number,
  messageId: number,
  html: string,
  keyboard?: InlineKeyboardMarkup,
): Promise<TelegramApiResponse<unknown>> {
  return callTelegram(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...replyMarkup(keyboard),
  });
}

export function tgAnswerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<TelegramApiResponse<unknown>> {
  return callTelegram(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

/** Prefer editing the existing message; fall back to sending a new one. */
export async function editOrSend(
  token: string,
  chatId: number,
  messageId: number | null,
  html: string,
  keyboard?: InlineKeyboardMarkup,
): Promise<void> {
  if (messageId !== null) {
    const edited = await tgEditMessageText(token, chatId, messageId, html, keyboard);
    if (edited.ok || (edited.description ?? "").toLowerCase().includes("message is not modified")) return;
  }
  await tgSendMessage(token, chatId, html, keyboard);
}
