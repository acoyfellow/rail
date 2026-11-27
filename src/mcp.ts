import type { Env } from "./types";

const TOOLS = [
  {
    name: "repo.status",
    description: "Get the current production deployment and latest CI receipt for the main trunk.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "repo.receipts",
    description: "List recent trunk CI/CD receipts (outcome, commit, cache hit, timings, deployId).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max receipts to return (1-50, default 10)" } },
    },
  },
  {
    name: "repo.receipt",
    description: "Fetch the full structured JSON receipt (steps, exit codes, logs, gate, deploy) by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Receipt id, e.g. rcpt_..." } },
      required: ["id"],
    },
  },
];

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ ok: true, protocol: "mcp-jsonrpc-2.0", tools: TOOLS.map((t) => t.name) });
  }
  const body = (await request.json().catch(() => null)) as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  } | null;
  if (!body || !body.method) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } }, { status: 400 });
  }

  const ok = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id ?? null, result });
  const err = (code: number, message: string) => Response.json({ jsonrpc: "2.0", id: body.id ?? null, error: { code, message } });

  if (body.method === "initialize") {
    return ok({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "rail", version: "0.1.0" },
    });
  }
  if (body.method === "tools/list") {
    return ok({ tools: TOOLS });
  }
  if (body.method === "tools/call") {
    const name = String(body.params?.name ?? "");
    const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
    const railStub = env.RAIL.get(env.RAIL.idFromName(`${env.ARTIFACTS_NAMESPACE}/${env.ARTIFACTS_REPO}/main`));

    if (name === "repo.status") {
      const [production, recent] = await Promise.all([railStub.getProduction(), railStub.listReceipts(1)]);
      return ok({ content: [{ type: "text", text: JSON.stringify({ production, latestReceipt: recent[0] ?? null }, null, 2) }] });
    }
    if (name === "repo.receipts") {
      const limit = typeof args.limit === "number" ? args.limit : 10;
      const list = await railStub.listReceipts(limit);
      const compact = list.map((r) => ({
        id: r.id,
        outcome: r.outcome,
        sha: r.commit.shortSha,
        message: r.commit.message,
        cacheHit: r.cache?.hit ?? null,
        deployed: r.deploy.deployed,
        deployId: r.deploy.deployId ?? null,
        totalMs: r.timings.totalMs ?? null,
        jsonUrl: r.urls.json,
      }));
      return ok({ content: [{ type: "text", text: JSON.stringify(compact, null, 2) }] });
    }
    if (name === "repo.receipt") {
      const id = String(args.id ?? "");
      const receipt = await railStub.getReceipt(id);
      if (!receipt) return err(-32602, `Receipt not found: ${id}`);
      return ok({ content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }] });
    }
    return err(-32601, `Unknown tool: ${name}`);
  }

  return err(-32601, `Method not found: ${body.method}`);
}
