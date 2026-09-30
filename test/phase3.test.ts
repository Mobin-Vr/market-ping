import { describe, expect, it } from "vitest";
import {
  CATEGORY_ORDER,
  FA_LAYOUT,
  GOLD_COIN_ROW_GROUPS,
  MESSAGE_MAX_DISPLAY_LINES,
} from "../src/config";
import { t, type Lang } from "../src/i18n";
import { countDisplayLines, renderMessage, RLM, rlm } from "../src/render/message";
import { resolveMetrics } from "../src/resolve/resolver";
import { allCandidates, FIXTURE_NOW } from "./fixtures";

function fixtureData(
  tweak?: (metrics: ReturnType<typeof resolveMetrics>["metrics"]) => void,
  sources: ("nerkh" | "megaweb" | "zipodo" | "navasan")[] = ["nerkh", "megaweb"],
) {
  const metrics = resolveMetrics(allCandidates(), {}, 249601, FIXTURE_NOW).metrics;
  if (tweak) tweak(metrics);
  return { hourKey: "2026-09-29-10", createdAt: FIXTURE_NOW, metrics, sources };
}

function withNa(metrics: ReturnType<typeof resolveMetrics>["metrics"]): void {
  metrics.coin_emami_toman = { metric: "coin_emami_toman", value: null, source: null, updatedAtEpochSec: null, stale: false, approximate: false };
}

function withStaleAndApproximate(metrics: ReturnType<typeof resolveMetrics>["metrics"]): void {
  metrics.usd_toman = { metric: "usd_toman", value: 249950, source: "zipodo", updatedAtEpochSec: FIXTURE_NOW, stale: false, approximate: true };
  metrics.btc_usd = { metric: "btc_usd", value: 83989, source: "megaweb", updatedAtEpochSec: 1790616530, stale: true, approximate: false };
}

const FA_LABELS = ["دلار", "اونس طلا", "ربع سکه", "سکه امامی", "بیت‌کوین"];

/** Shorthand: every Persian text line starts with U+200F. */
const L = RLM;

/* ---------- exact expected outputs (fixture data, header 3Shanbe, 7 Mehr 1405 | 10:34) ---------- */

const EN_BASE = [
  "📈 <b>Market Ping</b>",
  "",
  "3Shanbe, 7 Mehr 1405 | 10:34",
  "",
  "💱 <b>Currency</b>",
  "<pre>USD  244,800 T</pre>",
  "",
  "🥇 <b>Gold &amp; Coins</b>",
  "<pre>Gold Ounce               $4,142",
  "",
  "Tala Garam (18K)   24,835,000 T",
  "",
  "Rob Seke           68,500,000 T",
  "Nim Seke          127,800,000 T",
  "Tamam Seke        243,500,000 T",
  "Emami             250,100,000 T</pre>",
  "",
  "₿ <b>Crypto</b>",
  "<pre>Bitcoin  $83,989</pre>",
  "",
].join("\n");

const FA_BASE = [
  `${L}📈 <b>مارکت پینگ</b>`,
  "",
  `${L}سه‌شنبه، 7 مهر 1405 | 10:34`,
  "",
  `${L}💱 <b>نرخ ارز</b>`,
  `<blockquote>${L}دلار: 244,800 تومان</blockquote>`,
  "",
  `${L}🥇 <b>طلا و سکه</b>`,
  `<blockquote>${L}اونس طلا: 4,142 دلار`,
  L,
  `${L}طلا گرم 18 عیار: 24,835,000 تومان`,
  L,
  `${L}ربع سکه: 68,500,000 تومان`,
  `${L}نیم سکه: 127,800,000 تومان`,
  `${L}تمام سکه: 243,500,000 تومان`,
  `${L}سکه امامی: 250,100,000 تومان</blockquote>`,
  "",
  `${L}₿ <b>ارز دیجیتال</b>`,
  `<blockquote>${L}بیت‌کوین: 83,989 دلار</blockquote>`,
  "",
].join("\n");

const EN_NA = [
  "📈 <b>Market Ping</b>",
  "",
  "3Shanbe, 7 Mehr 1405 | 10:34",
  "",
  "💱 <b>Currency</b>",
  "<pre>USD  244,800 T</pre>",
  "",
  "🥇 <b>Gold &amp; Coins</b>",
  "<pre>Gold Ounce               $4,142",
  "",
  "Tala Garam (18K)   24,835,000 T",
  "",
  "Rob Seke           68,500,000 T",
  "Nim Seke          127,800,000 T",
  "Tamam Seke        243,500,000 T",
  "Emami                       N/A</pre>",
  "",
  "₿ <b>Crypto</b>",
  "<pre>Bitcoin  $83,989</pre>",
  "",
].join("\n");

const FA_NA = [
  `${L}📈 <b>مارکت پینگ</b>`,
  "",
  `${L}سه‌شنبه، 7 مهر 1405 | 10:34`,
  "",
  `${L}💱 <b>نرخ ارز</b>`,
  `<blockquote>${L}دلار: 244,800 تومان</blockquote>`,
  "",
  `${L}🥇 <b>طلا و سکه</b>`,
  `<blockquote>${L}اونس طلا: 4,142 دلار`,
  L,
  `${L}طلا گرم 18 عیار: 24,835,000 تومان`,
  L,
  `${L}ربع سکه: 68,500,000 تومان`,
  `${L}نیم سکه: 127,800,000 تومان`,
  `${L}تمام سکه: 243,500,000 تومان`,
  `${L}سکه امامی: ناموجود</blockquote>`,
  "",
  `${L}₿ <b>ارز دیجیتال</b>`,
  `<blockquote>${L}بیت‌کوین: 83,989 دلار</blockquote>`,
  "",
].join("\n");

const EN_STALE = [
  "📈 <b>Market Ping</b>",
  "",
  "3Shanbe, 7 Mehr 1405 | 10:34",
  "",
  "💱 <b>Currency</b>",
  "<pre>USD  ~249,950 T</pre>",
  "",
  "🥇 <b>Gold &amp; Coins</b>",
  "<pre>Gold Ounce               $4,142",
  "",
  "Tala Garam (18K)   24,835,000 T",
  "",
  "Rob Seke           68,500,000 T",
  "Nim Seke          127,800,000 T",
  "Tamam Seke        243,500,000 T",
  "Emami             250,100,000 T</pre>",
  "",
  "₿ <b>Crypto</b>",
  "<pre>Bitcoin  $83,989*</pre>",
  "",
  "* Bitcoin: last update 6 Mehr 1405 20:58",
  "~ via USDT rate",
].join("\n");

const FA_STALE = [
  `${L}📈 <b>مارکت پینگ</b>`,
  "",
  `${L}سه‌شنبه، 7 مهر 1405 | 10:34`,
  "",
  `${L}💱 <b>نرخ ارز</b>`,
  `<blockquote>${L}دلار: ~249,950 تومان</blockquote>`,
  "",
  `${L}🥇 <b>طلا و سکه</b>`,
  `<blockquote>${L}اونس طلا: 4,142 دلار`,
  L,
  `${L}طلا گرم 18 عیار: 24,835,000 تومان`,
  L,
  `${L}ربع سکه: 68,500,000 تومان`,
  `${L}نیم سکه: 127,800,000 تومان`,
  `${L}تمام سکه: 243,500,000 تومان`,
  `${L}سکه امامی: 250,100,000 تومان</blockquote>`,
  "",
  `${L}₿ <b>ارز دیجیتال</b>`,
  `<blockquote>${L}بیت‌کوین: 83,989 دلار*</blockquote>`,
  "",
  `${L}* بیت‌کوین: آخرین به‌روزرسانی 6 مهر 1405 20:58`,
  `${L}~ بر اساس نرخ تتر`,
].join("\n");

describe("exact output snapshots (fixture data)", () => {
  it("renders the exact English base message", () => {
    expect(renderMessage(fixtureData(), "en")).toBe(EN_BASE);
  });

  it("renders the exact Persian base message", () => {
    expect(renderMessage(fixtureData(), "fa")).toBe(FA_BASE);
    // Blank separator lines inside the blockquote contain ONLY U+200F.
    expect(FA_BASE.split("\n").filter((line) => line === RLM)).toHaveLength(2);
  });

  it("renders the exact English message with an N/A value", () => {
    expect(renderMessage(fixtureData(withNa, ["nerkh"]), "en")).toBe(EN_NA);
  });

  it("renders the exact Persian message with an N/A value", () => {
    expect(renderMessage(fixtureData(withNa, ["nerkh"]), "fa")).toBe(FA_NA);
  });

  it("renders the exact English message with stale and approximate markers", () => {
    expect(
      renderMessage(fixtureData(withStaleAndApproximate, ["nerkh", "zipodo", "megaweb"]), "en"),
    ).toBe(EN_STALE);
  });

  it("renders the exact Persian message with stale and approximate markers", () => {
    expect(
      renderMessage(fixtureData(withStaleAndApproximate, ["nerkh", "zipodo", "megaweb"]), "fa"),
    ).toBe(FA_STALE);
  });

  it("separates the Gold & Coins groups per language from GOLD_COIN_ROW_GROUPS", () => {
    expect(GOLD_COIN_ROW_GROUPS.en).toHaveLength(3);
    expect(GOLD_COIN_ROW_GROUPS.fa).toHaveLength(3);
    // The intentional difference: Emami is its own group only in Persian.
    expect(GOLD_COIN_ROW_GROUPS.en[2]).toEqual([
      "coin_quarter_toman",
      "coin_half_toman",
      "coin_bahar_toman",
      "coin_emami_toman",
    ]);
    expect(GOLD_COIN_ROW_GROUPS.fa[2]).toContain("coin_emami_toman");
  });
});

describe("phase 3 structural layout", () => {
  it("renders the English layout in CATEGORY_ORDER with three <pre> blocks", () => {
    const message = renderMessage(fixtureData(), "en");
    expect(CATEGORY_ORDER).toEqual(["currency", "goldCoins", "crypto"]);
    expect(message.indexOf("Currency")).toBeLessThan(message.indexOf("Gold &amp; Coins"));
    expect(message.indexOf("Gold &amp; Coins")).toBeLessThan(message.indexOf("Crypto"));
    expect(message.match(/<pre>/g)).toHaveLength(3);
    expect(message).not.toContain("<blockquote>");
    expect(countDisplayLines(message)).toBeLessThanOrEqual(MESSAGE_MAX_DISPLAY_LINES);
  });

  it("renders the Persian layout with three blockquotes", () => {
    const message = renderMessage(fixtureData(), "fa");
    expect(FA_LAYOUT).toBe("blockquote");
    expect(message).toContain("نرخ ارز");
    expect(message).toContain("طلا و سکه");
    expect(message).toContain("ارز دیجیتال");
    expect(message.match(/<blockquote>/g)).toHaveLength(3);
    expect(message).not.toContain("<pre>");
    for (const label of FA_LABELS) expect(message, label).toContain(label);
    expect(countDisplayLines(message)).toBeLessThanOrEqual(MESSAGE_MAX_DISPLAY_LINES);
  });

  it("keeps the worst case (stale + approximate footnotes + on-demand line) within 26 lines", () => {
    // Worst case: both footnotes (stale note + approximate note) and the appended
    // "🕒 Last update" line, on top of the new blank lines between title/date/groups.
    const expectedWithLastUpdate: Record<Lang, number> = { en: 23, fa: 23 };
    for (const lang of ["en", "fa"] as const satisfies readonly Lang[]) {
      const strings = t(lang);
      const message = renderMessage(
        fixtureData((metrics) => {
          withNa(metrics);
          withStaleAndApproximate(metrics);
        }, ["nerkh", "zipodo", "megaweb"]),
        lang,
      );
      expect(message).toContain(strings.message.na);
      expect(message).toContain(strings.message.approximateNote);
      const withLastUpdate = message + "\n" + strings.lastUpdateLine(FIXTURE_NOW, FIXTURE_NOW + 720);
      expect(countDisplayLines(withLastUpdate), lang).toBe(expectedWithLastUpdate[lang]);
      expect(countDisplayLines(withLastUpdate), lang).toBeLessThanOrEqual(MESSAGE_MAX_DISPLAY_LINES);
    }
  });
});

describe("RTL rlm helper", () => {
  it("prefixes once and never doubles", () => {
    expect(rlm("x")).toBe(RLM + "x");
    expect(rlm(RLM + "x")).toBe(RLM + "x");
    expect(RLM.charCodeAt(0)).toBe(0x200f);
  });
});

describe("RTL no-latin, digits, units and pre fallback", () => {
  function faLines(message: string): string[] {
    // Split blockquote/pre tag lines so every row is checked on its own.
    const flat = message.replace(/<\/?(blockquote|pre)>/g, "\n");
    return flat.split("\n").filter((line) => line.trim().length > 0);
  }
  it("keeps fa rows latin-free, english digits, unit after number, no $ or T", () => {
    const message = renderMessage(fixtureData(withStaleAndApproximate), "fa");
    expect(message).not.toContain("$");
    const rows = message
      .replace(/<\/?(blockquote|pre)>/g, "\n")
      .split("\n")
      .filter((line) => /: (~?[0-9]|ناموجود)/.test(line) && !line.includes(" | "));
    expect(rows.length).toBe(8);
    for (const line of rows) {
      expect(line.startsWith(RLM), line).toBe(true);
      const bare = line.replace(/<[^>]+>/g, "").replace(new RegExp(RLM, "g"), "");
      expect(/[A-Za-z]/.test(bare), line).toBe(false);
      expect(/(^|[^A-Za-z])T([^A-Za-z]|$)/.test(bare), line).toBe(false);
      if (!bare.includes("ناموجود")) expect(bare).toMatch(/[0-9,]+ (تومان|دلار)/);
    }
    expect(message).not.toMatch(/[۰-۹]/);
    // No Latin letters anywhere at all - the Persian title is Persian too.
    const latinOutsideTitle = message
      .split("\n")
      .some((line) => /[A-Za-z]/.test(line.replace(/<\/?[a-zA-Z]+>/g, "")));
    expect(latinOutsideTitle).toBe(false);
    // The stale/approximate footnotes stay Latin-free too.
    expect(message).toContain(`${L}* بیت‌کوین: آخرین به‌روزرسانی 6 مهر 1405 20:58`);
  });
  it("renders the same fa rows and groups inside pre blocks with the fallback", () => {
    const blockquote = renderMessage(fixtureData(), "fa");
    const pre = renderMessage(fixtureData(), "fa", { faLayout: "pre" });
    expect(pre.match(/<pre>/g)).toHaveLength(3);
    expect(pre).not.toContain("<blockquote>");
    for (const label of FA_LABELS) expect(pre, label).toContain(label);
    for (const line of faLines(pre)) expect(line.startsWith(RLM), line).toBe(true);
    // Same rows and same groups: only the wrapping tag differs.
    const stripTags = (message: string): string => message.replace(/<\/?(blockquote|pre)>/g, "");
    expect(stripTags(pre)).toBe(stripTags(blockquote));
    // Blank group separators inside the pre blocks are also RLM-only.
    expect(pre.split("\n").filter((line) => line === RLM)).toHaveLength(2);
  });
});
