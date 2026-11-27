import { mkdirSync, writeFileSync } from "node:fs";
import pc from "picocolors";
import { APP_VERSION, GREETING, formatBanner, computeChecksum } from "../src/app.mjs";

const sha = process.env.RAIL_COMMIT_SHA || "local";
const shortSha = process.env.RAIL_SHORT_SHA || sha.slice(0, 7);
const builtAt = new Date().toISOString();
const banner = formatBanner(APP_VERSION, shortSha);
const checksum = computeChecksum(`${APP_VERSION}:${sha}`);

const workerCode = `// Built by rail CI from commit ${sha}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        app: "rail-demo-app",
        version: ${JSON.stringify(APP_VERSION)},
        commit: ${JSON.stringify(shortSha)},
        checksum: ${JSON.stringify(checksum)},
        builtAt: ${JSON.stringify(builtAt)}
      });
    }
    return new Response(
      \`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>rail-demo-app v${APP_VERSION}</title><style>body{margin:0;background:#0b0d12;color:#eef1f7;font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;display:grid;place-items:center;min-height:100vh}.box{max-width:640px;padding:1.5rem 2rem;background:#121620;border:1px solid #232a3b;border-radius:12px}h1{margin:0 0 .5rem;font-size:1.15rem;color:#4ade80}p{margin:.35rem 0;color:#94a3b8}strong{color:#eef1f7}a{color:#f9b274}</style></head><body><div class="box"><h1>\${${JSON.stringify(banner)}}</h1><p>version: <strong>${APP_VERSION}</strong> · commit: <strong>${shortSha}</strong> · checksum: <strong>${checksum}</strong></p><p>builtAt: <strong>${builtAt}</strong></p><p><a href="/app/health">/app/health</a> · <a href="/">← rail dashboard</a></p></div></body></html>\`,
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }
};
`;

mkdirSync("dist", { recursive: true });
writeFileSync("dist/worker.js", workerCode);
process.stdout.write(pc.green(`built dist/worker.js (${workerCode.length} bytes) for ${shortSha}\n`));
