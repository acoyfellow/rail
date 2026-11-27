import type { ProductionState, Receipt } from "./types";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtMs = (ms?: number) => {
  if (ms === undefined || ms === null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
};

const CSS = `
:root{--bg:#0b0d12;--surf:#121620;--surf2:#181e2c;--line:#232a3b;--fg:#eef1f7;--mut:#8e9ab0;--brand:#f6821f;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:#f9b274;text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1040px;margin:0 auto;padding:1.5rem 1.25rem 3rem;display:flex;flex-direction:column;gap:1.15rem}
.head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:1rem}
.pills{display:flex;flex-wrap:wrap;gap:.45rem;margin-bottom:.45rem}
.pill{font:600 11px/1 var(--mono);padding:.28rem .55rem;border-radius:999px;border:1px solid var(--line);background:var(--surf);color:var(--mut)}
.pill.brand{color:#ffb067;border-color:rgba(246,130,31,.4);background:rgba(246,130,31,.12)}
.pill.pass{color:var(--good);border-color:rgba(74,222,128,.35);background:rgba(74,222,128,.1)}
.pill.fail{color:var(--bad);border-color:rgba(248,113,113,.4);background:rgba(248,113,113,.12)}
.pill.run{color:var(--warn);border-color:rgba(251,191,36,.35);background:rgba(251,191,36,.1)}
h1{margin:0;font-size:clamp(1.35rem,2.4vw,1.8rem);letter-spacing:-.025em;line-height:1.2}
h2{margin:0 0 .6rem;font-size:.95rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);font-family:var(--mono)}
.sub{margin:.35rem 0 0;color:var(--mut);max-width:68ch}
.card{background:var(--surf);border:1px solid var(--line);border-radius:12px;padding:1rem 1.15rem}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:.35rem 1rem;margin:0;font-size:.86rem}
.kv dt{color:var(--mut);font-family:var(--mono);font-size:.78rem}.kv dd{margin:0;word-break:break-word}
code,pre{font-family:var(--mono)}
.cmd{margin:0;padding:.7rem .85rem;background:var(--bg);border:1px solid var(--line);border-radius:8px;overflow-x:auto;font-size:.8rem;color:#cbd5e1}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{text-align:left;color:var(--mut);font:600 11px/1.2 var(--mono);text-transform:uppercase;letter-spacing:.05em;padding:.55rem .6rem;border-bottom:1px solid var(--line)}
td{padding:.6rem;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
.mono{font-family:var(--mono);font-size:.8rem}
.steps{display:flex;flex-wrap:wrap;gap:.3rem}
.st{font:600 11px/1 var(--mono);padding:.2rem .42rem;border-radius:5px;border:1px solid var(--line);background:var(--bg)}
.st.pass{color:var(--good);border-color:rgba(74,222,128,.3)}
.st.fail{color:var(--bad);border-color:rgba(248,113,113,.45);background:rgba(248,113,113,.1)}
details{margin-top:.35rem}
summary{cursor:pointer;color:var(--mut);font-size:.78rem;font-family:var(--mono)}
.log{margin:.4rem 0 0;padding:.65rem;background:var(--bg);border:1px solid var(--line);border-radius:8px;font-size:.75rem;line-height:1.4;white-space:pre-wrap;overflow-x:auto;color:#cbd5e1;max-height:260px}
.log.err{color:#fecaca;border-color:rgba(248,113,113,.35)}
.pipe{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;font:12px var(--mono);color:var(--mut)}
.pipe span{padding:.25rem .5rem;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--fg)}
.foot{padding-top:.75rem;border-top:1px solid var(--line);color:var(--mut);font-size:.78rem;display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem}
@media (max-width:720px){.grid2{grid-template-columns:minmax(0,1fr)}}
`;

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">${body}</div></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function outcomePill(outcome: Receipt["outcome"]): string {
  const cls = outcome === "PASS" ? "pass" : outcome === "FAIL" ? "fail" : "run";
  return `<span class="pill ${cls}">${esc(outcome)}</span>`;
}

export function renderHome(
  production: ProductionState | null,
  receipts: Receipt[],
  repoInfo: { namespace: string; repo: string; accountId: string }
): Response {
  const prodCard = production
    ? `<dl class="kv">
        <dt>status</dt><dd><span class="pill pass">LIVE</span> <a href="/app">open /app ↗</a></dd>
        <dt>deployId</dt><dd class="mono">${esc(production.deployId)}</dd>
        <dt>commit</dt><dd class="mono">${esc(production.shortSha)} — ${esc(production.commitMessage)}</dd>
        <dt>author</dt><dd>${esc(production.author)}</dd>
        <dt>promoted</dt><dd class="mono">${esc(production.promotedAt)}</dd>
        <dt>receipt</dt><dd><a href="/receipt/${esc(production.receiptId)}">${esc(production.receiptId)}</a> · <a href="/receipt/${esc(production.receiptId)}.json">.json</a></dd>
      </dl>`
    : `<p class="sub">No production deployment promoted yet. Push a passing commit to <code>main</code> to trigger the first run.</p>`;

  const rows = receipts.length
    ? receipts
        .map((r) => {
          const stepBadges = r.steps
            .map((s) => `<span class="st ${s.status}">${esc(s.name)}:${s.exitCode}</span>`)
            .join("");
          const previewBadge = r.gate?.preview
            ? `<span class="st ${r.gate.preview.passed ? "pass" : "fail"}">preview:${r.gate.preview.healthStatus ?? "err"}</span>`
            : "";
          const cacheText = r.cache
            ? `<span class="st ${r.cache.hit ? "pass" : ""}">${r.cache.hit ? "HIT" : "MISS"}</span>`
            : "—";
          return `<tr>
            <td>${outcomePill(r.outcome)}</td>
            <td><div class="mono"><strong>${esc(r.commit.shortSha)}</strong></div><div>${esc(r.commit.message)}</div><div class="mono" style="color:var(--mut);font-size:.74rem">${esc(r.commit.author)}</div></td>
            <td>${cacheText}</td>
            <td><div class="steps">${stepBadges}${previewBadge}</div></td>
            <td class="mono">${fmtMs(r.timings.totalMs)}</td>
            <td class="mono">${r.deploy.deployed ? esc(r.deploy.deployId) : '<span style="color:var(--bad)">refused</span>'}</td>
            <td class="mono"><a href="/receipt/${esc(r.id)}">human</a> · <a href="/receipt/${esc(r.id)}.json">json</a></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="7" style="color:var(--mut)">No receipts yet. Push to the Artifacts repo to trigger <code>cf.artifacts.repo.pushed</code>.</td></tr>`;

  const body = `
  <header class="head">
    <div>
      <div class="pills">
        <span class="pill brand">rail · trunk CI/CD</span>
        <span class="pill">0 external CI</span>
        <span class="pill">0 containers on control path</span>
      </div>
      <h1>Push to Artifacts. Green ships. Red refuses.</h1>
      <p class="sub">
        Owner-operated trunk-based CI/CD running entirely on Cloudflare primitives:
        <strong>Artifacts</strong> (Git remote + <code>cf.artifacts.repo.pushed</code>),
        <strong>Workflows</strong> + <strong>Sandbox</strong> (R2 lockfile cache + parallel checks),
        <strong>Worker Loader</strong> (network-isolated preview gate), and a <strong>Durable Object</strong> (atomic promotion + receipt index).
      </p>
    </div>
  </header>

  <section class="card">
    <h2>Control &amp; Execution Path</h2>
    <div class="pipe">
      <span>git push main</span> →
      <span>cf.artifacts.repo.pushed</span> →
      <span>Workflow</span> →
      <span>R2 lockfile cache</span> →
      <span>4× parallel Sandbox</span> →
      <span>Worker Loader preview (globalOutbound=null)</span> →
      <span>DO atomic promote</span> →
      <span>/receipt/:id + .json</span>
    </div>
  </section>

  <div class="grid2">
    <section class="card">
      <h2>Live Production Worker (/app)</h2>
      ${prodCard}
    </section>
    <section class="card">
      <h2>Artifacts Remote &amp; Agent Surface</h2>
      <pre class="cmd">git remote add cf https://${esc(repoInfo.accountId)}.artifacts.cloudflare.net/git/${esc(repoInfo.namespace)}/${esc(repoInfo.repo)}.git
git push cf main</pre>
      <p class="sub" style="margin-top:.65rem;font-size:.82rem">
        Agent MCP endpoint: <a href="/mcp"><code>/mcp</code></a> (<code>repo.status</code>, <code>repo.receipts</code>, <code>repo.receipt</code>) ·
        <a href="/llms.txt"><code>/llms.txt</code></a> ·
        Rollback = push a known-good commit.
      </p>
    </section>
  </div>

  <section class="card">
    <h2>Receipts (${receipts.length})</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Outcome</th><th>Commit</th><th>Cache</th><th>Checks &amp; Gate</th><th>Total</th><th>Deploy</th><th>Receipt</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>

  <footer class="foot">
    <span><a href="https://github.com/acoyfellow/rail">github.com/acoyfellow/rail</a> · <a href="https://customer0.dev">customer0.dev</a></span>
    <span>MIT · Built purely on Cloudflare primitives</span>
  </footer>`;

  return page("rail · trunk CI/CD on Cloudflare", body);
}

export function renderReceipt(r: Receipt): Response {
  const stepRows = r.steps
    .map(
      (s) => `<tr>
      <td class="mono"><strong>${esc(s.name)}</strong>${s.parallelGroup ? `<div style="color:var(--mut);font-size:.72rem">parallel:${esc(s.parallelGroup)}</div>` : ""}</td>
      <td><span class="st ${s.status}">${esc(s.status.toUpperCase())} (${s.exitCode})</span></td>
      <td class="mono">${fmtMs(s.durationMs)}</td>
      <td>
        <div class="mono" style="font-size:.78rem">${esc(s.command)}</div>
        ${s.stdout ? `<details ${s.status === "fail" ? "open" : ""}><summary>stdout (${s.stdout.length} chars)</summary><pre class="log">${esc(s.stdout)}</pre></details>` : ""}
        ${s.stderr ? `<details open><summary>stderr (${s.stderr.length} chars)</summary><pre class="log err">${esc(s.stderr)}</pre></details>` : ""}
      </td>
    </tr>`
    )
    .join("");

  const previewHtml = r.gate?.preview
    ? `<dl class="kv">
        <dt>isolateId</dt><dd class="mono">${esc(r.gate.preview.isolateId)}</dd>
        <dt>globalOutbound</dt><dd class="mono">${esc(r.gate.preview.globalOutbound)}</dd>
        <dt>GET /health</dt><dd class="mono">${esc(r.gate.preview.healthStatus ?? "error")} — ${esc(r.gate.preview.healthBody ?? r.gate.preview.error ?? "")}</dd>
        <dt>GET /</dt><dd class="mono">${esc(r.gate.preview.rootStatus ?? "error")}</dd>
        <dt>duration</dt><dd class="mono">${fmtMs(r.gate.preview.durationMs)}</dd>
      </dl>`
    : `<p class="sub">Not executed (gate failed closed during checks).</p>`;

  const body = `
  <header class="head">
    <div>
      <div class="pills">
        <a class="pill" href="/">← all receipts</a>
        ${outcomePill(r.outcome)}
        <span class="pill">${esc(r.schemaVersion)}</span>
        <a class="pill brand" href="/receipt/${esc(r.id)}.json">view .json ↗</a>
      </div>
      <h1>Receipt ${esc(r.id)}</h1>
      <p class="sub mono">${esc(r.repo.namespace)}/${esc(r.repo.name)}@${esc(r.repo.branch)} · ${esc(r.commit.shortSha)} — ${esc(r.commit.message)}</p>
    </div>
  </header>

  <div class="grid2">
    <section class="card">
      <h2>Commit &amp; Timings</h2>
      <dl class="kv">
        <dt>sha</dt><dd class="mono">${esc(r.commit.sha)}</dd>
        <dt>before</dt><dd class="mono">${esc(r.commit.beforeSha)}</dd>
        <dt>author</dt><dd>${esc(r.commit.author)}</dd>
        <dt>workflowId</dt><dd class="mono">${esc(r.workflowInstanceId)}</dd>
        <dt>startedAt</dt><dd class="mono">${esc(r.timings.startedAt)}</dd>
        <dt>finishedAt</dt><dd class="mono">${esc(r.timings.finishedAt ?? "running")}</dd>
        <dt>totalMs</dt><dd class="mono">${fmtMs(r.timings.totalMs)}</dd>
      </dl>
    </section>

    <section class="card">
      <h2>Gate, Cache &amp; Deploy</h2>
      <dl class="kv">
        <dt>cache</dt><dd class="mono">${r.cache ? `${r.cache.hit ? "HIT" : "MISS"} · lockfile ${esc(r.cache.lockfileHash)} · ${r.cache.bytes} B · ${fmtMs(r.cache.durationMs)}` : "—"}</dd>
        <dt>gate</dt><dd class="mono">${r.gate ? `${r.gate.passed ? "PASSED" : "FAILED CLOSED"} (${esc(r.gate.reason)})` : "pending"}</dd>
        <dt>deployed</dt><dd class="mono">${r.deploy.deployed ? `YES · ${esc(r.deploy.deployId)} · <a href="/app">/app ↗</a>` : "NO (production unchanged)"}</dd>
        <dt>nextAction</dt><dd class="mono">${esc(r.nextActionHint ?? "—")}</dd>
        <dt>capabilities</dt><dd class="mono" style="font-size:.74rem">${r.capabilities.map(esc).join("<br>")}</dd>
      </dl>
    </section>
  </div>

  <section class="card">
    <h2>Pipeline Steps (${r.steps.length})</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Step</th><th>Exit</th><th>Duration</th><th>Command &amp; Evidence</th></tr></thead>
        <tbody>${stepRows}</tbody>
      </table>
    </div>
  </section>

  <section class="card">
    <h2>Keel-Style Preview Gate (Worker Loader Isolate)</h2>
    ${previewHtml}
  </section>

  <footer class="foot">
    <span><a href="/">← rail.customer0.dev</a></span>
    <span><a href="/receipt/${esc(r.id)}.json">Machine-readable JSON receipt</a></span>
  </footer>`;

  return page(`receipt ${r.id} · ${r.outcome}`, body);
}
