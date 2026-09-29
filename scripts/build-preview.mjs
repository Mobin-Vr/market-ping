// Dev-only helper: bundles scripts/preview.ts with esbuild (a dependency of wrangler) so the
// message and health panel can be inspected locally. Never part of the deployed Worker.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

await esbuild.build({
  entryPoints: ["scripts/preview.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: ".wrangler/preview.mjs",
  logLevel: "warning",
});

console.log("bundled .wrangler/preview.mjs");
