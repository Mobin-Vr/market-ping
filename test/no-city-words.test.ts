/**
 * RULE 0 guard: the bot must never show a city or time-zone word to a user. Every audience
 * is Iranian, so "Tehran" / "تهران" / "Iran time" / "ایران تایم" / "تهران تایم" / "به وقت"
 * are banned in everything the bot sends or registers with Telegram.
 *
 * This test walks EVERY value of BOTH bundles - nested objects, arrays and, crucially, the
 * function-valued entries, which are called with sample arguments so the text they build at
 * runtime is checked too. Code identifiers and developer comments are out of scope.
 */
import { describe, expect, it } from "vitest";
import { t, type Lang } from "../src/i18n";
import { FIXTURE_NOW } from "./fixtures";

const BANNED = ["Tehran", "تهران", "Iran time", "ایران تایم", "تهران تایم", "به وقت"];

/** Arguments that cover every bundle function signature. */
const ARG_SHAPES: unknown[][] = [
  [FIXTURE_NOW, FIXTURE_NOW + 3600],
  ["USD", "6 Mehr 1405 20:58"],
  [["USD", "Bitcoin (6 Mehr 1405 20:58)"], 2],
  [42, 7],
  [1],
  [0],
];

function render(fn: (...args: never[]) => unknown): string {
  for (const args of ARG_SHAPES) {
    try {
      const value = fn(...(args as never[]));
      if (typeof value === "string") return value;
    } catch {
      // Wrong arity/types for this function: try the next shape.
    }
  }
  throw new Error("no argument shape produced a string");
}

interface Found {
  path: string;
  value: string;
}

/** Walks a bundle (objects, arrays, strings and functions) and collects every user-visible text. */
function collect(node: unknown, path: string, out: Found[]): void {
  if (typeof node === "string") {
    out.push({ path, value: node });
    return;
  }
  if (typeof node === "function") {
    out.push({ path, value: render(node as (...args: never[]) => unknown) });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => collect(item, `${path}[${index}]`, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      // LANGS/DEFAULT_LANG style metadata is not user-visible text; the bundles carry none.
      collect(child, `${path}.${key}`, out);
    }
  }
}

describe("RULE 0: no city or time-zone word in any user-visible string", () => {
  for (const lang of ["en", "fa"] as const satisfies readonly Lang[]) {
    it(`walks every string of the ${lang} bundle (functions called with sample args)`, () => {
      const found: Found[] = [];
      collect(t(lang), lang, found);
      expect(found.length).toBeGreaterThan(40);
      for (const { path, value } of found) {
        for (const word of BANNED) {
          expect(value.toLowerCase().includes(word.toLowerCase()), `${path} contains "${word}": ${value}`).toBe(
            false,
          );
        }
      }
    });

    it(`has no banned word in the ${lang} Telegram profile payloads`, () => {
      const { profile } = t(lang);
      const texts: string[] = [profile.description, profile.shortDescription];
      for (const command of profile.commands) texts.push(command.command, command.description);
      for (const text of texts) {
        for (const word of BANNED) {
          expect(text.toLowerCase().includes(word.toLowerCase()), `${text} contains "${word}"`).toBe(false);
        }
      }
    });

    it(`renders the ${lang} "all sources failed" admin alert without a city word`, () => {
      const alert = t(lang).allSourcesFailedText(FIXTURE_NOW);
      expect(alert).toBe("All price sources failed at 10:34. Broadcast skipped.");
    });

    it(`keeps the ${lang} next-update and last-update lines free of banned words`, () => {
      const texts = [t(lang).nextUpdateText(FIXTURE_NOW), t(lang).lastUpdateLine(FIXTURE_NOW, FIXTURE_NOW + 600)];
      for (const text of texts) {
        for (const word of BANNED) {
          expect(text.toLowerCase().includes(word.toLowerCase()), `${text} contains "${word}"`).toBe(false);
        }
      }
    });
  }

  it("keeps the Persian title free of Latin letters and RLM-prefixed", async () => {
    const { RLM } = await import("../src/types");
    const title = t("fa").message.title;
    expect(title).toBe(`${RLM}📈 <b>مارکت پینگ</b>`);
    // Latin letters are allowed only inside the HTML tags.
    expect(/[A-Za-z]/.test(title.replace(/<\/?[a-zA-Z]+>/g, ""))).toBe(false);
  });

  it("both languages announce the same send window without a time-zone word", () => {
    expect(t("en").profile.shortDescription).toContain("09:00-21:00");
    expect(t("fa").profile.shortDescription).toContain("09:00");
    expect(t("en").profile.description).toContain("from 09:00 to 21:00");
  });
});