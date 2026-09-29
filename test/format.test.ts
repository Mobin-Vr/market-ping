import { describe, expect, it } from "vitest";
import { escapeHtml, formatInt, formatToman, formatUsd, groupDigits } from "../src/render/format";

describe("number formatting", () => {
  it("groups thousands for Toman-scale values", () => {
    expect(groupDigits(0)).toBe("0");
    expect(groupDigits(999)).toBe("999");
    expect(groupDigits(1000)).toBe("1,000");
    expect(groupDigits(244800)).toBe("244,800");
    expect(groupDigits(249500000)).toBe("249,500,000");
    expect(groupDigits(1234567890)).toBe("1,234,567,890");
    expect(groupDigits(-1234567)).toBe("-1,234,567");
  });

  it("rounds to whole numbers", () => {
    expect(formatInt(83988.75)).toBe("83,989");
    expect(formatInt(4142.35)).toBe("4,142");
  });

  it("renders Toman and USD suffixes", () => {
    expect(formatToman(249500000)).toBe("249,500,000 T");
    expect(formatUsd(4142.65)).toBe("$4,143");
  });
});

describe("HTML escaping", () => {
  it("escapes the four dangerous characters", () => {
    expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;'");
  });

  it("leaves prices, Persian-free text and emoji untouched", () => {
    expect(escapeHtml("244,800 T ✅")).toBe("244,800 T ✅");
  });
});
