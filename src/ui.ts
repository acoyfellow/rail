import type { ProductionState, Receipt } from "./types";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtMs = (ms?: number) => {
  if (ms === undefined || ms === null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};

const CSS = `
:root{
  --bg:#090b10;--surf:#111520;--surf2:#171d2c;--line:#1f2738;--line-hi:#2f3b54;
  --fg:#f1f5f9;--mut:#94a3b8;--brand:#f6821f;--brand-soft:rgba(246,130,31,.13);
  --good:#4ade80;--good-soft:rgba(74,222,128,.12);
  --bad:#f87171;--bad-soft:rgba(248,113,113,.12);
  --warn:#fbbf24;--warn-soft:rgba(251,191,36,.12);
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:#f9b274;text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:960px;margin:0 auto;padding:2.5rem 1.25rem 4rem;display:flex;flex-direction:column;gap:2.5rem}

/* Top nav */
.nav{display:flex;align-items:center;justify-content:space-between;gap:1rem;font-size:.86rem}
.logo{display:inline-flex;align-items:center;gap:.5rem;font-weight:700;color:var(--fg);letter-spacing:-.01em}
.logo:hover{text-decoration:none}
.logo-dot{width:9px;height:9px;border-radius:50%;background:var(--brand);box-shadow:0 0 12px var(--brand)}
.nav-links{display:flex;align-items:center;gap:1.1rem;color:var(--mut)}
.nav-links a{color:var(--mut)}.nav-links a:hover{color:var(--fg);text-decoration:none}

/* Hero */
.hero{display:flex;flex-direction:column;gap:1.1rem;padding:1rem 0 .5rem}
.eyebrow{font:600 12px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:#ffb067}
.hero h1{margin:0;font-size:clamp(2rem,4.5vw,3rem);font-weight:750;letter-spacing:-.035em;line-height:1.1;max-width:18ch}
.hero p{margin:0;font-size:1.05rem;color:var(--mut);max-width:58ch;line-height:1.6}
.cta-row{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin-top:.35rem}
.btn{display:inline-flex;align-items:center;gap:.45rem;padding:.65rem 1.1rem;border-radius:10px;font:600 .9rem/1 inherit;border:1px solid var(--line-hi);background:var(--surf);color:var(--fg);cursor:pointer;transition:background .15s,border-color .15s}
.btn:hover{background:var(--surf2);border-color:#425273;text-decoration:none}
.btn.primary{background:var(--brand);border-color:var(--brand);color:#111}
.btn.primary:hover{background:#ff9436;border-color:#ff9436}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--good)}

/* Section titles */
.sec-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.5rem;margin-bottom:1rem}
.sec-head h2{margin:0;font-size:1.15rem;font-weight:650;letter-spacing:-.015em;color:var(--fg)}
.sec-head p{margin:0;font-size:.88rem;color:var(--mut)}

/* 4-step How it works */
.steps4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.85rem}
.step-card{background:var(--surf);border:1px solid var(--line);border-radius:12px;padding:1.05rem 1.1rem;display:flex;flex-direction:column;gap:.45rem}
.step-n{font:600 11px/1 var(--mono);color:#ffb067;letter-spacing:.06em}
.step-card strong{font-size:.95rem;color:var(--fg)}
.step-card span{font-size:.84rem;color:var(--mut);line-height:1.45}

/* Adopt tabs card */
.card{background:var(--surf);border:1px solid var(--line);border-radius:14px;padding:1.25rem 1.35rem}
.tabs{display:inline-flex;flex-wrap:wrap;gap:4px;background:var(--bg);padding:4px;border-radius:10px;border:1px solid var(--line);margin-bottom:1.15rem}
.tab{border:0;background:transparent;color:var(--mut);font:500 .84rem/1 inherit;padding:.5rem .85rem;border-radius:7px;cursor:pointer;transition:background .12s,color .12s}
.tab:hover{color:var(--fg)}
.tab.active{background:var(--surf2);color:var(--fg);box-shadow:inset 0 0 0 1px var(--line-hi)}
.pane{display:none;flex-direction:column;gap:1rem}
.pane.active{display:flex}
.step-line{display:flex;flex-direction:column;gap:.4rem}
.step-label{font-size:.88rem;color:var(--mut)}.step-label strong{color:var(--fg)}
.code-box{position:relative}
.cmd{margin:0;padding:.85rem 3.5rem .85rem 1rem;background:var(--bg);border:1px solid var(--line);border-radius:10px;overflow-x:auto;font:13px/1.55 var(--mono);color:#d6e2ff}
.copy-btn{position:absolute;top:.55rem;right:.55rem;background:var(--surf2);color:var(--mut);border:1px solid var(--line-hi);border-radius:6px;padding:.28rem .55rem;font:500 11px/1 var(--mono);cursor:pointer}
.copy-btn:hover{color:var(--fg);border-color:#4b5e82}

/* Live production banner */
.prod-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.85rem;padding:1rem 1.2rem;background:linear-gradient(90deg,rgba(74,222,128,.08),rgba(17,21,32,1) 60%);border:1px solid rgba(74,222,128,.28);border-radius:12px;margin-bottom:1rem}
.prod-info{display:flex;flex-wrap:wrap;align-items:center;gap:.65rem;font-size:.9rem}
.prod-links{display:flex;align-items:center;gap:.85rem;font-size:.85rem}

/* Clean receipt feed */
.feed{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surf)}
.feed-row{display:grid;grid-template-columns:82px minmax(0,1fr) auto auto auto;align-items:center;gap:.85rem 1rem;padding:.85rem 1.1rem;border-bottom:1px solid var(--line)}
.feed-row:last-child{border-bottom:0}
.feed-msg{min-width:0}
.feed-title{font-weight:500;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.feed-sub{font:12px var(--mono);color:var(--mut);margin-top:2px}
.feed-links{display:flex;gap:.6rem;font:12.5px var(--mono);white-space:nowrap}

/* Badges / pills */
.pill{display:inline-flex;align-items:center;gap:.35rem;font:600 11px/1 var(--mono);padding:.3rem .55rem;border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--mut);white-space:nowrap}
.pill.brand{color:#ffb067;border-color:rgba(246,130,31,.4);background:var(--brand-soft)}
.pill.pass{color:var(--good);border-color:rgba(74,222,128,.35);background:var(--good-soft)}
.pill.fail{color:var(--bad);border-color:rgba(248,113,113,.4);background:var(--bad-soft)}
.pill.run{color:var(--warn);border-color:rgba(251,191,36,.35);background:var(--warn-soft)}

/* Agent strip */
.agent-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem;padding:.9rem 1.15rem;background:var(--surf);border:1px solid var(--line);border-radius:12px;font-size:.85rem;color:var(--mut)}
.agent-bar code{font-family:var(--mono);color:var(--fg);font-size:.82rem}

/* Receipt detail page styles */
.head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:1rem}
.pills{display:flex;flex-wrap:wrap;gap:.45rem;margin-bottom:.5rem}
.sub{margin:.35rem 0 0;color:var(--mut);max-width:68ch}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:.4rem 1rem;margin:0;font-size:.88rem}
.kv dt{color:var(--mut);font-family:var(--mono);font-size:.78rem}.kv dd{margin:0;word-break:break-word}
code,pre{font-family:var(--mono)}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.86rem}
th{text-align:left;color:var(--mut);font:600 11px/1.2 var(--mono);text-transform:uppercase;letter-spacing:.05em;padding:.6rem;border-bottom:1px solid var(--line)}
td{padding:.65rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
.mono{font-family:var(--mono);font-size:.82rem}
.st{font:600 11px/1 var(--mono);padding:.22rem .45rem;border-radius:5px;border:1px solid var(--line);background:var(--bg)}
.st.pass{color:var(--good);border-color:rgba(74,222,128,.3)}
.st.fail{color:var(--bad);border-color:rgba(248,113,113,.45);background:var(--bad-soft)}
details{margin-top:.35rem}
summary{cursor:pointer;color:var(--mut);font-size:.78rem;font-family:var(--mono)}
.log{margin:.4rem 0 0;padding:.7rem;background:var(--bg);border:1px solid var(--line);border-radius:8px;font-size:.76rem;line-height:1.45;white-space:pre-wrap;overflow-x:auto;color:#cbd5e1;max-height:260px}
.log.err{color:#fecaca;border-color:rgba(248,113,113,.35)}

.foot{padding-top:1rem;border-top:1px solid var(--line);color:var(--mut);font-size:.82rem;display:flex;flex-wrap:wrap;justify-content:space-between;gap:.6rem}

@media (max-width:800px){
  .steps4{grid-template-columns:repeat(2,minmax(0,1fr))}
  .feed-row{grid-template-columns:76px minmax(0,1fr);gap:.45rem .75rem}
  .feed-meta,.feed-time,.feed-links{grid-column:2}
  .grid2{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:520px){
  .wrap{padding:1.5rem 1rem 3rem;gap:2rem}
  .steps4{grid-template-columns:minmax(0,1fr)}
}
`;

const HOME_SCRIPT = `
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + id));
  });
});
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = btn.parentElement.querySelector('pre').innerText;
    try { await navigator.clipboard.writeText(text); btn.textContent = 'copied'; setTimeout(() => btn.textContent = 'copy', 1400); } catch {}
  });
});
`;

function page(title: string, body: string, script = ""): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">${body}</div>${script ? `<script>${script}</script>` : ""}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function outcomePill(outcome: Receipt["outcome"]): string {
  const cls = outcome === "PASS" ? "pass" : outcome === "FAIL" ? "fail" : "run";
  return `<span class="pill ${cls}">${esc(outcome)}</span>`;
}

function codeBlock(code: string): string {
  return `<div class="code-box"><button class="copy-btn" type="button">copy</button><pre class="cmd">${esc(code)}</pre></div>`;
}

export function renderHome(
  production: ProductionState | null,
  receipts: Receipt[],
  repoInfo: { namespace: string; repo: string; accountId: string }
): Response {
  // Show completed receipts first so the homepage stays clean and legible
  const visibleReceipts = receipts.filter((r) => r.outcome !== "RUNNING").slice(0, 8);

  const prodBar = production
    ? `<div class="prod-bar">
        <div class="prod-info">
          <span class="pill pass"><span class="live-dot"></span>LIVE</span>
          <strong class="mono">${esc(production.deployId)}</strong>
          <span>${esc(production.commitMessage)}</span>
          <span class="mono" style="color:var(--mut)">(${esc(production.shortSha)})</span>
        </div>
        <div class="prod-links">
          <a href="/app">Open live /app ↗</a>
          <a href="/receipt/${esc(production.receiptId)}">Receipt →</a>
        </div>
      </div>`
    : `<div class="prod-bar"><div class="prod-info">No production build promoted yet. Push to <code>main</code> to run the pipeline.</div></div>`;

  const feedRows = visibleReceipts.length
    ? visibleReceipts
        .map((r) => {
          const cachePill = r.cache
            ? `<span class="pill ${r.cache.hit ? "pass" : ""}">cache ${r.cache.hit ? "HIT" : "MISS"}</span>`
            : "";
          const deployPill = r.deploy.deployed
            ? `<span class="pill">${esc(r.deploy.deployId)}</span>`
            : `<span class="pill fail">deploy refused</span>`;
          return `<div class="feed-row">
            <div>${outcomePill(r.outcome)}</div>
            <div class="feed-msg">
              <div class="feed-title">${esc(r.commit.message.split("\n")[0])}</div>
              <div class="feed-sub">${esc(r.commit.shortSha)} · ${esc(r.commit.author)}${r.configSource ? ` · ${esc(r.configSource)}` : ""}</div>
            </div>
            <div class="feed-meta" style="display:flex;gap:.4rem;flex-wrap:wrap">${cachePill}${deployPill}</div>
            <div class="feed-time mono" style="color:var(--mut)">${fmtMs(r.timings.totalMs)}</div>
            <div class="feed-links">
              <a href="/receipt/${esc(r.id)}">receipt</a>
              <a href="/receipt/${esc(r.id)}.json">.json</a>
            </div>
          </div>`;
        })
        .join("")
    : `<div class="feed-row"><div style="grid-column:1/-1;color:var(--mut)">No completed receipts yet.</div></div>`;

  const existingStep1 = `git clone https://github.com/acoyfellow/rail && cd rail && bun install
bun run init -- \\
  --account <CF_ACCOUNT_ID> \\
  --namespace <NAMESPACE> \\
  --repo <APP_NAME> \\
  --app-dir ../my-existing-app`;

  const existingStep2 = `wrangler deploy`;

  const existingStep3 = `cd ../my-existing-app
git remote add cf https://<CF_ACCOUNT_ID>.artifacts.cloudflare.net/git/<NAMESPACE>/<APP_NAME>.git
git push cf main`;

  const newAppCmd = `git clone https://github.com/acoyfellow/rail && cd rail && bun install
cp -r demo-app ../my-new-app
cd ../my-new-app && git init -b main && git add -A && git commit -m "init"

cd ../rail
bun run init -- --account <CF_ACCOUNT_ID> --namespace <NAMESPACE> --repo my-new-app --app-dir ../my-new-app
wrangler deploy`;

  const railJsonExample = `{
  "branch": "main",
  "install": "npm ci --no-audit --no-fund",
  "checks": {
    "lint": "npm run lint",
    "typecheck": "npm run typecheck",
    "test": "npm run test",
    "build": "npm run build"
  },
  "artifact": "dist/worker.js",
  "preview": { "healthPath": "/health", "rootPath": "/" }
}`;

  const body = `
  <nav class="nav">
    <a class="logo" href="/"><span class="logo-dot"></span>rail</a>
    <div class="nav-links">
      <a href="#how">How it works</a>
      <a href="#adopt">Add to your app</a>
      <a href="#live">Live receipts</a>
      <a href="https://github.com/acoyfellow/rail" target="_blank" rel="noopener">GitHub ↗</a>
    </div>
  </nav>

  <header class="hero">
    <span class="eyebrow">Cloudflare-native trunk CI/CD</span>
    <h1><code>git push</code> to deploy. No GitHub Actions.</h1>
    <p>
      Push straight to Cloudflare Artifacts. One Workflow caches dependencies in R2, runs your checks in parallel Sandboxes,
      tests the built Worker in a live preview isolate, promotes green commits automatically, and leaves a shareable receipt.
    </p>
    <div class="cta-row">
      <a class="btn primary" href="#adopt">Add to your app →</a>
      <a class="btn" href="/app"><span class="live-dot"></span>Live deployed app${production ? ` (${esc(production.deployId)})` : ""} ↗</a>
      <a class="btn" href="https://github.com/acoyfellow/rail" target="_blank" rel="noopener">Source on GitHub</a>
    </div>
  </header>

  <section id="how">
    <div class="sec-head">
      <h2>How it works</h2>
      <p>Zero external CI · zero merge queue · zero containers on the control path</p>
    </div>
    <div class="steps4">
      <div class="step-card">
        <span class="step-n">01 · PUSH</span>
        <strong>Artifacts triggers CI</strong>
        <span><code>git push</code> to <code>main</code> fires <code>cf.artifacts.repo.pushed</code> directly into a Workflow.</span>
      </div>
      <div class="step-card">
        <span class="step-n">02 · CHECK</span>
        <strong>Cached &amp; parallel</strong>
        <span>R2 caches <code>node_modules</code> by lockfile hash; 4 Sandboxes run lint, types, tests, and build in parallel.</span>
      </div>
      <div class="step-card">
        <span class="step-n">03 · VERIFY</span>
        <strong>Isolated preview gate</strong>
        <span>The candidate bundle boots in a Worker Loader isolate (<code>globalOutbound: null</code>) and must pass <code>/health</code>.</span>
      </div>
      <div class="step-card">
        <span class="step-n">04 · SHIP OR STOP</span>
        <strong>Fail-closed + receipt</strong>
        <span>Green promotes atomically in a Durable Object. Red refuses deploy. Rollback is just another push.</span>
      </div>
    </div>
  </section>

  <section id="adopt">
    <div class="sec-head">
      <h2>Add rail to your app</h2>
      <p>Works with any existing repo or a brand-new Worker in under 2 minutes</p>
    </div>
    <div class="card">
      <div class="tabs" role="tablist">
        <button class="tab active" type="button" data-tab="existing">Existing app</button>
        <button class="tab" type="button" data-tab="new">New app from scratch</button>
        <button class="tab" type="button" data-tab="config">rail.json (optional)</button>
      </div>

      <div class="pane active" id="pane-existing">
        <div class="step-line">
          <span class="step-label"><strong>1. Provision &amp; wire your repo</strong> — creates the R2 bucket, Artifacts repo, <code>wrangler.jsonc</code>, and starter <code>rail.json</code>:</span>
          ${codeBlock(existingStep1)}
        </div>
        <div class="step-line">
          <span class="step-label"><strong>2. Deploy your rail control plane:</strong></span>
          ${codeBlock(existingStep2)}
        </div>
        <div class="step-line">
          <span class="step-label"><strong>3. Push your app</strong> — green builds deploy automatically; red builds fail closed:</span>
          ${codeBlock(existingStep3)}
        </div>
      </div>

      <div class="pane" id="pane-new">
        <div class="step-line">
          <span class="step-label">Start from the minimal <code>demo-app/</code> Worker template (includes <code>lint</code>, <code>typecheck</code>, <code>test</code>, <code>build</code>, and <code>/health</code>):</span>
          ${codeBlock(newAppCmd)}
        </div>
      </div>

      <div class="pane" id="pane-config">
        <div class="step-line">
          <span class="step-label">If omitted, rail auto-detects scripts from <code>package.json</code>. Drop <code>rail.json</code> in your repo root to override anything (set any check to <code>false</code> to skip it):</span>
          ${codeBlock(railJsonExample)}
        </div>
      </div>
    </div>
  </section>

  <section id="live">
    <div class="sec-head">
      <h2>Live proof</h2>
      <p>Real pushes to <code>${esc(repoInfo.namespace)}/${esc(repoInfo.repo)}</code> on Cloudflare Artifacts — click any receipt for full logs &amp; timings</p>
    </div>
    ${prodBar}
    <div class="feed">${feedRows}</div>
  </section>

  <section class="agent-bar">
    <span><strong>Built for agents too:</strong> every receipt has a strict JSON endpoint (<code>/receipt/:id.json</code>) and an MCP server at <a href="/mcp"><code>POST /mcp</code></a>.</span>
    <span><a href="/llms.txt">llms.txt</a> · <a href="https://github.com/acoyfellow/rail#readme">docs ↗</a></span>
  </section>

  <footer class="foot">
    <span><a href="https://github.com/acoyfellow/rail">github.com/acoyfellow/rail</a> · <a href="https://customer0.dev">customer0.dev</a></span>
    <span>MIT · Pure Cloudflare primitives (Artifacts · Workflows · Sandbox · R2 · Worker Loader · Durable Objects)</span>
  </footer>`;

  return page("rail · git push to deploy on Cloudflare", body, HOME_SCRIPT);
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
        <a class="pill" href="/">← rail.customer0.dev</a>
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
      <div class="sec-head"><h2>Commit &amp; Timings</h2></div>
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
      <div class="sec-head"><h2>Gate, Cache &amp; Deploy</h2></div>
      <dl class="kv">
        <dt>config</dt><dd class="mono">${esc(r.configSource ?? "default")}</dd>
        <dt>cache</dt><dd class="mono">${r.cache ? `${r.cache.hit ? "HIT" : "MISS"} · lockfile ${esc(r.cache.lockfileHash)} · ${r.cache.bytes} B · ${fmtMs(r.cache.durationMs)}` : "—"}</dd>
        <dt>gate</dt><dd class="mono">${r.gate ? `${r.gate.passed ? "PASSED" : "FAILED CLOSED"} (${esc(r.gate.reason)})` : "pending"}</dd>
        <dt>deployed</dt><dd class="mono">${r.deploy.deployed ? `YES · ${esc(r.deploy.deployId)} · <a href="/app">/app ↗</a>` : "NO (production unchanged)"}</dd>
        <dt>nextAction</dt><dd class="mono">${esc(r.nextActionHint ?? "—")}</dd>
        <dt>capabilities</dt><dd class="mono" style="font-size:.76rem">${r.capabilities.map(esc).join("<br>")}</dd>
      </dl>
    </section>
  </div>

  <section class="card">
    <div class="sec-head"><h2>Pipeline Steps (${r.steps.length})</h2></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Step</th><th>Exit</th><th>Duration</th><th>Command &amp; Evidence</th></tr></thead>
        <tbody>${stepRows}</tbody>
      </table>
    </div>
  </section>

  <section class="card">
    <div class="sec-head"><h2>Preview Gate (Worker Loader Isolate)</h2></div>
    ${previewHtml}
  </section>

  <footer class="foot">
    <span><a href="/">← rail.customer0.dev</a></span>
    <span><a href="/receipt/${esc(r.id)}.json">Machine-readable JSON receipt</a></span>
  </footer>`;

  return page(`receipt ${r.id} · ${r.outcome}`, body);
}
