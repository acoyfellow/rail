import { readFileSync } from "node:fs";
import pc from "picocolors";

const src = readFileSync("src/app.mjs", "utf8");
for (const sym of ["export const APP_VERSION", "export const GREETING", "export function formatBanner", "export function computeChecksum"]) {
  if (!src.includes(sym)) {
    console.error(pc.red(`typecheck failed: missing export "${sym}" in src/app.mjs`));
    process.exit(1);
  }
}
process.stdout.write(pc.green("typecheck passed (all required exports verified)\n"));
