import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHealthPanel } from "../src/admin/health";
import { resolveMetrics } from "../src/resolve/resolver";
import { fetchAllSources, pickUsdtHelper } from "../src/sources/fetchAll";
import type { BroadcastMessage, Env } from "../src/types";
import { FIXTURE_NOW, rawFixtures } from "./fixtures";

const env: Env = {
  NERKH_API_KEY: "test-nerkh-key",
  NAVASAN_API_KEY: "test-navasan-key",
  DB: {} as D1Database,
  BROADCAST_QUEUE: {} as Queue<BroadcastMessage>,
  TELEGRAM_BOT_TOKEN: "test-token",
  WEBHOOK_SECRET: "test-secret",
  ADMIN_IDS: "1",
};

type Route = "nerkh" | "navasan" | "megaweb" | "zipodo";

const HOST_MATCH: Record<Route, string> = {
  nerkh: "api.nerkh.io",
  navasan: "api.navasan.tech",
  megaweb: "www.megaweb.ir",
  zipodo: "api.zipodo.ir",
};

/** Host names are compared, so the API keys in the URLs never reach a test message. */
function stubSources(handlers: Partial<Record<Route, () => Response>>): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const route of Object.keys(HOST_MATCH) as Route[]) {
      if (url.includes(HOST_MATCH[route])) {
        const handler = handlers[route];
        if (handler) return handler();
        throw new TypeError("fetch failed");
      }
    }
    throw new TypeError("unexpected target");
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function connectionReset(): never {
  throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
}

function aborted(): never {
  const error = new Error("aborted");
  error.name = "AbortError";
  throw error;
}

const healthy: Record<Route, () => Response> = {
  nerkh: () => jsonResponse(rawFixtures.nerkh),
  navasan: () => jsonResponse(rawFixtures.navasan),
  megaweb: () => jsonResponse(rawFixtures.megaweb),
  zipodo: () => jsonResponse(rawFixtures.zipodo),
};

function helperValue(extractions: Awaited<ReturnType<typeof fetchAllSources>>["extractions"]): number | null {
  const helper = pickUsdtHelper(extractions);
  return helper ? helper.value : null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAllSources", () => {
  it("fetches all four sources and returns the health panel data", async () => {
    stubSources(healthy);
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    expect(fetched.results).toHaveLength(4);
    expect(fetched.results.every((result) => result.ok)).toBe(true);
    expect(fetched.candidates).toHaveLength(18);

    const resolved = resolveMetrics(fetched.candidates, {}, 249601, FIXTURE_NOW);
    const panel = renderHealthPanel(FIXTURE_NOW, fetched, resolved.metrics, resolved.warnings);
    expect(panel).toContain("API health");
    expect(panel).toContain("USD per source");
    expect(panel).toContain("spread");
    expect(panel).toContain("nerkh");
    expect(panel).toContain("zipodo");
  });

  it("handles a Zipodo connection reset and falls through to the next candidate", async () => {
    stubSources({ ...healthy, zipodo: connectionReset });
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    const zipodo = fetched.results.find((result) => result.source === "zipodo");
    expect(zipodo?.ok).toBe(false);
    expect(zipodo?.status).toBe(0);
    expect(zipodo?.errorName).toContain("ECONNRESET");
    expect(zipodo?.attempts).toBe(2);
    expect(zipodo?.extraction.candidates).toHaveLength(0);

    const resolved = resolveMetrics(fetched.candidates, {}, helperValue(fetched.extractions), FIXTURE_NOW);
    expect(resolved.metrics.usd_toman.source).toBe("nerkh");
    expect(resolved.metrics.usd_toman.value).toBe(244800);
    expect(resolved.metrics.usd_toman.approximate).toBe(false);
    expect(resolved.metrics.usd_toman.stale).toBe(false);
  });

  it("reports a timeout as Timeout", async () => {
    stubSources({ ...healthy, zipodo: aborted });
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    const zipodo = fetched.results.find((result) => result.source === "zipodo");
    expect(zipodo?.ok).toBe(false);
    expect(zipodo?.errorName).toBe("Timeout");
  });

  it("handles a non-JSON body without retrying", async () => {
    stubSources({ ...healthy, zipodo: () => new Response("<html>blocked by CDN</html>", { status: 200 }) });
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    const zipodo = fetched.results.find((result) => result.source === "zipodo");
    expect(zipodo?.ok).toBe(false);
    expect(zipodo?.errorName).toBe("InvalidJson");
    expect(zipodo?.attempts).toBe(1);
  });

  it("does not retry a 403 (protects the 50 subrequest budget)", async () => {
    stubSources({ ...healthy, nerkh: () => new Response("forbidden", { status: 403 }) });
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    const nerkh = fetched.results.find((result) => result.source === "nerkh");
    expect(nerkh?.ok).toBe(false);
    expect(nerkh?.status).toBe(403);
    expect(nerkh?.attempts).toBe(1);
  });
});

describe("degradation with no usable usd_toman candidate", () => {
  const allDown = {
    nerkh: connectionReset,
    navasan: connectionReset,
    megaweb: connectionReset,
    zipodo: connectionReset,
  } as Partial<Record<Route, () => Response>>;

  it("yields N/A for every metric when every source fails and last_good is empty", async () => {
    stubSources(allDown);
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    const resolved = resolveMetrics(fetched.candidates, {}, null, FIXTURE_NOW);
    expect(resolved.metrics.usd_toman.value).toBeNull();
    expect(resolved.metrics.usd_toman.source).toBeNull();
    expect(resolved.metrics.btc_usd.value).toBeNull();
    expect(resolved.lastGoodUpdates).toHaveLength(0);
    expect(resolved.usedSources).toHaveLength(0);
  });

  it("falls back to the STALE last_good value when a JSON body lacks price", async () => {
    stubSources({ ...allDown, zipodo: () => jsonResponse({}) });
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    const zipodo = fetched.results.find((result) => result.source === "zipodo");
    expect(zipodo?.ok).toBe(true);
    expect(zipodo?.extraction.shapeError).toBe("missing price");

    const lastGood = {
      usd_toman: {
        metric: "usd_toman" as const,
        value: 243500,
        source: "nerkh" as const,
        updatedAtEpochSec: FIXTURE_NOW - 7200,
        approximate: false,
      },
    };
    const resolved = resolveMetrics(fetched.candidates, lastGood, null, FIXTURE_NOW);
    expect(resolved.metrics.usd_toman.value).toBe(243500);
    expect(resolved.metrics.usd_toman.source).toBe("nerkh");
    expect(resolved.metrics.usd_toman.stale).toBe(true);
    expect(resolved.metrics.usd_toman.updatedAtEpochSec).toBe(FIXTURE_NOW - 7200);
    expect(resolved.lastGoodUpdates).toHaveLength(0);
  });
});

describe("pickUsdtHelper", () => {
  it("prefers nerkh, then navasan, then the approximate zipodo value", async () => {
    stubSources(healthy);
    const all = await fetchAllSources(env, FIXTURE_NOW);
    // 1790665345 == 2026-09-29T07:02:25Z, the nerkh crypto.USDT update instant
    expect(pickUsdtHelper(all.extractions)).toEqual({ value: 249601, updatedAtEpochSec: 1790665345, approximate: false });
  });

  it("uses navasan when nerkh is unavailable", async () => {
    stubSources({ ...healthy, nerkh: connectionReset });
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    const helper = pickUsdtHelper(fetched.extractions);
    expect(helper?.value).toBe(249400);
    expect(helper?.approximate).toBe(false);
  });

  it("uses the approximate zipodo value as the last resort", async () => {
    stubSources({ ...healthy, nerkh: connectionReset, navasan: connectionReset });
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    const helper = pickUsdtHelper(fetched.extractions);
    expect(helper?.value).toBe(249950);
    expect(helper?.approximate).toBe(true);
  });
});
