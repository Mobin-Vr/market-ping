export type BroadcastStatus = "pending" | "done" | "skipped";

export interface BroadcastLogRow {
  hour_key: string;
  started_at: number;
  total: number;
  sent: number;
  blocked: number;
  failed: number;
  status: string;
}

export interface BroadcastCounters {
  sent?: number;
  blocked?: number;
  failed?: number;
}

const LOG_COLUMNS = "hour_key, started_at, total, sent, blocked, failed, status";

function asMeta(value: unknown): { changes?: number } {
  return (value ?? {}) as { changes?: number };
}

/**
 * Claims one broadcast. Returns false when the hour (or the manual key) was already
 * claimed, which makes the cron run idempotent.
 */
export async function claimBroadcast(
  db: D1Database,
  hourKey: string,
  startedAt: number,
  total: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      "INSERT OR IGNORE INTO broadcast_log (hour_key, started_at, total, status) VALUES (?1, ?2, ?3, 'pending')",
    )
    .bind(hourKey, startedAt, total)
    .run();
  return Number(asMeta(result.meta).changes ?? 0) > 0;
}

/**
 * Atomic counter increments. The same statement flips the row to 'done' as soon as every
 * subscriber of that broadcast has been accounted for (sent + blocked + failed >= total).
 * SQL evaluates every SET expression against the pre-update values, so the CASE sees the
 * old counters.
 */
export async function addCounters(
  db: D1Database,
  hourKey: string,
  counters: BroadcastCounters,
): Promise<void> {
  const sent = counters.sent ?? 0;
  const blocked = counters.blocked ?? 0;
  const failed = counters.failed ?? 0;
  if (sent === 0 && blocked === 0 && failed === 0) return;
  await db
    .prepare(
      "UPDATE broadcast_log " +
        "SET sent = sent + ?2, blocked = blocked + ?3, failed = failed + ?4, " +
        "status = CASE WHEN status = 'pending' AND sent + blocked + failed + ?2 + ?3 + ?4 >= total " +
        "THEN 'done' ELSE status END " +
        "WHERE hour_key = ?1",
    )
    .bind(hourKey, sent, blocked, failed)
    .run();
}

export async function setBroadcastStatus(
  db: D1Database,
  hourKey: string,
  status: BroadcastStatus,
): Promise<void> {
  await db
    .prepare("UPDATE broadcast_log SET status = ?2 WHERE hour_key = ?1")
    .bind(hourKey, status)
    .run();
}

/** Newest broadcast by start time, hourly or manual. */
export async function getLatestBroadcast(db: D1Database): Promise<BroadcastLogRow | null> {
  return (
    (await db
      .prepare(`SELECT ${LOG_COLUMNS} FROM broadcast_log ORDER BY started_at DESC LIMIT 1`)
      .first<BroadcastLogRow>()) ?? null
  );
}
