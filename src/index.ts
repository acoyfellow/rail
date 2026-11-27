import { CiSandbox } from "@cloudflare/ci/worker";
import { handleMcp } from "./mcp";
import { RailDO } from "./rail-do";
import type { Env } from "./types";
import { renderHome, renderReceipt } from "./ui";
import { mirrorGithubPrToArtifacts, mirrorGithubPushToArtifacts, verifyGithubSignature, type GithubPullRequestPayload, type GithubPushPayload } from "./github";
import { RailWorkflow } from "./workflow";

export { CiSandbox, RailDO, RailWorkflow };

async function serveBundle(env: Env, isolateId: string, bundleKey: string, request: Request, stripPrefix: string): Promise<Response> {
  const obj = await env.STORE.get(bundleKey);
  if (!obj) {
    return Response.json({ ok: false, error: `Bundle not found: ${bundleKey}` }, { status: 404 });
  }
  const code = await obj.text();
  const stub = env.LOADER.get(isolateId, async () => ({
    compatibilityDate: "2026-06-16",
    mainModule: "worker.js",
    modules: { "worker.js": code },
    globalOutbound: null,
  }));
  const url = new URL(request.url);
  const subPath = url.pathname.slice(stripPrefix.length) || "/";
  const targetUrl = new URL(subPath + url.search, url.origin);
  return stub.getEntrypoint().fetch(new Request(targetUrl, request));
}

function llmsTxt(env: Env): string {
  return `# rail

> Minimal, owner-operated trunk-based CI/CD loop running entirely on Cloudflare primitives.

- Live: ${env.PUBLIC_ORIGIN}
- Source: https://github.com/acoyfellow/rail
- Live deployed Worker: ${env.PUBLIC_ORIGIN}/app
- MCP endpoint: ${env.PUBLIC_ORIGIN}/mcp (tools: repo.status, repo.receipts, repo.receipt)

## Claim

A developer or agent can \`git push\` to a Cloudflare Artifacts repo and, within one Workflow, get:
- Lockfile-keyed R2 dependency cache (hit/miss recorded)
- Parallel checks in Cloudflare Sandbox (lint, typecheck, test, build)
- Fail-closed gate + Keel-style live preview probe in a network-isolated Worker Loader isolate (globalOutbound=null)
- Atomic promotion in a Durable Object
- Shareable human receipt (/receipt/:id) and machine JSON receipt (/receipt/:id.json)

No GitHub, no external CI, no merge queue, and no container on the control path.
Rollback is a subsequent push of a known-good commit.
`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const activeRepo = url.searchParams.get("repo") || env.ARTIFACTS_REPO;
    const railStub = env.RAIL.get(env.RAIL.idFromName(`${env.ARTIFACTS_NAMESPACE}/${activeRepo}/main`));

    if (path === "/health") {
      return Response.json({ ok: true, service: "rail" });
    }

    if (path === "/llms.txt") {
      return new Response(llmsTxt(env), { headers: { "content-type": "text/plain; charset=utf-8" } });
    }


    // Verified GitHub webhook -> mirrors commit into Cloudflare Artifacts (fires cf.artifacts.repo.pushed)
    if (path === "/webhooks/github" && request.method === "POST") {
      if (!env.GITHUB_WEBHOOK_SECRET) {
        return Response.json({ ok: false, error: "GITHUB_WEBHOOK_SECRET is not configured" }, { status: 501 });
      }
      const rawBody = await request.text();
      const sig = request.headers.get("x-hub-signature-256");
      const valid = await verifyGithubSignature(env.GITHUB_WEBHOOK_SECRET, rawBody, sig);
      if (!valid) {
        return Response.json({ ok: false, error: "invalid_signature" }, { status: 401 });
      }
      const eventType = request.headers.get("x-github-event") || "";
      if (eventType === "ping") {
        return Response.json({ ok: true, pong: true });
      }
      if (eventType === "pull_request") {
        const prPayload = JSON.parse(rawBody) as GithubPullRequestPayload;
        if (!["opened", "synchronize", "reopened"].includes(prPayload.action || "")) {
          return Response.json({ ok: true, ignored: true, reason: `pr_action:${prPayload.action}` });
        }
        const targetRepo = url.searchParams.get("repo") || env.ARTIFACTS_REPO || prPayload.repository?.name || "demo-app";
        const result = await mirrorGithubPrToArtifacts(env, prPayload, targetRepo);
        return Response.json(result, { status: result.ok ? 202 : 500 });
      }
      if (eventType !== "push") {
        return Response.json({ ok: true, ignored: true, reason: `event:${eventType}` });
      }
      const payload = JSON.parse(rawBody) as GithubPushPayload;
      const ref = payload.ref || "";
      if (!ref.startsWith("refs/heads/")) {
        return Response.json({ ok: true, ignored: true, reason: "non_branch_ref" });
      }
      const branch = ref.slice("refs/heads/".length);
      const targetRepo = url.searchParams.get("repo") || env.ARTIFACTS_REPO || payload.repository?.name || "demo-app";
      const result = await mirrorGithubPushToArtifacts(env, payload, targetRepo, branch);
      return Response.json(result, { status: result.ok ? 202 : 500 });
    }

    if (path === "/mcp") {
      return handleMcp(request, env);
    }

    if (path === "/" || path === "") {
      const [production, receipts] = await Promise.all([railStub.getProduction(), railStub.listReceipts(25)]);
      return renderHome(production, receipts, {
        namespace: env.ARTIFACTS_NAMESPACE,
        repo: activeRepo,
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
      });
    }

    if (path.startsWith("/receipt/")) {
      const rest = path.slice("/receipt/".length);
      const isJson = rest.endsWith(".json");
      const id = isJson ? rest.slice(0, -5) : rest;
      if (!id || id.includes("/")) {
        return Response.json({ error: "invalid receipt id" }, { status: 400 });
      }
      const receipt = await railStub.getReceipt(id);
      if (!receipt) {
        return isJson
          ? Response.json({ error: "receipt not found", id }, { status: 404 })
          : new Response("Receipt not found", { status: 404 });
      }
      if (isJson) {
        return Response.json(receipt, { headers: { "cache-control": "public, max-age=10" } });
      }
      return renderReceipt(receipt);
    }

    if (path === "/app" || path.startsWith("/app/")) {
      const prod = await railStub.getProduction();
      if (!prod) {
        return Response.json(
          { ok: false, error: "No production deployment yet. Push a passing commit to main." },
          { status: 503 }
        );
      }
      return serveBundle(env, `prod-${prod.deployId}-${prod.shortSha}`, prod.bundleKey, request, "/app");
    }

    if (path.startsWith("/preview/")) {
      const rest = path.slice("/preview/".length);
      const slash = rest.indexOf("/");
      const sha = slash === -1 ? rest : rest.slice(0, slash);
      if (!/^[a-f0-9]{7,40}$/i.test(sha)) {
        return Response.json({ ok: false, error: "invalid commit sha" }, { status: 400 });
      }
      return serveBundle(env, `preview-live-${sha}`, `deployments/${sha}/worker.js`, request, `/preview/${sha}`);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
