import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Keep passing-test log noise out of the way; failing tests still print theirs.
    silent: "passed-only" as const,
    globals: false,
  },
});
