import { handleQueueBatch } from "./broadcast/consumer";
import { handleScheduled } from "./broadcast/cron";
import { WEBHOOK_PATH_PREFIX } from "./config";
import { errorName, logEvent } from "./log";
import { extractWebhookSecret, isWebhookAuthorized } from "./security";
import { handleUpdate } from "./telegram/update";
import type { BroadcastMessage, Env } from "./types";

/**
 * Market Ping Worker.
 *  - fetch:     Telegram webhook only (POST /telegram/<WEBHOOK_SECRET>).
 *  - scheduled: hourly broadcast pipeline (cron trigger).
 *  - queue:     chunk fan-out consumer, at most CHUNK_SIZE sends per invocation.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method !== "POST" || !url.pathname.startsWith(WEBHOOK_PATH_PREFIX)) {
        return new Response("Not found", { status: 404 });
      }
      const providedSecret = extractWebhookSecret(url.pathname, WEBHOOK_PATH_PREFIX);
      if (!isWebhookAuthorized(request, env.WEBHOOK_SECRET, providedSecret)) {
        logEvent("webhook.unauthorized");
        return new Response("Unauthorized", { status: 401 });
      }
      let update: unknown;
      try {
        update = await request.json();
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      // Answer Telegram immediately; the work happens in the background.
      ctx.waitUntil(handleUpdate(env, update));
      return new Response("OK", { status: 200 });
    } catch (err) {
      logEvent("fetch.failed", { error: errorName(err) });
      return new Response("Error", { status: 500 });
    }
  },

  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await handleScheduled(env, controller.scheduledTime);
    } catch (err) {
      logEvent("cron.failed", { error: errorName(err) });
    }
  },

  async queue(batch: MessageBatch<BroadcastMessage>, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await handleQueueBatch(env, batch);
    } catch (err) {
      logEvent("queue.batch_failed", { error: errorName(err) });
    }
  },
} satisfies ExportedHandler<Env, BroadcastMessage>;
