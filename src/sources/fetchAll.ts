import { FETCH_RETRIES, FETCH_TIMEOUT_MS } from "../config";
import { fetchJson } from "../http";
import { logEvent } from "../log";
import type { Candidate, Env, SourceName } from "../types";
import { emptyExtraction, type SourceExtraction } from "./common";
import { extractMegaweb } from "./megaweb";
import { extractNavasan } from "./navasan";
import { extractNerkh } from "./nerkh";
import { extractZipodo } from "./zipodo";

const USER_AGENT = "MarketPing/1.0 (+cloudflare-worker)";

/** USDT-in-Toman helper source order (internal metric, never displayed). */
const USDT_HELPER_ORDER: readonly SourceName[] = ["nerkh", "navasan", "zipodo"];

export interface SourceFetchResult {
  source: SourceName;
  ok: boolean;
  status: number;
  latencyMs: number;
  errorName: string | null;
  attempts: number;
  extraction: SourceExtraction;
}

export interface FetchAllResult {
  results: SourceFetchResult[];
  extractions: SourceExtraction[];
  candidates: Candidate[];
}

export interface UsdtHelper {
  value: number;
  updatedAtEpochSec: number;
  approximate: boolean;
}

interface SourceTask {
  source: SourceName;
  url: string;
  extract: (payload: unknown, fetchedAtEpochSec: number) => SourceExtraction;
}

/** API URLs live here and nowhere else. They contain keys, so they are never logged. */
function buildTasks(env: Env): SourceTask[] {
  return [
    {
      source: "nerkh",
      url: `https://api.nerkh.io/v2/prices/json/all?x-api-key=${env.NERKH_API_KEY}`,
      extract: extractNerkh,
    },
    {
      source: "navasan",
      url: `https://api.navasan.tech/latest/?api_key=${env.NAVASAN_API_KEY}`,
      extract: extractNavasan,
    },
    { source: "megaweb", url: "https://www.megaweb.ir/api/digital-money", extract: extractMegaweb },
    { source: "zipodo", url: "https://api.zipodo.ir/usdt/", extract: extractZipodo },
  ];
}

/**
 * Fetches all four sources in parallel (each with FETCH_TIMEOUT_MS and one retry) and
 * normalises the payloads into Candidate objects. A failing source can never break the
 * cycle: failures come back as ok=false with an error name for the health panel.
 */
export async function fetchAllSources(env: Env, fetchedAtEpochSec: number): Promise<FetchAllResult> {
  const tasks = buildTasks(env);
  const settled = await Promise.allSettled(
    tasks.map(async (task): Promise<SourceFetchResult> => {
      const outcome = await fetchJson<unknown>(task.url, {
        timeoutMs: FETCH_TIMEOUT_MS,
        retries: FETCH_RETRIES,
        headers: { "user-agent": USER_AGENT },
      });
      const extraction =
        outcome.ok && outcome.data !== null
          ? task.extract(outcome.data, fetchedAtEpochSec)
          : emptyExtraction(task.source, outcome.errorName ?? "request failed");
      return {
        source: task.source,
        ok: outcome.ok,
        status: outcome.status,
        latencyMs: outcome.latencyMs,
        errorName: outcome.errorName,
        attempts: outcome.attempts,
        extraction,
      };
    }),
  );

  const results: SourceFetchResult[] = settled.map((entry, index) => {
    const task = tasks[index];
    if (entry.status === "fulfilled") return entry.value;
    logEvent("source.extractor_failed", { source: task.source });
    return {
      source: task.source,
      ok: false,
      status: 0,
      latencyMs: 0,
      errorName: "ExtractorError",
      attempts: 0,
      extraction: emptyExtraction(task.source, "extractor threw"),
    };
  });

  for (const result of results) {
    logEvent("source.fetched", {
      source: result.source,
      ok: result.ok,
      status: result.status,
      ms: result.latencyMs,
      attempts: result.attempts,
      candidates: result.extraction.candidates.length,
      shapeError: result.extraction.shapeError,
    });
  }

  return {
    results,
    extractions: results.map((result) => result.extraction),
    candidates: results.flatMap((result) => result.extraction.candidates),
  };
}

/** Best USDT-in-Toman helper: nerkh -> navasan -> zipodo (as agreed for the sanity guard). */
export function pickUsdtHelper(extractions: readonly SourceExtraction[]): UsdtHelper | null {
  for (const source of USDT_HELPER_ORDER) {
    const found = extractions.find((extraction) => extraction.source === source);
    if (found && found.usdtToman !== null && found.usdtToman > 0) {
      return {
        value: found.usdtToman,
        updatedAtEpochSec: found.usdtUpdatedAtEpochSec ?? 0,
        approximate: found.usdtApproximate,
      };
    }
  }
  return null;
}
