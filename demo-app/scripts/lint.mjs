import { readFileSync } from "node:fs";
import pc from "picocolors";

const files = ["src/app.mjs", "scripts/build.mjs", "scripts/test.mjs"];
const issues = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (src.includes("console.log(")) {
    issues.push(`${file}: stray console.log found`);
  }
  if (src.includes("TODO_FAIL_LINT")) {
    issues.push(`${file}: forbidden marker TODO_FAIL_LINT`);
  }
}
if (issues.length) {
  console.error(pc.red("lint failed:\n" + issues.join("\n")));
  process.exit(1);
}
process.stdout.write(pc.green(`lint passed (${files.length} files clean)\n`));
