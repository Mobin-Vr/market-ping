import { describe, expect, it } from "vitest";
import { extractMegaweb } from "../src/sources/megaweb";
import { extractNavasan } from "../src/sources/navasan";
import { extractNerkh } from "../src/sources/nerkh";
import { extractZipodo } from "../src/sources/zipodo";
import { jalaliToEpochSec } from "../src/time";
import { FIXTURE_NOW, FIXTURE_STALE_USD_SELL_AT, findCandidate, rawFixtures } from "./fixtures";

const UTC = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

function valueOf(payload: unknown, metric: Parameters<typeof findCandidate>[1], source: Parameters<typeof findCandidate>[2], now = FIXTURE_NOW): number | null {
  const candidates = source === "nerkh"
    ? extractNerkh(payload, now).candidates
    : source === "navasan"
      ? extractNavasan(payload, now).candidates
      : source === "megaweb"
        ? extractMegaweb(payload, now).candidates
        : extractZipodo(payload, now).candidates;
  return findCandidate(candidates, metric, source);
}

describe("extractNerkh (primary)", () => {
  const extraction = extractNerkh(rawFixtures.nerkh, FIXTURE_NOW);

  it("reads all eight metrics from the committed fixture", () => {
    expect(extraction.source).toBe("nerkh");
    expect(extraction.shapeError).toBeNull();
    expect(extraction.candidates).toHaveLength(8);
  });

  it("keeps Iranian values in Toman (no multiplier) and ounce in USD", () => {
    expect(valueOf(rawFixtures.nerkh, "usd_toman", "nerkh")).toBe(244800);
    expect(valueOf(rawFixtures.nerkh, "gold18_toman", "nerkh")).toBe(24835000);
    expect(valueOf(rawFixtures.nerkh, "coin_bahar_toman", "nerkh")).toBe(243500000);
    expect(valueOf(rawFixtures.nerkh, "coin_emami_toman", "nerkh")).toBe(250100000);
    expect(valueOf(rawFixtures.nerkh, "coin_half_toman", "nerkh")).toBe(127800000);
    expect(valueOf(rawFixtures.nerkh, "coin_quarter_toman", "nerkh")).toBe(68500000);
    expect(valueOf(rawFixtures.nerkh, "ounce_usd", "nerkh")).toBe(4142);
  });

  it("derives btc_usd from the BTC/USDT Toman pair", () => {
    expect(valueOf(rawFixtures.nerkh, "btc_usd", "nerkh")).toBeCloseTo(20981682400 / 249601, 6);
    expect(extraction.usdtToman).toBe(249601);
  });

  it("converts the Jalali update string from Tehran local time to epoch seconds", () => {
    const usd = extraction.candidates.find((candidate) => candidate.metric === "usd_toman");
    const gold = extraction.candidates.find((candidate) => candidate.metric === "gold18_toman");
    expect(usd?.updatedAtEpochSec).toBe(UTC("2026-09-29T07:02:25Z"));
    expect(gold?.updatedAtEpochSec).toBe(UTC("2026-09-29T06:59:54Z"));
    expect(jalaliToEpochSec("1405-07-07 10:32:25")).toBe(UTC("2026-09-29T07:02:25Z"));
  });

  it("ignores the excluded gold keys (GOLD24K, MAZANEH, MESGHAL, SEKE_PRS*, ...)", () => {
    const values = extraction.candidates.map((candidate) => candidate.value);
    expect(values).not.toContain(33110000);
    expect(values).not.toContain(107580000);
    expect(values).not.toContain(24793400);
  });

  it("is defensive about broken payloads", () => {
    expect(extractNerkh(null, FIXTURE_NOW).candidates).toHaveLength(0);
    expect(extractNerkh({}, FIXTURE_NOW).shapeError).toBe("missing data object");
    expect(extractNerkh({ data: { currency: { USD: { current: "0" } } } }, FIXTURE_NOW).candidates).toHaveLength(0);
    expect(extractNerkh({ data: { currency: { USD: { current: "abc" } } } }, FIXTURE_NOW).candidates).toHaveLength(0);
    expect(extractNerkh({ data: { currency: { USD: { current: "Infinity" } } } }, FIXTURE_NOW).candidates).toHaveLength(0);
  });
});

describe("extractNavasan (second)", () => {
  const extraction = extractNavasan(rawFixtures.navasan, FIXTURE_NOW);

  it("multiplies coins by 1000 (they are quoted in thousand Toman)", () => {
    expect(valueOf(rawFixtures.navasan, "coin_emami_toman", "navasan")).toBe(249500000);
    expect(valueOf(rawFixtures.navasan, "coin_bahar_toman", "navasan")).toBe(243000000);
    expect(valueOf(rawFixtures.navasan, "coin_half_toman", "navasan")).toBe(128000000);
    expect(valueOf(rawFixtures.navasan, "coin_quarter_toman", "navasan")).toBe(68500000);
  });

  it("keeps 18ayar as Toman per gram and usd_xau as USD", () => {
    expect(valueOf(rawFixtures.navasan, "gold18_toman", "navasan")).toBe(24770300);
    expect(valueOf(rawFixtures.navasan, "ounce_usd", "navasan")).toBe(4142.65);
  });

  it("ignores the misleading keys (xau is Toman, bub_* are bubbles, mob_* are years old)", () => {
    const values = extraction.candidates.map((candidate) => candidate.value);
    expect(values).not.toContain(1008542280);
    expect(values).not.toContain(11593020);
    expect(values).not.toContain(42000);
  });

  it("derives btc_usd from the BTC/USDT Toman pair and exposes the USDT helper", () => {
    expect(valueOf(rawFixtures.navasan, "btc_usd", "navasan")).toBeCloseTo(20919611080 / 249400, 6);
    expect(extraction.usdtToman).toBe(249400);
  });

  it("keeps a per-key timestamp so stale keys can be detected", () => {
    const usd = extraction.candidates.find((candidate) => candidate.metric === "usd_toman");
    const emami = extraction.candidates.find((candidate) => candidate.metric === "coin_emami_toman");
    expect(usd?.updatedAtEpochSec).toBe(FIXTURE_STALE_USD_SELL_AT);
    expect(emami?.updatedAtEpochSec).toBe(1790663415);
    expect((emami?.updatedAtEpochSec ?? 0) - (usd?.updatedAtEpochSec ?? 0)).toBe(46885);
  });

  it("is defensive about broken payloads", () => {
    expect(extractNavasan(null, FIXTURE_NOW).shapeError).toBe("payload is not an object");
    expect(extractNavasan([], FIXTURE_NOW).candidates).toHaveLength(0);
    expect(extractNavasan({ sekkeh: { value: "" } }, FIXTURE_NOW).candidates).toHaveLength(0);
    expect(extractNavasan({}, FIXTURE_NOW).shapeError).toBe("no usable keys");
  });
});

describe("extractMegaweb (btc_usd only)", () => {
  it("reads the BTC entry and its info.time timestamp", () => {
    const extraction = extractMegaweb(rawFixtures.megaweb, FIXTURE_NOW);
    expect(extraction.candidates).toHaveLength(1);
    const btc = extraction.candidates[0];
    expect(btc.metric).toBe("btc_usd");
    expect(btc.value).toBeCloseTo(83988.75, 6);
    expect(btc.updatedAtEpochSec).toBe(1790665324);
    expect(btc.approximate).toBe(false);
  });

  it("never emits anything except btc_usd", () => {
    const extraction = extractMegaweb(rawFixtures.megaweb, FIXTURE_NOW);
    expect(extraction.candidates.every((candidate) => candidate.metric === "btc_usd")).toBe(true);
  });

  it("is defensive about broken payloads", () => {
    expect(extractMegaweb(null, FIXTURE_NOW).shapeError).toBe("missing data array");
    expect(extractMegaweb({ data: [] }, FIXTURE_NOW).shapeError).toBe("BTC entry not found");
    expect(extractMegaweb({ data: [{ symbol: "BTC" }] }, FIXTURE_NOW).candidates).toHaveLength(0);
  });
});

describe("extractZipodo (last live usd_toman fallback)", () => {
  it("marks the value approximate and uses the fetch time (the payload has no timestamp)", () => {
    const extraction = extractZipodo(rawFixtures.zipodo, FIXTURE_NOW);
    expect(extraction.candidates).toHaveLength(1);
    const usd = extraction.candidates[0];
    expect(usd.metric).toBe("usd_toman");
    expect(usd.value).toBe(249950);
    expect(usd.approximate).toBe(true);
    expect(usd.updatedAtEpochSec).toBe(FIXTURE_NOW);
    expect(extraction.usdtToman).toBe(249950);
    expect(extraction.usdtApproximate).toBe(true);
  });

  it("is defensive about broken payloads", () => {
    expect(extractZipodo(null, FIXTURE_NOW).shapeError).toBe("missing price");
    expect(extractZipodo({}, FIXTURE_NOW).candidates).toHaveLength(0);
    expect(extractZipodo({ price: "abc" }, FIXTURE_NOW).candidates).toHaveLength(0);
    expect(extractZipodo({ price: -5 }, FIXTURE_NOW).candidates).toHaveLength(0);
  });
});
