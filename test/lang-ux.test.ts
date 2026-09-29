import { afterEach, describe, expect, it, vi } from "vitest";
import { CALLBACK_DATA } from "../src/config";
import { fa, t } from "../src/i18n";
import { handleCallbackQueryUpdate } from "../src/telegram/callbacks";
import { handleMessageUpdate } from "../src/telegram/commands";
import type { TgCallbackQuery, TgMessage } from "../src/types";
import { createFakeD1, fakeEnv, stubNetwork, type FakeRoute } from "./fakes";
import { FIXTURE_NOW } from "./fixtures";

const CHAT_ID = 4242;

interface StoreState {
  lang: string | null;
  known: boolean;
}

const SNAPSHOT_ROW = {
  id: 9,
  created_at: FIXTURE_NOW - 600,
  hour_key: "2026-09-29-10",
  message_html: "<b>english-html</b>",
  html_fa: "<b>persian-html</b>",
  html_en: "<b>english-html</b>",
  data_json: "{}",
};

function routes(state: StoreState, overrides: readonly FakeRoute[] = []): readonly FakeRoute[] {
  return [
    ["SELECT value FROM settings WHERE key", { first: { value: "1" } }],
    [
      "SELECT chat_id, username, first_name",
      () =>
        state.known
          ? {
              first: {
                chat_id: CHAT_ID,
                username: "tester",
                first_name: "Tester",
                subscribed: 0,
                joined_at: FIXTURE_NOW,
                blocked: 0,
                last_manual_at: null,
                lang: state.lang,
              },
            }
          : { first: undefined },
    ],
    [
      "INSERT INTO users",
      () => {
        if (!state.known) {
          state.known = true;
          state.lang = "fa";
        }
        return { changes: 1 };
      },
    ],
    [
      "UPDATE users SET lang",
      (params) => {
        state.lang = String(params[1]);
        return { changes: 1 };
      },
    ],
    ["UPDATE users SET subscribed", { changes: 1 }],
    ["UPDATE users SET last_manual_at", { changes: 1 }],
    ["UPDATE users SET blocked", { changes: 1 }],
    ["ORDER BY id DESC LIMIT 1", { first: SNAPSHOT_ROW }],
    ["INSERT INTO snapshots", { lastRowId: 10 }],
    ["FROM last_good", { all: [] }],
    ["INSERT INTO settings", { changes: 1 }],
    ...overrides,
  ];
}

function message(text: string): TgMessage {
  return {
    message_id: 1,
    chat: { id: CHAT_ID, type: "private" },
    from: { id: CHAT_ID, first_name: "Tester", username: "tester" },
    text,
  } as unknown as TgMessage;
}

function callback(data: string): TgCallbackQuery {
  return {
    id: "callback-1",
    from: { id: CHAT_ID, first_name: "Tester" },
    data,
    message: { message_id: 55, chat: { id: CHAT_ID, type: "private" } },
  } as unknown as TgCallbackQuery;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("first contact", () => {
  it("creates the user as Persian and shows the Persian welcome with the language button", async () => {
    const network = stubNetwork();
    const state: StoreState = { lang: null, known: false };
    const fake = createFakeD1(routes(state));

    await handleMessageUpdate(fakeEnv({ DB: fake.db }), message("/start"));

    const inserted = fake.statements.find((statement) => statement.sql.includes("INSERT INTO users"));
    expect(inserted?.sql).toContain("lang");
    expect(inserted?.sql).toContain("'fa'");
    expect(state.lang).toBe("fa");

    expect(network.telegramCalls).toHaveLength(1);
    const call = network.telegramCalls[0];
    expect(call.method).toBe("sendMessage");
    expect(call.text).toBe(fa.welcome);
    expect(call.keyboard).toContain("🌐 English");
    expect(call.keyboard).toContain(CALLBACK_DATA.join);
  });

  it("never overwrites the language of an existing user", async () => {
    stubNetwork();
    const state: StoreState = { lang: "en", known: true };
    const fake = createFakeD1(routes(state));

    await handleMessageUpdate(fakeEnv({ DB: fake.db }), message("/start"));

    const upsert = fake.statements.find((statement) => statement.sql.includes("INSERT INTO users"));
    expect(upsert?.sql).not.toContain("lang =");
    expect(state.lang).toBe("en");
  });
});

describe("language commands and toggle", () => {
  it("answers /language with the picker", async () => {
    const network = stubNetwork();
    const state: StoreState = { lang: "fa", known: true };
    const fake = createFakeD1(routes(state));

    await handleMessageUpdate(fakeEnv({ DB: fake.db }), message("/language"));

    const call = network.telegramCalls[0];
    expect(call.text).toBe(fa.languagePicker);
    expect(call.keyboard).toContain(CALLBACK_DATA.langFa);
    expect(call.keyboard).toContain(CALLBACK_DATA.langEn);
    expect(call.keyboard).toContain("🇮🇷 فارسی");
    expect(call.keyboard).toContain("🇬🇧 English");
  });

  it("switches to English, persists it and edits the same message in place", async () => {
    const network = stubNetwork();
    const state: StoreState = { lang: "fa", known: true };
    const fake = createFakeD1(routes(state));

    await handleCallbackQueryUpdate(fakeEnv({ DB: fake.db }), callback(CALLBACK_DATA.langEn));

    const update = fake.statements.find((statement) => statement.sql.includes("UPDATE users SET lang"));
    expect(update?.params).toEqual([CHAT_ID, "en"]);
    expect(state.lang).toBe("en");

    expect(network.telegramCalls).toHaveLength(2);
    const edit = network.telegramCalls[0];
    expect(edit.method).toBe("editMessageText");
    expect(edit.text).toBe(t("en").welcome);
    expect(edit.keyboard).toContain("🌐 فارسی");
    const answer = network.telegramCalls[1];
    expect(answer.method).toBe("answerCallbackQuery");
    expect(answer.text).toBe(t("en").languageChangedToast);
  });

  it("switches back to Persian", async () => {
    const network = stubNetwork();
    const state: StoreState = { lang: "en", known: true };
    const fake = createFakeD1(routes(state));

    await handleCallbackQueryUpdate(fakeEnv({ DB: fake.db }), callback(CALLBACK_DATA.langFa));

    expect(state.lang).toBe("fa");
    const edit = network.telegramCalls[0];
    expect(edit.text).toBe(fa.welcome);
    expect(edit.keyboard).toContain("🌐 English");
  });
});

describe("per-language user messages", () => {
  it("serves the Persian snapshot text to a Persian user", async () => {
    const network = stubNetwork();
    const state: StoreState = { lang: "fa", known: true };
    const fake = createFakeD1(routes(state));

    await handleMessageUpdate(fakeEnv({ DB: fake.db }), message("/price"));

    const call = network.telegramCalls[0];
    expect(call.text).toContain("<b>persian-html</b>");
    expect(call.text).toContain("آخرین به‌روزرسانی");
  });

  it("serves the English snapshot text to an English user", async () => {
    const network = stubNetwork();
    const state: StoreState = { lang: "en", known: true };
    const fake = createFakeD1(routes(state));

    await handleMessageUpdate(fakeEnv({ DB: fake.db }), message("/price"));

    const call = network.telegramCalls[0];
    expect(call.text).toContain("<b>english-html</b>");
    expect(call.text).toContain("Last update");
  });

  it("answers unknown text with the localized welcome", async () => {
    const network = stubNetwork();
    const state: StoreState = { lang: "en", known: true };
    const fake = createFakeD1(routes(state));

    await handleMessageUpdate(fakeEnv({ DB: fake.db }), message("hello?"));

    expect(network.telegramCalls[0].text).toBe(t("en").welcome);
  });

  it("uses the localized paused text when the service is OFF", async () => {
    const network = stubNetwork();
    const state: StoreState = { lang: "fa", known: true };
    const fake = createFakeD1(
      routes(state, [["SELECT value FROM settings WHERE key", { first: { value: "0" } }]]),
    );

    await handleMessageUpdate(fakeEnv({ DB: fake.db }), message("/price"));

    expect(network.telegramCalls[0].text).toBe(fa.paused);
  });
});