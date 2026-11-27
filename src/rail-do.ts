import { DurableObject } from "cloudflare:workers";
import type { Env, ProductionState, Receipt } from "./types";

export class RailDO extends DurableObject<Env> {
  private initialized = false;

  private init() {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        sha TEXT NOT NULL,
        branch TEXT NOT NULL,
        outcome TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        total_ms INTEGER,
        cache_hit INTEGER,
        deploy_id TEXT,
        body_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_receipts_started ON receipts(started_at DESC);

      CREATE TABLE IF NOT EXISTS production (
        slot TEXT PRIMARY KEY,
        body_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        val INTEGER NOT NULL
      );
    `);
    this.initialized = true;
  }

  async saveReceipt(receipt: Receipt): Promise<void> {
    this.init();
    this.ctx.storage.sql.exec(
      `INSERT INTO receipts (id, sha, branch, outcome, started_at, finished_at, total_ms, cache_hit, deploy_id, body_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         outcome = excluded.outcome,
         finished_at = excluded.finished_at,
         total_ms = excluded.total_ms,
         cache_hit = excluded.cache_hit,
         deploy_id = excluded.deploy_id,
         body_json = excluded.body_json`,
      receipt.id,
      receipt.commit.sha,
      receipt.repo.branch,
      receipt.outcome,
      receipt.timings.startedAt,
      receipt.timings.finishedAt ?? null,
      receipt.timings.totalMs ?? null,
      receipt.cache ? (receipt.cache.hit ? 1 : 0) : null,
      receipt.deploy.deployId ?? null,
      JSON.stringify(receipt)
    );
  }

  async getReceipt(id: string): Promise<Receipt | null> {
    this.init();
    const row = this.ctx.storage.sql
      .exec<{ body_json: string }>("SELECT body_json FROM receipts WHERE id = ?", id)
      .toArray()[0];
    return row ? (JSON.parse(row.body_json) as Receipt) : null;
  }

  async listReceipts(limit = 30): Promise<Receipt[]> {
    this.init();
    const rows = this.ctx.storage.sql
      .exec<{ body_json: string }>(
        "SELECT body_json FROM receipts ORDER BY started_at DESC LIMIT ?",
        Math.min(Math.max(limit, 1), 100)
      )
      .toArray();
    return rows.map((r) => JSON.parse(r.body_json) as Receipt);
  }

  async promote(input: {
    sha: string;
    receiptId: string;
    bundleKey: string;
    commitMessage: string;
    author: string;
  }): Promise<ProductionState> {
    this.init();
    const current = this.ctx.storage.sql
      .exec<{ val: number }>("SELECT val FROM counters WHERE name = 'deploy'")
      .toArray()[0];
    const next = (current?.val ?? 0) + 1;
    this.ctx.storage.sql.exec(
      `INSERT INTO counters (name, val) VALUES ('deploy', ?)
       ON CONFLICT(name) DO UPDATE SET val = excluded.val`,
      next
    );
    const deployId = `dep_${String(next).padStart(4, "0")}`;
    const state: ProductionState = {
      sha: input.sha,
      shortSha: input.sha.slice(0, 7),
      deployId,
      receiptId: input.receiptId,
      bundleKey: input.bundleKey,
      commitMessage: input.commitMessage,
      author: input.author,
      promotedAt: new Date().toISOString(),
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO production (slot, body_json) VALUES ('main', ?)
       ON CONFLICT(slot) DO UPDATE SET body_json = excluded.body_json`,
      JSON.stringify(state)
    );
    return state;
  }

  async getProduction(): Promise<ProductionState | null> {
    this.init();
    const row = this.ctx.storage.sql
      .exec<{ body_json: string }>("SELECT body_json FROM production WHERE slot = 'main'")
      .toArray()[0];
    return row ? (JSON.parse(row.body_json) as ProductionState) : null;
  }
}
