import { describe, expect, it } from "vitest";
import { METRIC_LABELS } from "../src/labels";
import { countDisplayLines, countNonEmptyLines, renderMessage } from "../src/render/message";
import { resolveMetrics } from "../src/resolve/resolver";
import type { ResolvedMetrics, SnapshotData, SourceName } from "../src/types";
import { allCandidates, FIXTURE_NOW, FIXTURE_STALE_USD_SELL_AT } from "./fixtures";

function fixtureMetrics(): ResolvedMetrics {
  return resolveMetrics(allCandidates(), {}, 249601, FIXTURE_NOW).metrics;
}

function snapshot(metrics: ResolvedMetrics, sources: SourceName[] = ["nerkh", "megaweb"]): SnapshotData {
  return { hourKey: "2026-09-29-10", createdAt: FIXTURE_NOW, metrics, sources };
}

function preBlocks(message: string): string[][] {
  const blocks: string[][] = [];
  const regex = /<pre>([\s\S]*?)<\/pre>/g;
  let match: RegExpExecArray | null = regex.exec(message);
  while (match !== null) {
    blocks.push((match[1] ?? "").split("\n"));
    match = regex.exec(message);
  }
  return blocks;
}

function allowedTagsOnly(message: string): boolean {
  const allowed = new Set(["<b>", "</b>", "<i>", "</i>", "<pre>", "</pre>", "<blockquote>", "</blockquote>"]);
  const tags = message.match(/<\/?[a-zA-Z]+>/g) ?? [];
  return tags.every((tag) => allowed.has(tag));
}

describe("renderMessage", () => {
  it("renders the documented skeleton with right-aligned columns", () => {
    const message = renderMessage(snapshot(fixtureMetrics()));
    expect(message).toContain("📈 <b>Market Ping</b>");
    expect(message).toContain("3Shanbe, 7 Mehr 1405 | 10:34");
    expect(message).toContain("💱 <b>Currency</b>");
    expect(message).toContain("🥇 <b>Gold &amp; Coins</b>");
    expect(message).toContain("₿ <b>Crypto</b>");
    expect(message).not.toContain("T = Toman");
    expect(allowedTagsOnly(message)).toBe(true);

    const blocks = preBlocks(message);
    expect(blocks).toHaveLength(3);
    for (const lines of blocks) {
      const widths = new Set(lines.filter((line) => line.length > 0).map((line) => line.length));
      expect(widths.size).toBe(1);
    }
    expect(blocks[0]).toHaveLength(1);
    expect(blocks[0][0].trimEnd().endsWith("244,800 T")).toBe(true);
    // Gold & Coins: three groups separated by two truly empty lines, one width for all rows.
    expect(blocks[1]).toHaveLength(8);
    expect(blocks[1][1]).toBe("");
    expect(blocks[1][3]).toBe("");
    expect(blocks[1][0].trimEnd().endsWith("$4,142")).toBe(true);
    expect(blocks[1][2].trimEnd().endsWith("24,835,000 T")).toBe(true);
    expect(blocks[2]).toHaveLength(1);
    expect(blocks[2][0].trimEnd().endsWith("$83,989")).toBe(true);
  });

  it("prints N/A without breaking the column widths", () => {
    const metrics = fixtureMetrics();
    metrics.usd_toman = { metric: "usd_toman", value: null, source: null, updatedAtEpochSec: null, stale: false, approximate: false };
    const message = renderMessage(snapshot(metrics, ["nerkh"]));
    expect(message).toContain("N/A");
    const blocks = preBlocks(message);
    for (const lines of blocks) {
      expect(new Set(lines.filter((line) => line.length > 0).map((line) => line.length)).size).toBe(1);
    }
  });

  it("marks a stale value with * and adds the exact footnote from the spec", () => {
    const metrics = fixtureMetrics();
    metrics.usd_toman = {
      metric: "usd_toman",
      value: 244000,
      source: "navasan",
      updatedAtEpochSec: FIXTURE_STALE_USD_SELL_AT,
      stale: true,
      approximate: false,
    };
    const message = renderMessage(snapshot(metrics, ["nerkh", "navasan", "megaweb"]));
    expect(message).toContain("244,000 T*");
    expect(message).toContain("* USD: last update 6 Mehr 1405 20:58");
    expect(countDisplayLines(message)).toBe(21);
    expect(countNonEmptyLines(message)).toBe(14);
  });

  it("marks the approximate value with ~ and adds the USDT footnote", () => {
    const metrics = fixtureMetrics();
    metrics.usd_toman = {
      metric: "usd_toman",
      value: 249950,
      source: "zipodo",
      updatedAtEpochSec: FIXTURE_NOW,
      stale: false,
      approximate: true,
    };
    const message = renderMessage(snapshot(metrics, ["zipodo", "megaweb"]));
    expect(message).toContain("~249,950 T");
    expect(message).toContain("~ via USDT rate");
    expect(countDisplayLines(message)).toBe(21);
  });

  it("keeps the message inside the agreed budget (2 footnotes, 26 display lines)", () => {
    const metrics = fixtureMetrics();
    metrics.usd_toman = {
      metric: "usd_toman",
      value: 249950,
      source: "zipodo",
      updatedAtEpochSec: FIXTURE_NOW,
      stale: false,
      approximate: true,
    };
    for (const metric of ["gold18_toman", "coin_emami_toman", "coin_quarter_toman"] as const) {
      metrics[metric] = { ...metrics[metric], stale: true, updatedAtEpochSec: FIXTURE_NOW - 9000 };
    }
    const message = renderMessage(snapshot(metrics, ["nerkh", "zipodo", "megaweb"]));
    expect(message).toContain("* Stale: ");
    expect(message).toContain("+1 more");
    expect(message).toContain("~ via USDT rate");
    expect(countDisplayLines(message)).toBeLessThanOrEqual(26);
    expect(countNonEmptyLines(message)).toBeLessThanOrEqual(19);
  });

  it("has no source footer at all, even when sources were used", () => {
    const message = renderMessage(snapshot(fixtureMetrics(), ["nerkh", "megaweb"]));
    expect(message).not.toContain("T = Toman");
    expect(message).not.toContain("Source:");
    expect(message).not.toContain("<i>");
  });

  it("keeps the base message at 13 non-empty lines", () => {
    const message = renderMessage(snapshot(fixtureMetrics()));
    expect(countNonEmptyLines(message)).toBe(13);
    expect(countDisplayLines(message)).toBe(20);
  });
});

describe("shared label order in the message", () => {
  const expectOrder = (lines: string[], labels: string[]): void => {
    labels.forEach((label, index) => {
      expect(lines[index]?.startsWith(label + " "), "row " + index + " of " + labels.join(",")).toBe(true);
    });
  };

  it("renders every category in CATEGORY_ORDER with the agreed row order", () => {
    const message = renderMessage(snapshot(fixtureMetrics()));
    expect(message.indexOf("💱 <b>Currency</b>")).toBeLessThan(message.indexOf("🥇 <b>Gold &amp; Coins</b>"));
    expect(message.indexOf("🥇 <b>Gold &amp; Coins</b>")).toBeLessThan(message.indexOf("₿ <b>Crypto</b>"));
    const blocks = preBlocks(message);
    expect(blocks).toHaveLength(3);
    expectOrder(blocks[0], ["USD"]);
    expectOrder(blocks[1].filter((line) => line.length > 0), ["Gold Ounce", "Tala Garam", "Rob Seke", "Nim Seke", "Tamam Seke", "Emami"]);
    expectOrder(blocks[2], ["Bitcoin"]);
    expect(METRIC_LABELS.map((row) => row.label)).toEqual([
      "USD",
      "Bitcoin",
      "Gold Ounce",
      "Tala Garam",
      "Rob Seke",
      "Nim Seke",
      "Tamam Seke",
      "Emami",
    ]);
  });

  it("renders N/A, stale and approximate values with the shared labels", () => {
    const metrics = fixtureMetrics();
    metrics.coin_emami_toman = { metric: "coin_emami_toman", value: null, source: null, updatedAtEpochSec: null, stale: false, approximate: false };
    metrics.btc_usd = { metric: "btc_usd", value: 83989, source: "megaweb", updatedAtEpochSec: FIXTURE_STALE_USD_SELL_AT, stale: true, approximate: false };
    metrics.usd_toman = { metric: "usd_toman", value: 249950, source: "zipodo", updatedAtEpochSec: FIXTURE_NOW, stale: false, approximate: true };
    const message = renderMessage(snapshot(metrics, ["nerkh", "navasan", "megaweb", "zipodo"]));
    expect(message).toContain("Emami");
    expect(message).toContain("N/A");
    expect(message).toContain("$83,989*");
    expect(message).toContain("* Bitcoin: last update 6 Mehr 1405 20:58");
    expect(message).toContain("~249,950 T");
    expect(message).toContain("~ via USDT rate");
    expect(countDisplayLines(message)).toBeLessThanOrEqual(26);
    expect(countNonEmptyLines(message)).toBeLessThanOrEqual(19);
  });
});
