import { METRIC_NAMES, SOURCE_NAMES } from "../types";
import type { MetricName, SourceName } from "../types";

export interface LastGoodValue {
  metric: MetricName;
  value: number;
  source: SourceName;
  updatedAtEpochSec: number;
  approximate: boolean;
}

/** Sparse map: metrics we have never resolved are simply absent. */
export type LastGoodMap = Partial<Record<MetricName, LastGoodValue>>;

interface LastGoodRow {
  metric: string;
  value: number;
  source: string;
  updated_at: number;
  approximate: number;
}

const METRIC_SET: ReadonlySet<string> = new Set<string>(METRIC_NAMES);
const SOURCE_SET: ReadonlySet<string> = new Set<string>(SOURCE_NAMES);

const UPSERT_SQL =
  "INSERT INTO last_good (metric, value, source, updated_at, approximate)\n" +
  "VALUES (?1, ?2, ?3, ?4, ?5)\n" +
  "ON CONFLICT(metric) DO UPDATE SET\n" +
  "  value = excluded.value,\n" +
  "  source = excluded.source,\n" +
  "  updated_at = excluded.updated_at,\n" +
  "  approximate = excluded.approximate";

export async function getLastGood(db: D1Database): Promise<LastGoodMap> {
  const result = await db
    .prepare("SELECT metric, value, source, updated_at, approximate FROM last_good")
    .all<LastGoodRow>();
  const map: LastGoodMap = {};
  for (const row of result.results ?? []) {
    if (!METRIC_SET.has(row.metric) || !SOURCE_SET.has(row.source)) continue;
    const metric = row.metric as MetricName;
    map[metric] = {
      metric,
      value: Number(row.value),
      source: row.source as SourceName,
      updatedAtEpochSec: Number(row.updated_at),
      approximate: Number(row.approximate) === 1,
    };
  }
  return map;
}

/** Persists the fresh selections of one cycle in a single batched statement set. */
export async function saveLastGood(db: D1Database, updates: readonly LastGoodValue[]): Promise<void> {
  if (updates.length === 0) return;
  const statements = updates.map((update) =>
    db
      .prepare(UPSERT_SQL)
      .bind(update.metric, update.value, update.source, update.updatedAtEpochSec, update.approximate ? 1 : 0),
  );
  await db.batch(statements);
}
