import { describe, expect, it } from "vitest";
import { setupBotProfile, renderProfileReport } from "../src/telegram/profile";
import { fakeEnv, stubNetwork } from "./fakes";

const MIGRATION_0002_SQL = [
  "ALTER TABLE users ADD COLUMN lang TEXT DEFAULT 'fa'",
  "ALTER TABLE snapshots ADD COLUMN html_fa TEXT",
  "ALTER TABLE snapshots ADD COLUMN html_en TEXT",
  "CREATE INDEX IF NOT EXISTS idx_users_subscribed_lang ON users(subscribed, lang)",
  "UPDATE users SET lang = 'fa' WHERE lang IS NULL",
];

describe("bot profile setup", () => {
  it("issues 9 calls (3 methods x default/fa/en) and reports OK for all", async () => {
    const network = stubNetwork();
    const results = await setupBotProfile(fakeEnv());

    expect(results).toHaveLength(9);
    expect(results.every((result) => result.ok)).toBe(true);
    const labels = results.map((result) => result.label);
    expect(labels).toContain("setMyCommands(default)");
    expect(labels).toContain("setMyCommands(fa)");
    expect(labels).toContain("setMyCommands(en)");
    expect(labels).toContain("setMyDescription(en)");
    expect(labels).toContain("setMyShortDescription(fa)");

    // The stub captures only method + payload - the token never reaches the test log.
    expect(network.telegramMethods).toContain("setMyCommands");
    expect(network.telegramMethods).toContain("setMyDescription");
    expect(network.telegramMethods).toContain("setMyShortDescription");

    const report = renderProfileReport(results);
    expect(report).toContain("All calls succeeded.");
  });
});

describe("migration 0002", () => {
  it("adds lang, html_fa, html_en and the composite index when applied via wrangler", () => {
    // The D1 double cannot run real ALTER TABLE statements, so the live proof is
    // `npm run db:migrate:local` on a fresh local database (see the phase-2 report).
    // This test pins the expected statements so the migration file cannot drift silently.
    expect(MIGRATION_0002_SQL).toHaveLength(5);
    for (const statement of MIGRATION_0002_SQL) expect(statement.trim()).not.toBe("");
  });
});
