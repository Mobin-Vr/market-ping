import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adminPanelKeyboard,
  handleAdminCallback,
  renderAdminPanel,
  sendAdminPanel,
  sendConfirmKeyboard,
} from "../src/admin/panel";
import { CALLBACK_DATA } from "../src/config";
import { t } from "../src/i18n";
import { hourKey as computeHourKey } from "../src/time";
import type { BroadcastLogRow } from "../src/db/broadcastLog";
import type { TgCallbackQuery } from "../src/types";
import {
  createFakeD1,
  createFakeQueue,
  fakeEnv,
  jsonResponse,
  stubNetwork,
  type FakeRoute,
} from "./fakes";
import { FIXTURE_NOW, rawFixtures } from "./fixtures";

const NOW = FIXTURE_NOW;
const ADMIN_ID = 555;
const HOURLY_KEY = computeHourKey(NOW);
const RECIPIENTS = [11, 12, 13];

const HEALTHY = {
  nerkh: () => jsonResponse(rawFixtures.nerkh),
  navasan: () => jsonResponse(rawFixtures.navasan),
  megaweb: () => jsonResponse(rawFixtures.megaweb),
  zipodo: () => jsonResponse(rawFixtures.zipodo),
};

interface StoreState {
  enabled: boolean;
}

function settingsRoutes(state: StoreState): readonly FakeRoute[] {
  return [
    ["SELECT value FROM settings WHERE key", () => ({ first: { value: state.enabled ? "1" : "0" } })],
    [
      "INSERT INTO settings",
      (params) => {
        if (params[0] === "service_enabled") state.enabled = params[1] === "1";
        return { changes: 1 };
      },
    ],
  ];
}

function routes(
  state: StoreState,
  options: { subscribers?: number[]; lastBroadcast?: BroadcastLogRow; claimChanges?: number } = {},
): readonly FakeRoute[] {
  const subscribers = options.subscribers ?? RECIPIENTS;
  return [
    ...settingsRoutes(state),
    ["SELECT COUNT(*) AS n FROM users", { first: { n: subscribers.length } }],
    ["SELECT chat_id, lang FROM users", { all: subscribers.map((chatId) => ({ chat_id: chatId, lang: "fa" })) }],
    ["ORDER BY started_at DESC LIMIT 1", { first: options.lastBroadcast ?? undefined }],
    ["INSERT OR IGNORE INTO broadcast_log", { changes: options.claimChanges ?? 1 }],
    ["UPDATE broadcast_log SET status", { changes: 1 }],
    ["UPDATE broadcast_log", { changes: 1 }],
    ["FROM last_good", { all: [] }],
    ["INSERT INTO snapshots", { lastRowId: 42 }],
  ];
}

function query(data: string, userId = ADMIN_ID): TgCallbackQuery {
  return {
    id: "callback-1",
    from: { id: userId },
    data,
    message: { message_id: 77, chat: { id: userId, type: "private" } },
  } as unknown as TgCallbackQuery;
}

function paramsOf(statements: Array<{ sql: string; params: unknown[] }>, fragment: string): unknown[] | null {
  const found = statements.find((statement) => statement.sql.includes(fragment));
  return found ? found.params : null;
}

function countStatements(statements: Array<{ sql: string }>, fragment: string): number {
  return statements.filter((statement) => statement.sql.includes(fragment)).length;
}

function lastCall(calls: Array<{ text: string; method: string; keyboard: string | null }>) {
  return calls[calls.length - 1];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admin panel rendering", () => {
  it("shows the service state, subscriber count and the last broadcast", () => {
    const text = renderAdminPanel({
      serviceEnabled: true,
      subscribers: 42,
      lastBroadcast: {
        hour_key: HOURLY_KEY,
        started_at: NOW,
        total: 42,
        sent: 40,
        blocked: 1,
        failed: 1,
        status: "done",
      },
    });
    expect(text).toContain("Market Ping admin");
    expect(text).toContain("Service: <b>ON</b>");
    expect(text).toContain("Subscribers: 42");
    expect(text).toContain("Last broadcast: 7 Mehr 1405 10:34 Tehran - sent 40, blocked 1, failed 1");
  });

  it("shows OFF, 'none yet' and flags a broadcast that is not done", () => {
    const empty = renderAdminPanel({ serviceEnabled: false, subscribers: 0, lastBroadcast: null });
    expect(empty).toContain("Service: <b>OFF</b>");
    expect(empty).toContain("Last broadcast: none yet");
    const skipped = renderAdminPanel({
      serviceEnabled: true,
      subscribers: 3,
      lastBroadcast: {
        hour_key: HOURLY_KEY,
        started_at: NOW,
        total: 3,
        sent: 0,
        blocked: 0,
        failed: 0,
        status: "skipped",
      },
    });
    expect(skipped).toContain("[skipped]");
  });

  it("maps the switch button to the current state and keeps the other buttons", () => {
    const on = JSON.stringify(adminPanelKeyboard(true));
    expect(on).toContain(CALLBACK_DATA.adminOff);
    expect(on).not.toContain(`\"${CALLBACK_DATA.adminOn}\"`);
    const off = JSON.stringify(adminPanelKeyboard(false));
    expect(off).toContain(CALLBACK_DATA.adminOn);
    expect(on).toContain(CALLBACK_DATA.adminSend);
    expect(on).toContain(CALLBACK_DATA.adminHealth);
    expect(on).toContain(CALLBACK_DATA.adminRefresh);
    expect(JSON.stringify(sendConfirmKeyboard())).toContain(CALLBACK_DATA.adminSendYes);
    expect(JSON.stringify(sendConfirmKeyboard())).toContain(CALLBACK_DATA.adminSendNo);
  });
});

describe("admin panel callbacks", () => {
  it("gives a non-admin no response at all", async () => {
    const network = stubNetwork({ sources: HEALTHY });
    const state: StoreState = { enabled: true };
    const fake = createFakeD1(routes(state));
    const toast = await handleAdminCallback(
      fakeEnv({ DB: fake.db, ADMIN_IDS: String(ADMIN_ID) }),
      query(CALLBACK_DATA.adminOff, 999),
      CALLBACK_DATA.adminOff,
    );
    expect(toast).toBeNull();
    expect(network.telegramCalls).toHaveLength(0);
    expect(fake.statements).toHaveLength(0);
  });

  it("sends a fresh panel for the /admin command", async () => {
    const network = stubNetwork();
    const state: StoreState = { enabled: true };
    const fake = createFakeD1(routes(state, { subscribers: [] }));
    await sendAdminPanel(fakeEnv({ DB: fake.db }), ADMIN_ID);
    expect(network.telegramCalls).toHaveLength(1);
    expect(network.telegramCalls[0].method).toBe("sendMessage");
    expect(network.telegramCalls[0].text).toContain("Market Ping admin");
    expect(network.telegramCalls[0].keyboard).toContain(CALLBACK_DATA.adminHealth);
  });

  it("turns the service OFF and refreshes the panel in place", async () => {
    const network = stubNetwork();
    const state: StoreState = { enabled: true };
    const fake = createFakeD1(routes(state));
    await handleAdminCallback(fakeEnv({ DB: fake.db, ADMIN_IDS: String(ADMIN_ID) }), query(CALLBACK_DATA.adminOff), CALLBACK_DATA.adminOff);
    expect(paramsOf(fake.statements, "INSERT INTO settings")).toEqual(["service_enabled", "0"]);
    expect(state.enabled).toBe(false);
    const call = lastCall(network.telegramCalls);
    expect(call.method).toBe("editMessageText");
    expect(call.text).toContain("Service: <b>OFF</b>");
    expect(call.keyboard).toContain(CALLBACK_DATA.adminOn);
  });

  it("turns the service ON again", async () => {
    const network = stubNetwork();
    const state: StoreState = { enabled: false };
    const fake = createFakeD1(routes(state));
    await handleAdminCallback(fakeEnv({ DB: fake.db, ADMIN_IDS: String(ADMIN_ID) }), query(CALLBACK_DATA.adminOn), CALLBACK_DATA.adminOn);
    expect(paramsOf(fake.statements, "INSERT INTO settings")).toEqual(["service_enabled", "1"]);
    expect(lastCall(network.telegramCalls).text).toContain("Service: <b>ON</b>");
  });

  it("asks for confirmation before sending", async () => {
    const network = stubNetwork();
    const state: StoreState = { enabled: true };
    const fake = createFakeD1(routes(state));
    const toast = await handleAdminCallback(fakeEnv({ DB: fake.db, ADMIN_IDS: String(ADMIN_ID) }), query(CALLBACK_DATA.adminSend), CALLBACK_DATA.adminSend);
    expect(toast).toBeNull();
    const call = lastCall(network.telegramCalls);
    expect(call.text).toBe("Send prices to 3 subscribers now?");
    expect(call.keyboard).toContain(CALLBACK_DATA.adminSendYes);
    expect(call.keyboard).toContain(CALLBACK_DATA.adminSendNo);
  });

  it("refuses to send while the service is OFF", async () => {
    const network = stubNetwork();
    const state: StoreState = { enabled: false };
    const fake = createFakeD1(routes(state));
    const toast = await handleAdminCallback(fakeEnv({ DB: fake.db, ADMIN_IDS: String(ADMIN_ID) }), query(CALLBACK_DATA.adminSend), CALLBACK_DATA.adminSend);
    expect(toast).toBe(t('en').adminServiceOffToast);
    expect(lastCall(network.telegramCalls).text).toContain("Service: <b>OFF</b>");
  });

  it("cancelling returns to the panel", async () => {
    const network = stubNetwork();
    const state: StoreState = { enabled: true };
    const fake = createFakeD1(routes(state));
    const toast = await handleAdminCallback(fakeEnv({ DB: fake.db, ADMIN_IDS: String(ADMIN_ID) }), query(CALLBACK_DATA.adminSendNo), CALLBACK_DATA.adminSendNo);
    expect(toast).toBe(t('en').adminCancelledToast);
    expect(lastCall(network.telegramCalls).text).toContain("Market Ping admin");
  });

  it("runs the broadcast pipeline under its own manual key on Send now -> Yes", async () => {
    const network = stubNetwork({ sources: HEALTHY });
    const state: StoreState = { enabled: true };
    const fake = createFakeD1(routes(state));
    const queue = createFakeQueue();
    const toast = await handleAdminCallback(
      fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue, ADMIN_IDS: String(ADMIN_ID) }),
      query(CALLBACK_DATA.adminSendYes),
      CALLBACK_DATA.adminSendYes,
    );

    const claim = paramsOf(fake.statements, "INSERT OR IGNORE INTO broadcast_log");
    expect(String(claim?.[0]).startsWith("manual-")).toBe(true);
    expect(String(claim?.[0])).not.toBe(HOURLY_KEY);
    expect(claim?.[2]).toBe(RECIPIENTS.length);
    expect(countStatements(fake.statements, "INSERT INTO snapshots")).toBe(1);
    expect(queue.batches).toHaveLength(1);
    expect(queue.batches[0].flatMap((message) => message.chatIds)).toEqual(RECIPIENTS);
    expect(queue.batches[0].every((message) => message.hourKey === claim?.[0])).toBe(true);
    expect(toast).toBe(t('en').adminSendStartedToast);
    expect(lastCall(network.telegramCalls).text).toContain("Queued for 3 subscribers in 1 chunk");
  });

  it("reports the no-subscriber and no-data cases instead of sending", async () => {
    const state: StoreState = { enabled: true };
    const fakeEmpty = createFakeD1(routes(state, { subscribers: [] }));
    const networkEmpty = stubNetwork({ sources: HEALTHY });
    await handleAdminCallback(
      fakeEnv({ DB: fakeEmpty.db, ADMIN_IDS: String(ADMIN_ID) }),
      query(CALLBACK_DATA.adminSendYes),
      CALLBACK_DATA.adminSendYes,
    );
    expect(lastCall(networkEmpty.telegramCalls).text).toContain(t('en').adminNoSubscribers);
    expect(paramsOf(fakeEmpty.statements, "UPDATE broadcast_log SET status")?.[1]).toBe("done");

    const fakeDown = createFakeD1(routes(state));
    const networkDown = stubNetwork();
    await handleAdminCallback(
      fakeEnv({ DB: fakeDown.db, ADMIN_IDS: String(ADMIN_ID) }),
      query(CALLBACK_DATA.adminSendYes),
      CALLBACK_DATA.adminSendYes,
    );
    expect(lastCall(networkDown.telegramCalls).text).toContain(t('en').adminAllSourcesFailed);
    expect(paramsOf(fakeDown.statements, "UPDATE broadcast_log SET status")?.[1]).toBe("skipped");
  });

  it("shows the live API health view in place, keeping the panel buttons", async () => {
    const network = stubNetwork({ sources: HEALTHY });
    const state: StoreState = { enabled: true };
    const fake = createFakeD1(routes(state));
    await handleAdminCallback(
      fakeEnv({ DB: fake.db, ADMIN_IDS: String(ADMIN_ID) }),
      query(CALLBACK_DATA.adminHealth),
      CALLBACK_DATA.adminHealth,
    );
    const call = lastCall(network.telegramCalls);
    expect(call.method).toBe("editMessageText");
    expect(call.text).toContain("API health");
    expect(call.text).toContain("USD per source");
    expect(call.text).toContain("Tala Garam");
    expect(call.keyboard).toContain(CALLBACK_DATA.adminSend);
  });
});
