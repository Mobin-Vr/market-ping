import { describe, expect, it, vi, afterEach } from "vitest";
import { buildQueueMessagesByLang } from "../src/broadcast/chunk";
import { createFakeD1, createFakeMessage, fakeEnv, stubNetwork, type FakeRoute } from "./fakes";
import { processBroadcastMessage } from "../src/broadcast/consumer";
import { htmlForLang } from "../src/db/snapshots";
import type { BroadcastMessage } from "../src/types";

const HOUR_KEY = "2026-09-29-10";

function targets(fa: number, en: number) {
  const list = [];
  for (let i = 0; i < fa; i += 1) list.push({ chatId: 1000 + i, lang: "fa" as const });
  for (let i = 0; i < en; i += 1) list.push({ chatId: 2000 + i, lang: "en" as const });
  return list;
}

describe("buildQueueMessagesByLang", () => {
  it("builds one chunk per language and never mixes languages in a message", () => {
    const messages = buildQueueMessagesByLang(7, HOUR_KEY, targets(3, 2));
    expect(messages).toHaveLength(2);
    const faMsg = messages.find((m) => m.lang === "fa");
    const enMsg = messages.find((m) => m.lang === "en");
    expect(faMsg?.chatIds).toEqual([1000, 1001, 1002]);
    expect(enMsg?.chatIds).toEqual([2000, 2001]);
    for (const message of messages) {
      const ids = message.chatIds;
      const allFa = ids.every((id) => id < 2000);
      expect(message.lang).toBe(allFa ? "fa" : "en");
    }
  });

  it("chunks each language separately (20 fa + 20 en gives 2 messages per language)", () => {
    const messages = buildQueueMessagesByLang(7, HOUR_KEY, targets(20, 20));
    expect(messages.filter((m) => m.lang === "fa")).toHaveLength(2);
    expect(messages.filter((m) => m.lang === "en")).toHaveLength(2);
  });
});

describe("htmlForLang", () => {
  const base = { id: 1, created_at: 1, hour_key: "k", message_html: "<b>en</b>", data_json: "{}" };
  it("returns html_fa / html_en when present", () => {
    const row = { ...base, html_fa: "<b>fa</b>", html_en: "<b>en2</b>" };
    expect(htmlForLang(row, "fa")).toBe("<b>fa</b>");
    expect(htmlForLang(row, "en")).toBe("<b>en2</b>");
  });

  it("falls back to message_html when a language column is missing", () => {
    const row = { ...base, html_fa: null, html_en: null };
    expect(htmlForLang(row, "fa")).toBe("<b>en</b>");
    expect(htmlForLang(row, "en")).toBe("<b>en</b>");
  });
});

describe("consumer language selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const row = {
    id: 7,
    created_at: 1000,
    hour_key: HOUR_KEY,
    message_html: "<b>legacy-en</b>",
    html_fa: "<b>persian</b>",
    html_en: "<b>english</b>",
    data_json: "{}",
  };
  const routes: readonly FakeRoute[] = [
    ["FROM snapshots WHERE id", { first: row }],
    ["UPDATE broadcast_log", { changes: 1 }],
  ];

  async function sentText(body: BroadcastMessage): Promise<string[]> {
    const network = stubNetwork();
    const fake = createFakeD1(routes);
    const { message } = createFakeMessage(body);
    await processBroadcastMessage(fakeEnv({ DB: fake.db }), message);
    return network.telegramCalls.map((call) => call.text);
  }

  it("sends html_fa for lang fa and html_en for lang en", async () => {
    const faTexts = await sentText({ snapshotId: 7, hourKey: HOUR_KEY, chatIds: [11], attempt: 1, lang: "fa" });
    expect(faTexts[0]).toContain("<b>persian</b>");
    const enTexts = await sentText({ snapshotId: 7, hourKey: HOUR_KEY, chatIds: [11], attempt: 1, lang: "en" });
    expect(enTexts[0]).toContain("<b>english</b>");
  });

  it("falls back to message_html when the queue message has no lang", async () => {
    // No lang set: resolveLang defaults to fa, so pass a pre-migration row with no html_fa.
    const legacyRoutes: readonly FakeRoute[] = [
      ["FROM snapshots WHERE id", { first: { ...row, html_fa: null, html_en: null } }],
      ["UPDATE broadcast_log", { changes: 1 }],
    ];
    const network = stubNetwork();
    const fake = createFakeD1(legacyRoutes);
    const { message } = createFakeMessage({ snapshotId: 7, hourKey: HOUR_KEY, chatIds: [11], attempt: 1 });
    await processBroadcastMessage(fakeEnv({ DB: fake.db }), message);
    const texts = network.telegramCalls.map((call) => call.text);
    expect(texts[0]).toContain("<b>legacy-en</b>");
  });
});
