import { vi } from "vitest";
import type { BroadcastMessage, Env } from "../src/types";

/* --------------------------------- D1 --------------------------------- */

export interface FakeStatementResult {
  first?: unknown;
  all?: unknown[];
  changes?: number;
  lastRowId?: number;
}

export type FakeResult = FakeStatementResult | ((params: unknown[]) => FakeStatementResult);
export type FakeRoute = readonly [string, FakeResult];

export interface FakeD1 {
  db: D1Database;
  statements: Array<{ sql: string; params: unknown[] }>;
}

/**
 * Minimal D1 double: each statement is routed by substring. Unmatched statements resolve to
 * empty results. Every call is recorded so tests can assert on the SQL and its parameters.
 */
export function createFakeD1(routes: readonly FakeRoute[]): FakeD1 {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const resolve = (sql: string, params: unknown[]): FakeStatementResult => {
    // Later routes win so tests can override a default route with an appended one.
    for (let index = routes.length - 1; index >= 0; index -= 1) {
      const route = routes[index];
      if (!sql.includes(route[0])) continue;
      return typeof route[1] === "function" ? route[1](params) : route[1];
    }
    return {};
  };
  const results = (sql: string, params: unknown[]) => ({
    first: async () => resolve(sql, params).first ?? null,
    all: async () => ({ results: resolve(sql, params).all ?? [] }),
    run: async () => {
      // Resolve once: dynamic routes may count their invocations.
      const result = resolve(sql, params);
      return { meta: { changes: result.changes ?? 0, last_row_id: result.lastRowId ?? 0 } };
    },
  });
  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => {
      statements.push({ sql, params });
      return results(sql, params);
    },
    first: async () => resolve(sql, []).first ?? null,
    all: async () => ({ results: resolve(sql, []).all ?? [] }),
    run: async () => {
      statements.push({ sql, params: [] });
      return results(sql, []).run();
    },
  });
  const db = {
    prepare,
    batch: async (batch: unknown[]) => {
      statements.push({ sql: "BATCH", params: [batch.length] });
      return batch;
    },
  } as unknown as D1Database;
  return { db, statements };
}

/* -------------------------------- Queue -------------------------------- */

export interface FakeQueue {
  queue: Queue<BroadcastMessage>;
  sent: Array<{ body: BroadcastMessage; delaySeconds: number | null }>;
  batches: BroadcastMessage[][];
}

export function createFakeQueue(): FakeQueue {
  const sent: FakeQueue["sent"] = [];
  const batches: BroadcastMessage[][] = [];
  const queue = {
    send: async (body: BroadcastMessage, options?: { delaySeconds?: number }) => {
      sent.push({ body, delaySeconds: options?.delaySeconds ?? null });
    },
    sendBatch: async (messages: Array<{ body: BroadcastMessage }>) => {
      batches.push(messages.map((item) => item.body));
    },
  } as unknown as Queue<BroadcastMessage>;
  return { queue, sent, batches };
}

/* ------------------------------- Message ------------------------------- */

export interface FakeMessageState {
  acked: boolean;
  retryDelay: number | null;
  retries: number;
}

export function createFakeMessage(body: BroadcastMessage): {
  message: Message<BroadcastMessage>;
  state: FakeMessageState;
} {
  const state: FakeMessageState = { acked: false, retryDelay: null, retries: 0 };
  const message = {
    id: "fake-message",
    timestamp: new Date(0),
    body,
    attempts: body.attempt,
    ack: () => {
      state.acked = true;
    },
    retry: (options?: { delaySeconds?: number }) => {
      state.retries += 1;
      state.retryDelay = options?.delaySeconds ?? 0;
    },
  } as unknown as Message<BroadcastMessage>;
  return { message, state };
}

/* ------------------------------- Network ------------------------------- */

export interface TelegramCall {
  chatId: number;
  text: string;
  /** Bot API method taken from the request path (the token is never read or logged). */
  method: string;
  /** Serialized reply_markup so tests can assert the keyboard. */
  keyboard: string | null;
  /** Serialized request payload so tests can assert on it. */
  payload: string;
}

export interface TelegramVerdict {
  ok: boolean;
  status?: number;
  errorCode?: number;
  description?: string;
  retryAfterSec?: number;
}

export type SourceKey = "nerkh" | "navasan" | "megaweb" | "zipodo";
export type SourceHandlers = Partial<Record<SourceKey, () => Response>>;

const SOURCE_HOSTS: Record<SourceKey, string> = {
  nerkh: "api.nerkh.io",
  navasan: "api.navasan.tech",
  megaweb: "www.megaweb.ir",
  zipodo: "api.zipodo.ir",
};

export function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Routes fetch by host only, so API keys inside URLs never reach a log or a test message.
 * Sources without a handler fail like an unreachable host; the Telegram handler defaults to
 * a successful sendMessage.
 */
export function stubNetwork(options: {
  sources?: SourceHandlers;
  telegram?: (call: TelegramCall) => TelegramVerdict;
} = {}): { telegramCalls: TelegramCall[]; telegramMethods: string[] } {
  const telegramCalls: TelegramCall[] = [];
  const telegramMethods: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.telegram.org")) {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        chat_id?: number;
        text?: string;
        reply_markup?: unknown;
      };
      const call: TelegramCall = {
        chatId: Number(payload.chat_id ?? 0),
        text: String(payload.text ?? ""),
        method: url.slice(url.lastIndexOf("/") + 1),
        keyboard: payload.reply_markup ? JSON.stringify(payload.reply_markup) : null,
        payload: JSON.stringify(payload),
      };
      telegramCalls.push(call);
      telegramMethods.push(call.method);
      const verdict = options.telegram ? options.telegram(call) : { ok: true };
      const body = verdict.ok
        ? { ok: true, result: { message_id: telegramCalls.length } }
        : {
            ok: false,
            error_code: verdict.errorCode ?? 400,
            description: verdict.description ?? "Bad Request",
            ...(verdict.retryAfterSec === undefined ? {} : { parameters: { retry_after: verdict.retryAfterSec } }),
          };
      return new Response(JSON.stringify(body), {
        status: verdict.status ?? (verdict.ok ? 200 : 400),
        headers: { "content-type": "application/json" },
      });
    }
    for (const key of Object.keys(SOURCE_HOSTS) as SourceKey[]) {
      if (url.includes(SOURCE_HOSTS[key])) {
        const handler = options.sources ? options.sources[key] : undefined;
        if (handler) return handler();
        throw new TypeError("fetch failed");
      }
    }
    throw new TypeError("unexpected target");
  });
  return { telegramCalls, telegramMethods };
}

export function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    BROADCAST_QUEUE: {} as Queue<BroadcastMessage>,
    TELEGRAM_BOT_TOKEN: "test-token",
    WEBHOOK_SECRET: "test-secret",
    NERKH_API_KEY: "test-nerkh-key",
    NAVASAN_API_KEY: "test-navasan-key",
    ADMIN_IDS: "555",
    ...overrides,
  };
}
