# rail

Minimal, owner-operated trunk-based CI/CD running entirely on Cloudflare primitives. No GitHub Actions, no external CI, no merge queue, and no container on the control path.

- **Live demo & receipts:** [rail.customer0.dev](https://rail.customer0.dev)
- **Live deployed Worker:** [rail.customer0.dev/app](https://rail.customer0.dev/app) ([`/app/health`](https://rail.customer0.dev/app/health))
- **Agent MCP endpoint:** `POST https://rail.customer0.dev/mcp` (`repo.status`, `repo.receipts`, `repo.receipt`)

---

## Use with Pi (or Claude Code / Codex)

```sh
pi install git:github.com/acoyfellow/rail
```

Adds `rail_init`, `rail_push` (pushes to Cloudflare Artifacts and waits for the verified `PASS`/`FAIL` receipt), `rail_status`, and `rail_receipt`. Point `RAIL_URL` at your own rail Worker (defaults to `https://rail.customer0.dev`). Claude Code / Codex can connect directly via MCP at `POST /mcp`.

---

## Add `rail` to an existing app (3 steps)

### 1. Provision & generate `wrangler.jsonc`

```sh
git clone https://github.com/acoyfellow/rail && cd rail && bun install
bun run init -- \
  --account <CLOUDFLARE_ACCOUNT_ID> \
  --namespace <NAMESPACE> \
  --repo <APP_NAME> \
  --app-dir ../my-existing-app
```

Add `--dry-run` first if you want to preview the generated `wrangler.jsonc` and starter `rail.json` without creating resources. Add `--domain rail.yourdomain.com` if you want a custom domain instead of `workers.dev`.

What `rail init` does:
- Creates the R2 bucket (`<namespace>-rail-store`) for lockfile caches, bundles, and receipts.
- Creates the Cloudflare Artifacts namespace and repository.
- Writes `wrangler.jsonc` with your exact `artifacts`, `triggers.events` (`cf.artifacts.repo.pushed`), `workflows`, `containers`, `worker_loaders`, and `durable_objects`.
- Writes a starter `rail.json` in `--app-dir` pre-filled from your existing `package.json` scripts (optional — `rail` also auto-detects `package.json` scripts with zero config).

### 2. Deploy the `rail` control plane

```sh
wrangler deploy
```

*(If your account doesn't have `cloudflare-sandbox:0.12.1` in `registry.cloudflare.com` yet, mirror it once without Docker using `crane copy --platform linux/amd64 docker.io/cloudflare/sandbox:0.12.1 registry.cloudflare.com/<ACCOUNT_ID>/cloudflare-sandbox:0.12.1`, or point `containers[0].image` at a local `./Dockerfile`.)*

### 3. Push your app to Cloudflare Artifacts

```sh
cd ../my-existing-app
git remote add cf https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<NAMESPACE>/<APP_NAME>.git
git push cf main
```

Every push to `main` fires `cf.artifacts.repo.pushed` → runs your checks in parallel Sandboxes with R2 lockfile caching → boots the built bundle in a network-isolated Worker Loader preview isolate (`globalOutbound: null`) → probes `/health` and `/` → atomically promotes in `RailDO` (or fails closed) → emits `/receipt/:id` and `/receipt/:id.json`.

Rollback is just another push of a known-good commit (`git revert HEAD && git push cf main`).

---

## Start a new app from scratch

Copy `demo-app/` as your starting point — it's a minimal ES-module Worker with `lint`, `typecheck`, `test`, `build` (emitting `dist/worker.js` with `/health` + `/`):

```sh
cp -r rail/demo-app ../my-new-app
cd ../my-new-app && git init -b main && git add -A && git commit -m "init"
```

Then run steps 1–3 above with `--app-dir ../my-new-app`.

---

## `rail.json` contract (optional)

If `rail.json` is absent, `rail` auto-detects `lint`, `typecheck`, `test`, and `build` from `package.json`, expects `dist/worker.js`, and probes `/health` and `/`. Drop `rail.json` in your repo root to customize anything:

```json
{
  "branch": "main",
  "install": "npm ci --no-audit --no-fund",
  "lockfiles": ["package.json", "package-lock.json"],
  "checks": {
    "lint": "npm run lint",
    "typecheck": "npm run typecheck",
    "test": "npm run test",
    "build": "npm run build"
  },
  "artifact": "dist/worker.js",
  "preview": {
    "healthPath": "/health",
    "rootPath": "/"
  }
}
```

Set any check to `false` to skip it. The receipt records `"configSource": "rail.json"` or `"package.json"`.

**What your app's `build` step must produce:**
- A self-contained ES module Worker at `artifact` (default `dist/worker.js`) exporting `default { fetch(request) { ... } }`.
- `GET <preview.healthPath>` (default `/health`) returning HTTP `200` and JSON with `{ "ok": true }`.
- `GET <preview.rootPath>` (default `/`) returning HTTP `200`.

---

## Machine receipts & agent loop

Every push produces two URLs:
- **Human:** `/receipt/<id>`
- **Agent JSON:** `/receipt/<id>.json`

An agent can inspect a run without trusting prose or needing a shell:

```sh
curl -s https://rail.customer0.dev/receipt/rcpt_mwz0bnyy_c4a6ef0.json \
  | jq '{outcome, configSource, cache, gate, deploy, nextActionHint}'
```

Or connect any MCP client to `POST /mcp` (`repo.status`, `repo.receipts`, `repo.receipt`).

---

## Live evidence on `rail.customer0.dev`

| Push | Commit | R2 Cache | Outcome | Deploy | Total | Receipt |
|---|---|---|---|---|---|---|
| Initial v1.0.0 | `f5e6626` | MISS (`npm ci`) | **PASS** | `dep_0001` | 17.3s | [human](https://rail.customer0.dev/receipt/rcpt_mwz09uvi_f5e6626) · [json](https://rail.customer0.dev/receipt/rcpt_mwz09uvi_f5e6626.json) |
| Bump v1.1.0 | `8f1e49f` | **HIT** | **PASS** | `dep_0002` | 8.3s | [human](https://rail.customer0.dev/receipt/rcpt_mwz0bczv_8f1e49f) · [json](https://rail.customer0.dev/receipt/rcpt_mwz0bczv_8f1e49f.json) |
| Broken test | `c4a6ef0` | **HIT** | **FAIL** (`test:1`) | refused | 12.9s | [human](https://rail.customer0.dev/receipt/rcpt_mwz0bnyy_c4a6ef0) · [json](https://rail.customer0.dev/receipt/rcpt_mwz0bnyy_c4a6ef0.json) |
| Rollback v1.1.1 | `f88d09c` | **HIT** | **PASS** | `dep_0003` | 31.4s | [human](https://rail.customer0.dev/receipt/rcpt_mwz0f75s_f88d09c) · [json](https://rail.customer0.dev/receipt/rcpt_mwz0f75s_f88d09c.json) |

## Local development

```sh
cf artifacts --local namespaces create --namespace rail
cf artifacts --local namespaces repos create rail --name demo-app
bun run dev
```

## License

MIT
