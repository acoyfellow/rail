import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_RAIL_URL = "https://rail.customer0.dev";

function railUrl(override?: string): string {
  return (override || process.env.RAIL_URL || DEFAULT_RAIL_URL).replace(/\/+$/, "");
}

async function callMcp(baseUrl: string, name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`rail MCP HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    result?: { content?: Array<{ text?: string }> };
    error?: { message?: string };
  };
  if (data.error) throw new Error(data.error.message || "rail MCP error");
  const text = data.result?.content?.[0]?.text ?? "{}";
  return JSON.parse(text);
}

// Compatible with Pi ExtensionAPI (pi install git:github.com/acoyfellow/rail)
export default function rail(pi: any) {
  pi.registerTool({
    name: "rail_status",
    label: "rail status",
    description:
      "Inspect the live production Worker and recent CI/CD receipts from a rail control plane (defaults to RAIL_URL or https://rail.customer0.dev).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional rail base URL (overrides RAIL_URL)." },
        limit: { type: "number", description: "Number of recent receipts to include (default 5)." },
      },
    },
    async execute(_id: string, params: { url?: string; limit?: number }) {
      const base = railUrl(params?.url);
      const [status, receipts] = await Promise.all([
        callMcp(base, "repo.status"),
        callMcp(base, "repo.receipts", { limit: params?.limit ?? 5 }),
      ]);
      return {
        content: [{ type: "text", text: JSON.stringify({ url: base, status, receipts }, null, 2) }],
      };
    },
  });

  pi.registerTool({
    name: "rail_receipt",
    label: "rail receipt",
    description:
      "Read a full structured rail CI/CD receipt (steps, cache hit/miss, Worker Loader preview gate, deploy status, and nextActionHint).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Receipt ID, or 'latest' to fetch the most recent run." },
        url: { type: "string", description: "Optional rail base URL (overrides RAIL_URL)." },
      },
      required: ["id"],
    },
    async execute(_id: string, params: { id: string; url?: string }) {
      const base = railUrl(params.url);
      let receiptId = params.id;
      if (receiptId === "latest") {
        const list = (await callMcp(base, "repo.receipts", { limit: 1 })) as Array<{ id?: string }>;
        if (!list[0]?.id) throw new Error("No receipts found on " + base);
        receiptId = list[0].id;
      }
      const receipt = await callMcp(base, "repo.receipt", { id: receiptId });
      return { content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "rail_push",
    label: "rail push",
    description:
      "Push the current repo to its Cloudflare Artifacts remote (default 'cf' on branch 'main'), wait for the rail Workflow to finish, and return the verified PASS/FAIL receipt.",
    parameters: {
      type: "object",
      properties: {
        remote: { type: "string", description: "Git remote name (default 'cf')." },
        branch: { type: "string", description: "Branch to push (default 'main')." },
        url: { type: "string", description: "Optional rail base URL (overrides RAIL_URL)." },
        timeoutSec: { type: "number", description: "Max seconds to wait for the receipt (default 120)." },
      },
    },
    async execute(
      _id: string,
      params: { remote?: string; branch?: string; url?: string; timeoutSec?: number },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: { cwd?: string }
    ) {
      const cwd = ctx?.cwd || process.cwd();
      const remote = params?.remote || "cf";
      const branch = params?.branch || "main";
      const base = railUrl(params?.url);
      const timeoutMs = (params?.timeoutSec ?? 120) * 1000;

      const shaRes = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" });
      if (shaRes.status !== 0) throw new Error(`git rev-parse failed: ${shaRes.stderr}`);
      const shortSha = shaRes.stdout.trim();

      const pushRes = spawnSync("git", ["push", remote, branch], { cwd, encoding: "utf8" });
      if (pushRes.status !== 0) throw new Error(`git push ${remote} ${branch} failed: ${pushRes.stderr}`);

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const list = (await callMcp(base, "repo.receipts", { limit: 5 })) as Array<{
          id: string;
          sha: string;
          outcome: string;
        }>;
        const match = list.find((r) => r.sha === shortSha && (r.outcome === "PASS" || r.outcome === "FAIL"));
        if (match) {
          const full = await callMcp(base, "repo.receipt", { id: match.id });
          return { content: [{ type: "text", text: JSON.stringify(full, null, 2) }] };
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      throw new Error(`Timed out waiting for rail receipt for commit ${shortSha} on ${base}`);
    },
  });

  pi.registerTool({
    name: "rail_init",
    label: "rail init",
    description:
      "Create a starter rail.json in the current repo from its package.json scripts so it can be pushed to a rail CI/CD control plane.",
    parameters: {
      type: "object",
      properties: {
        artifact: { type: "string", description: "Built Worker bundle path (default 'dist/worker.js')." },
        healthPath: { type: "string", description: "Preview health probe path (default '/health')." },
      },
    },
    async execute(_id: string, params: { artifact?: string; healthPath?: string }, _s: unknown, _u: unknown, ctx: { cwd?: string }) {
      const cwd = ctx?.cwd || process.cwd();
      const pkgPath = join(cwd, "package.json");
      const checks: Record<string, string> = {};
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
        for (const k of ["lint", "typecheck", "test", "build"]) {
          if (pkg.scripts?.[k]) checks[k] = `npm run ${k}`;
        }
      }
      if (Object.keys(checks).length === 0) {
        checks.lint = "npm run lint";
        checks.typecheck = "npm run typecheck";
        checks.test = "npm run test";
        checks.build = "npm run build";
      }
      const cfg = {
        branch: "main",
        install: "npm ci --no-audit --no-fund",
        lockfiles: ["package.json", "package-lock.json"],
        checks,
        artifact: params?.artifact || "dist/worker.js",
        preview: { healthPath: params?.healthPath || "/health", rootPath: "/" },
      };
      const outPath = join(cwd, "rail.json");
      writeFileSync(outPath, JSON.stringify(cfg, null, 2) + "\n");
      return {
        content: [
          {
            type: "text",
            text: `Wrote ${outPath}.\nNext: point your Cloudflare Artifacts remote ('git remote add cf ...') and call rail_push (or run 'git push cf main').`,
          },
        ],
      };
    },
  });
}
