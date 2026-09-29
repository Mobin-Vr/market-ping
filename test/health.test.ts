import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHealthPanel } from "../src/admin/health";
import { METRIC_LABELS } from "../src/labels";
import { resolveMetrics } from "../src/resolve/resolver";
import { fetchAllSources } from "../src/sources/fetchAll";
import type { BroadcastMessage, Env } from "../src/types";
import { FIXTURE_NOW, rawFixtures } from "./fixtures";

const EXPECTED_LABELS = [
  "USD",
  "Bitcoin",
  "Gold Ounce",
  "Tala Garam",
  "Rob Seke",
  "Nim Seke",
  "Tamam Seke",
  "Emami",
];

const EXPECTED_METRICS = [
  "usd_toman",
  "btc_usd",
  "ounce_usd",
  "gold18_toman",
  "coin_quarter_toman",
  "coin_half_toman",
  "coin_bahar_toman",
  "coin_emami_toman",
] as const;

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

/** Serves the committed fixtures; hosts are matched so keys never reach a message. */
function stubHealthy(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = (Object.keys(HOST_MATCH) as Route[]).find((key) => url.includes(HOST_MATCH[key]));
    if (!route) throw new TypeError("unexpected target");
    return new Response(JSON.stringify(rawFixtures[route]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admin health panel: resolved block", () => {
  it("defines the labels and row order once, in a reusable constant", () => {
    expect(METRIC_LABELS.map((row) => row.label)).toEqual(EXPECTED_LABELS);
    expect(METRIC_LABELS.map((row) => row.metric)).toEqual([...EXPECTED_METRICS]);
  });

  it("renders every row in that order with units and sources", async () => {
    stubHealthy();
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    const resolved = resolveMetrics(fetched.candidates, {}, 249601, FIXTURE_NOW);
    const panel = renderHealthPanel(FIXTURE_NOW, fetched, resolved.metrics, resolved.warnings);
    const section = panel.slice(panel.indexOf("<b>Resolved</b>"));

    let cursor = -1;
    for (const label of EXPECTED_LABELS) {
      const at = section.indexOf(label + " ", cursor + 1);
      expect(at, "missing or misordered label: " + label).toBeGreaterThan(cursor);
      cursor = at;
    }

    expect(panel).not.toContain("18K");
    expect(section).not.toContain("nim Seke");

    expect(section).toContain("244,800 T");
    expect(section).toContain("$83,989");
    expect(section).toContain("$4,142");
    expect(section).toContain("24,835,000 T");
    expect(section).toContain("68,500,000 T");
    expect(section).toContain("127,800,000 T");
    expect(section).toContain("243,500,000 T");
    expect(section).toContain("250,100,000 T");
    expect(section).toContain("nerkh");
  });

  it("keeps the right-aligned five-column layout inside <pre>", async () => {
    stubHealthy();
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    const resolved = resolveMetrics(fetched.candidates, {}, 249601, FIXTURE_NOW);
    const panel = renderHealthPanel(FIXTURE_NOW, fetched, resolved.metrics, resolved.warnings);
    const section = panel.slice(panel.indexOf("<b>Resolved</b>"));
    const match = /<pre>([\s\S]*?)<\/pre>/.exec(section);
    const lines = (match === null ? "" : (match[1] ?? "")).split("\n");
    expect(lines).toHaveLength(8);
    const rows: Array<[string, string, string]> = [
      ["USD", "244,800 T", "nerkh"],
      ["Bitcoin", "$83,989", "megaweb"],
      ["Gold Ounce", "$4,142", "nerkh"],
      ["Tala Garam", "24,835,000 T", "nerkh"],
      ["Rob Seke", "68,500,000 T", "nerkh"],
      ["Nim Seke", "127,800,000 T", "nerkh"],
      ["Tamam Seke", "243,500,000 T", "nerkh"],
      ["Emami", "250,100,000 T", "nerkh"],
    ];
    rows.forEach(([label, value, source], index) => {
      const line = lines[index] ?? "";
      expect(line.slice(0, 14), "label column").toBe(label.padEnd(14));
      expect(line.slice(15, 31), "right-aligned value column").toBe(value.padStart(16));
      expect(line.slice(32), "source column").toBe(source);
    });
  });

  it("still renders the stale and approximate markers in the panel", async () => {
    stubHealthy();
    const fetched = await fetchAllSources(env, FIXTURE_NOW);
    const resolved = resolveMetrics(fetched.candidates, {}, 249601, FIXTURE_NOW);
    const metrics = { ...resolved.metrics };
    metrics.usd_toman = {
      metric: "usd_toman",
      value: 249950,
      source: "zipodo",
      updatedAtEpochSec: FIXTURE_NOW,
      stale: true,
      approximate: true,
    };
    const panel = renderHealthPanel(FIXTURE_NOW, fetched, metrics, resolved.warnings);
    const section = panel.slice(panel.indexOf("<b>Resolved</b>"));
    expect(section).toContain("~249,950 T*");
  });
});
