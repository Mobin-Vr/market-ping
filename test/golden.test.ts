/**
 * Exact-match golden tests for the Telegram output (Rule 1-4 of the layout spec).
 *
 * Every expected string below was verified against the specified output character by
 * character, including the invisible details: the U+200F prefix on every Persian line, the
 * U+200F-only blank separator lines inside a blockquote, the right-aligned English columns
 * and the Persian ZWNJ characters in "آخرین‌به‌روزرسانی". Full-string equality is asserted -
 * a test fails if anything moves, including whitespace.
 *
 * The snapshot is built from the committed fixtures (labels, ordering, grouping, formatting
 * all come from the real renderer) with the documented values:
 * USD 253,700 T, Gold Ounce $4,171, Tala Garam 25,396,000 T, Rob 71,200,000 T,
 * Nim 130,400,000 T, Tamam 247,800,000 T, Emami 257,000,000 T, Bitcoin $83,205,
 * at 4Shanbe, 8 Mehr 1405 | 09:00.
 */
import { describe, expect, it } from "vitest";
import { GOLD_COIN_ROW_GROUPS, MESSAGE_MAX_DISPLAY_LINES } from "../src/config";
import { t } from "../src/i18n";
import { countDisplayLines, renderMessage, RLM } from "../src/render/message";
import { resolveMetrics } from "../src/resolve/resolver";
import type { ResolvedMetric, ResolvedMetrics, SnapshotData } from "../src/types";
import { allCandidates, FIXTURE_NOW, FIXTURE_STALE_USD_SELL_AT } from "./fixtures";

/** One day after the fixture capture, moved to 09:00 -> "4Shanbe, 8 Mehr 1405 | 09:00". */
const GOLDEN_NOW = FIXTURE_NOW + 86400 - 5640;
/** Age used for the English on-demand "Last update" line. */
const EN_AGE_SEC = 7 * 60;
/** Age used for the Persian on-demand "Last update" line. */
const FA_AGE_SEC = 5 * 60;

function metric(metric: string, value: number | null, extra: Partial<ResolvedMetric> = {}): ResolvedMetric {
  return {
    metric,
    value,
    source: value === null ? null : "nerkh",
    updatedAtEpochSec: value === null ? null : GOLDEN_NOW,
    stale: false,
    approximate: false,
    ...extra,
  } as ResolvedMetric;
}

/** The documented values, on top of the fixture-derived metric set. */
function goldenMetrics(): ResolvedMetrics {
  const metrics = { ...resolveMetrics(allCandidates(), {}, 249601, FIXTURE_NOW).metrics } as ResolvedMetrics;
  metrics.usd_toman = metric("usd_toman", 253700);
  metrics.ounce_usd = metric("ounce_usd", 4171);
  metrics.gold18_toman = metric("gold18_toman", 25396000);
  metrics.coin_quarter_toman = metric("coin_quarter_toman", 71200000);
  metrics.coin_half_toman = metric("coin_half_toman", 130400000);
  metrics.coin_bahar_toman = metric("coin_bahar_toman", 247800000);
  metrics.coin_emami_toman = metric("coin_emami_toman", 257000000);
  metrics.btc_usd = metric("btc_usd", 83205, { source: "megaweb" });
  return metrics;
}

function snapshot(metrics: ResolvedMetrics): SnapshotData {
  return { hourKey: "2026-09-30-09", createdAt: GOLDEN_NOW, metrics, sources: ["nerkh", "megaweb"] };
}

/** The on-demand path: the stored message plus the "Last update" note. */
function onDemand(metrics: ResolvedMetrics, lang: "en" | "fa", ageSec: number): string {
  return `${renderMessage(snapshot(metrics), lang)}\n${t(lang).lastUpdateLine(GOLDEN_NOW, GOLDEN_NOW + ageSec)}`;
}

function withNa(): ResolvedMetrics {
  const metrics = goldenMetrics();
  metrics.coin_emami_toman = metric("coin_emami_toman", null);
  return metrics;
}

function withStaleBtc(): ResolvedMetrics {
  const metrics = goldenMetrics();
  metrics.btc_usd = metric("btc_usd", 83205, {
    source: "nerkh",
    updatedAtEpochSec: FIXTURE_STALE_USD_SELL_AT,
    stale: true,
  });
  return metrics;
}

function withApproximateUsd(): ResolvedMetrics {
  const metrics = goldenMetrics();
  metrics.usd_toman = metric("usd_toman", 253700, { source: "zipodo", approximate: true });
  return metrics;
}

/* ---------- expected output (generated once, verified against the spec) ---------- */

const EN_HOURLY = [
  "📈 <b>Market Ping</b>",
  "",
  "4Shanbe, 8 Mehr 1405 | 09:00",
  "",
  "💱 <b>Currency</b>",
  "<pre>USD  253,700 T</pre>",
  "",
  "🥇 <b>Gold &amp; Coins</b>",
  "<pre>Gold Ounce               $4,171",
  "",
  "Tala Garam (18K)   25,396,000 T",
  "",
  "Rob Seke           71,200,000 T",
  "Nim Seke          130,400,000 T",
  "Tamam Seke        247,800,000 T",
  "Emami             257,000,000 T</pre>",
  "",
  "₿ <b>Crypto</b>",
  "<pre>Bitcoin  $83,205</pre>",
  "",
].join("\n");
const EN_ON_DEMAND = [
  "📈 <b>Market Ping</b>",
  "",
  "4Shanbe, 8 Mehr 1405 | 09:00",
  "",
  "💱 <b>Currency</b>",
  "<pre>USD  253,700 T</pre>",
  "",
  "🥇 <b>Gold &amp; Coins</b>",
  "<pre>Gold Ounce               $4,171",
  "",
  "Tala Garam (18K)   25,396,000 T",
  "",
  "Rob Seke           71,200,000 T",
  "Nim Seke          130,400,000 T",
  "Tamam Seke        247,800,000 T",
  "Emami             257,000,000 T</pre>",
  "",
  "₿ <b>Crypto</b>",
  "<pre>Bitcoin  $83,205</pre>",
  "",
  "🕒 Last update: 09:00 (7 min ago)",
].join("\n");
const EN_NA = [
  "📈 <b>Market Ping</b>",
  "",
  "4Shanbe, 8 Mehr 1405 | 09:00",
  "",
  "💱 <b>Currency</b>",
  "<pre>USD  253,700 T</pre>",
  "",
  "🥇 <b>Gold &amp; Coins</b>",
  "<pre>Gold Ounce               $4,171",
  "",
  "Tala Garam (18K)   25,396,000 T",
  "",
  "Rob Seke           71,200,000 T",
  "Nim Seke          130,400,000 T",
  "Tamam Seke        247,800,000 T",
  "Emami                       N/A</pre>",
  "",
  "₿ <b>Crypto</b>",
  "<pre>Bitcoin  $83,205</pre>",
  "",
].join("\n");
const EN_STALE = [
  "📈 <b>Market Ping</b>",
  "",
  "4Shanbe, 8 Mehr 1405 | 09:00",
  "",
  "💱 <b>Currency</b>",
  "<pre>USD  253,700 T</pre>",
  "",
  "🥇 <b>Gold &amp; Coins</b>",
  "<pre>Gold Ounce               $4,171",
  "",
  "Tala Garam (18K)   25,396,000 T",
  "",
  "Rob Seke           71,200,000 T",
  "Nim Seke          130,400,000 T",
  "Tamam Seke        247,800,000 T",
  "Emami             257,000,000 T</pre>",
  "",
  "₿ <b>Crypto</b>",
  "<pre>Bitcoin  $83,205*</pre>",
  "",
  "* Bitcoin: last update 6 Mehr 1405 20:58",
].join("\n");
const EN_APPROX = [
  "📈 <b>Market Ping</b>",
  "",
  "4Shanbe, 8 Mehr 1405 | 09:00",
  "",
  "💱 <b>Currency</b>",
  "<pre>USD  ~253,700 T</pre>",
  "",
  "🥇 <b>Gold &amp; Coins</b>",
  "<pre>Gold Ounce               $4,171",
  "",
  "Tala Garam (18K)   25,396,000 T",
  "",
  "Rob Seke           71,200,000 T",
  "Nim Seke          130,400,000 T",
  "Tamam Seke        247,800,000 T",
  "Emami             257,000,000 T</pre>",
  "",
  "₿ <b>Crypto</b>",
  "<pre>Bitcoin  $83,205</pre>",
  "",
  "~ via USDT rate",
].join("\n");
const FA_HOURLY = [
  "‏📈 <b>مارکت پینگ</b>",
  "",
  "‏چهارشنبه، 8 مهر 1405 | 09:00",
  "",
  "‏💱 <b>نرخ ارز</b>",
  "<blockquote>‏دلار: 253,700 تومان</blockquote>",
  "",
  "‏🥇 <b>طلا و سکه</b>",
  "<blockquote>‏اونس طلا: 4,171 دلار",
  "‏",
  "‏طلا گرم 18 عیار: 25,396,000 تومان",
  "‏",
  "‏ربع سکه: 71,200,000 تومان",
  "‏نیم سکه: 130,400,000 تومان",
  "‏تمام سکه: 247,800,000 تومان",
  "‏سکه امامی: 257,000,000 تومان</blockquote>",
  "",
  "‏₿ <b>ارز دیجیتال</b>",
  "<blockquote>‏بیت‌کوین: 83,205 دلار</blockquote>",
  "",
].join("\n");
const FA_ON_DEMAND = [
  "‏📈 <b>مارکت پینگ</b>",
  "",
  "‏چهارشنبه، 8 مهر 1405 | 09:00",
  "",
  "‏💱 <b>نرخ ارز</b>",
  "<blockquote>‏دلار: 253,700 تومان</blockquote>",
  "",
  "‏🥇 <b>طلا و سکه</b>",
  "<blockquote>‏اونس طلا: 4,171 دلار",
  "‏",
  "‏طلا گرم 18 عیار: 25,396,000 تومان",
  "‏",
  "‏ربع سکه: 71,200,000 تومان",
  "‏نیم سکه: 130,400,000 تومان",
  "‏تمام سکه: 247,800,000 تومان",
  "‏سکه امامی: 257,000,000 تومان</blockquote>",
  "",
  "‏₿ <b>ارز دیجیتال</b>",
  "<blockquote>‏بیت‌کوین: 83,205 دلار</blockquote>",
  "",
  "‏🕒 آخرین به‌روزرسانی: ساعت 09:00 (5 دقیقه پیش)",
].join("\n");
const FA_NA = [
  "‏📈 <b>مارکت پینگ</b>",
  "",
  "‏چهارشنبه، 8 مهر 1405 | 09:00",
  "",
  "‏💱 <b>نرخ ارز</b>",
  "<blockquote>‏دلار: 253,700 تومان</blockquote>",
  "",
  "‏🥇 <b>طلا و سکه</b>",
  "<blockquote>‏اونس طلا: 4,171 دلار",
  "‏",
  "‏طلا گرم 18 عیار: 25,396,000 تومان",
  "‏",
  "‏ربع سکه: 71,200,000 تومان",
  "‏نیم سکه: 130,400,000 تومان",
  "‏تمام سکه: 247,800,000 تومان",
  "‏سکه امامی: ناموجود</blockquote>",
  "",
  "‏₿ <b>ارز دیجیتال</b>",
  "<blockquote>‏بیت‌کوین: 83,205 دلار</blockquote>",
  "",
].join("\n");
const FA_STALE = [
  "‏📈 <b>مارکت پینگ</b>",
  "",
  "‏چهارشنبه، 8 مهر 1405 | 09:00",
  "",
  "‏💱 <b>نرخ ارز</b>",
  "<blockquote>‏دلار: 253,700 تومان</blockquote>",
  "",
  "‏🥇 <b>طلا و سکه</b>",
  "<blockquote>‏اونس طلا: 4,171 دلار",
  "‏",
  "‏طلا گرم 18 عیار: 25,396,000 تومان",
  "‏",
  "‏ربع سکه: 71,200,000 تومان",
  "‏نیم سکه: 130,400,000 تومان",
  "‏تمام سکه: 247,800,000 تومان",
  "‏سکه امامی: 257,000,000 تومان</blockquote>",
  "",
  "‏₿ <b>ارز دیجیتال</b>",
  "<blockquote>‏بیت‌کوین: 83,205 دلار*</blockquote>",
  "",
  "‏* بیت‌کوین: آخرین به‌روزرسانی 6 مهر 1405 20:58",
].join("\n");
const FA_APPROX = [
  "‏📈 <b>مارکت پینگ</b>",
  "",
  "‏چهارشنبه، 8 مهر 1405 | 09:00",
  "",
  "‏💱 <b>نرخ ارز</b>",
  "<blockquote>‏دلار: ~253,700 تومان</blockquote>",
  "",
  "‏🥇 <b>طلا و سکه</b>",
  "<blockquote>‏اونس طلا: 4,171 دلار",
  "‏",
  "‏طلا گرم 18 عیار: 25,396,000 تومان",
  "‏",
  "‏ربع سکه: 71,200,000 تومان",
  "‏نیم سکه: 130,400,000 تومان",
  "‏تمام سکه: 247,800,000 تومان",
  "‏سکه امامی: 257,000,000 تومان</blockquote>",
  "",
  "‏₿ <b>ارز دیجیتال</b>",
  "<blockquote>‏بیت‌کوین: 83,205 دلار</blockquote>",
  "",
  "‏~ بر اساس نرخ تتر",
].join("\n");

const BANNED = ["Tehran", "تهران", "Iran time", "ایران تایم", "تهران تایم", "به وقت"];

describe("golden messages: full string equality", () => {
  it("en hourly message matches the documented output exactly", () => {
    expect(renderMessage(snapshot(goldenMetrics()), "en")).toBe(EN_HOURLY);
  });

  it("en on-demand message (with the Last update line) matches exactly", () => {
    expect(onDemand(goldenMetrics(), "en", EN_AGE_SEC)).toBe(EN_ON_DEMAND);
  });

  it("fa hourly message matches the documented output exactly", () => {
    expect(renderMessage(snapshot(goldenMetrics()), "fa")).toBe(FA_HOURLY);
  });

  it("fa on-demand message (with the Last update line) matches exactly", () => {
    expect(onDemand(goldenMetrics(), "fa", FA_AGE_SEC)).toBe(FA_ON_DEMAND);
  });

  it("en with one N/A matches exactly", () => {
    expect(renderMessage(snapshot(withNa()), "en")).toBe(EN_NA);
  });

  it("fa with one N/A matches exactly", () => {
    expect(renderMessage(snapshot(withNa()), "fa")).toBe(FA_NA);
  });

  it("en with one stale value and its footnote matches exactly", () => {
    expect(renderMessage(snapshot(withStaleBtc()), "en")).toBe(EN_STALE);
  });

  it("fa with one stale value and its footnote matches exactly", () => {
    expect(renderMessage(snapshot(withStaleBtc()), "fa")).toBe(FA_STALE);
  });

  it("en with one approximate value and its footnote matches exactly", () => {
    expect(renderMessage(snapshot(withApproximateUsd()), "en")).toBe(EN_APPROX);
  });

  it("fa with one approximate value and its footnote matches exactly", () => {
    expect(renderMessage(snapshot(withApproximateUsd()), "fa")).toBe(FA_APPROX);
  });
});

describe("golden rules the exact strings must keep satisfying", () => {
  const all = [EN_HOURLY, EN_ON_DEMAND, EN_NA, EN_STALE, EN_APPROX, FA_HOURLY, FA_ON_DEMAND, FA_NA, FA_STALE, FA_APPROX];

  it("never contains a city or time-zone word in any language", () => {
    for (const text of all) {
      for (const word of BANNED) expect(text, word).not.toContain(word);
    }
  });

  it("has no city word in the header, the Last update line or the footnotes", () => {
    for (const text of all) {
      expect(text).toMatch(/4Shanbe, 8 Mehr 1405 \| 09:00|چهارشنبه، 8 مهر 1405 \| 09:00/);
    }
    expect(EN_ON_DEMAND).toContain("\n" + t("en").lastUpdateLine(GOLDEN_NOW, GOLDEN_NOW + EN_AGE_SEC));
    expect(EN_ON_DEMAND).toContain("\n🕒 Last update: 09:00 (7 min ago)");
    // The Persian line is built from the bundle (it contains ZWNJ characters).
    const faLine = t("fa").lastUpdateLine(GOLDEN_NOW, GOLDEN_NOW + FA_AGE_SEC);
    expect(FA_ON_DEMAND).toContain("\n" + faLine);
    expect(faLine.startsWith(RLM)).toBe(true);
    expect(faLine).toContain("ساعت 09:00 (5 دقیقه پیش)");
    for (const line of [EN_STALE, FA_STALE, EN_APPROX, FA_APPROX]) {
      expect(line).not.toMatch(/Tehran|تهران/);
    }
  });

  it("puts the Last update line only on the on-demand path", () => {
    for (const text of [EN_HOURLY, EN_NA, EN_STALE, EN_APPROX, FA_HOURLY, FA_NA, FA_STALE, FA_APPROX]) {
      expect(text).not.toContain("Last update: 09:00");
      expect(text).not.toContain("به‌روزرسانی: ساعت 09:00");
    }
  });

  it("uses a Persian title with no Latin letters in any fa line", () => {
    expect(FA_HOURLY.startsWith(`${RLM}📈 <b>مارکت پینگ</b>`)).toBe(true);
    for (const line of FA_HOURLY.split("\n")) {
      if (line.trim().length === 0) continue;
      const bare = line.replace(/<\/?[a-zA-Z]+>/g, "").replace(new RegExp(RLM, "g"), "");
      expect(/[A-Za-z]/.test(bare), line).toBe(false);
    }
  });

  it("prefixes every non-empty fa line with exactly one RLM", () => {
    for (const text of [FA_HOURLY, FA_NA, FA_STALE, FA_APPROX, FA_ON_DEMAND]) {
      for (const raw of text.split("\n")) {
        if (raw.length === 0) continue;
        // A line may start with the wrapping tag; the first TEXT character must be the RLM.
        const line = raw.replace(/^<(?:blockquote|pre)>/, "");
        if (line.length === 0) continue;
        expect(line.startsWith(RLM), JSON.stringify(raw)).toBe(true);
        expect(line.startsWith(RLM + RLM), JSON.stringify(raw)).toBe(false);
      }
    }
  });

  it("keeps the blank separator lines inside a blockquote RLM-only", () => {
    for (const line of FA_HOURLY.split("\n")) {
      if (line.trim().length === 0) expect(line === "" || line === RLM).toBe(true);
    }
    expect(FA_HOURLY).toContain(`\n${RLM}\n`);
  });

  it("uses the same Gold & Coins groups in both languages", () => {
    expect(GOLD_COIN_ROW_GROUPS.fa).toEqual(GOLD_COIN_ROW_GROUPS.en);
    expect(GOLD_COIN_ROW_GROUPS.fa).toHaveLength(3);
    expect(GOLD_COIN_ROW_GROUPS.fa[2]).toEqual([
      "coin_quarter_toman",
      "coin_half_toman",
      "coin_bahar_toman",
      "coin_emami_toman",
    ]);
    // The four coins sit in one group: exactly two blank separator lines inside each
    // Gold & Coins block (the blank lines between the categories are outside it).
    const goldBlock = (text: string): string => {
      const heading = text.indexOf("🥇");
      const rest = text.slice(heading);
      const offset = rest.search(/<(?:pre|blockquote)>/);
      const start = heading + offset;
      const closing = rest.startsWith("<pre>", offset) ? "</pre>" : "</blockquote>";
      return text.slice(start, text.indexOf(closing, start));
    };
    // A blank line is either truly empty (outside a quote) or RLM-only (inside one).
    const isBlank = (line: string): boolean => line === "" || line === RLM;
    expect(goldBlock(EN_HOURLY).split("\n").filter(isBlank)).toHaveLength(2);
    expect(goldBlock(FA_HOURLY).split("\n").filter(isBlank)).toHaveLength(2);
    // The four coins are one contiguous group: Emami is the last row, with no blank line
    // between Tamam and Emami.
    const faGold = goldBlock(FA_HOURLY).split("\n");
    expect(faGold[faGold.length - 1]).toContain("سکه امامی: 257,000,000 تومان");
    expect(faGold[faGold.length - 2]).toContain("تمام سکه: 247,800,000 تومان");
    expect(faGold[faGold.length - 3]).toContain("نیم سکه: 130,400,000 تومان");
  });

  it("uses one common column width for the whole English Gold & Coins block", () => {
    const block = /<pre>([\s\S]*?)<\/pre>/.exec(EN_HOURLY.replace(/[\s\S]*?<pre>USD[\s\S]*?<\/pre>\n/, ""))?.[1] ?? "";
    const rows = block.split("\n").filter((line) => line.length > 0);
    expect(new Set(rows.map((row) => row.length)).size).toBe(1);
  });

  it("stays inside the display-line budget", () => {
    for (const text of all) expect(countDisplayLines(text)).toBeLessThanOrEqual(MESSAGE_MAX_DISPLAY_LINES);
  });

  it("carries no footer and no inline keyboard markup", () => {
    for (const text of all) {
      expect(text).not.toContain("T = Toman");
      expect(text).not.toContain("Source:");
      expect(text).not.toMatch(/<i>|InlineKeyboard/);
    }
  });
});
