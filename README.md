# rail

Minimal, owner-operated trunk-based CI/CD running entirely on Cloudflare primitives. No GitHub Actions, no external CI, no merge queue, and no container on the control path.

- **Live demo & receipts:** [rail.customer0.dev](https://rail.customer0.dev)
- **Live deployed Worker:** [rail.customer0.dev/app](https://rail.customer0.dev/app) ([`/app/health`](https://rail.customer0.dev/app/health))
- **Agent MCP endpoint:** `POST https://rail.customer0.dev/mcp` (`repo.status`, `repo.receipts`, `repo.receipt`)

## Claim

A developer or agent can `git push` to a Cloudflare Artifacts repo and, within one Workflow, get:
1. Lockfile-keyed R2 dependency cache (`package.json` + `package-lock.json` SHA-256 → `cache/deps-<repo>-<hash>.tar.gz`), with hit/miss recorded.
2. Parallel checks (`lint`, `typecheck`, `test`, `build`) in isolated Cloudflare Sandboxes (`CiSandbox`).
3. A **fail-closed gate**: any failing check refuses promotion and leaves production untouched.
4. A **Keel-style live preview gate**: the built Worker bundle is loaded into a fresh, network-isolated `WorkerLoader` isolate (`globalOutbound: null`) and probed at `GET /health` and `GET /` before promotion.
5. Atomic promotion in a SQLite-backed Durable Object (`RailDO`) and a shareable receipt at `/receipt/:id` (human) and `/receipt/:id.json` (next agent).

Rollback is a subsequent `git push` of a known-good commit.

## Live evidence (verified on `rail.customer0.dev`)

| Push | Commit | Cache | Outcome | Deploy | Total | Receipt |
|---|---|---|---|---|---|---|
| Initial v1.0.0 | `f5e6626` | MISS (`npm ci`) | **PASS** | `dep_0001` | 17.3s | [`rcpt_mwz09uvi_f5e6626`](https://rail.customer0.dev/receipt/rcpt_mwz09uvi_f5e6626) (`.json`) |
| Bump v1.1.0 | `8f1e49f` | **HIT** (R2) | **PASS** | `dep_0002` | 8.3s | [`rcpt_mwz0bczv_8f1e49f`](https://rail.customer0.dev/receipt/rcpt_mwz0bczv_8f1e49f) (`.json`) |
| Broken test | `c4a6ef0` | **HIT** (R2) | **FAIL** (`test:1`) | refused | 12.9s | [`rcpt_mwz0bnyy_c4a6ef0`](https://rail.customer0.dev/receipt/rcpt_mwz0bnyy_c4a6ef0) (`.json`) |
| Rollback v1.1.1 | `f88d09c` | **HIT** (R2) | **PASS** | `dep_0003` | 31.4s | [`rcpt_mwz0f75s_f88d09c`](https://rail.customer0.dev/receipt/rcpt_mwz0f75s_f88d09c) (`.json`) |

## One command to try it

Inspect the live status and latest JSON receipt with no shell or auth:

```sh
curl -s https://rail.customer0.dev/receipt/rcpt_mwz0bnyy_c4a6ef0.json | jq '{outcome, cache, gate, deploy, nextActionHint}'
```

Or deploy your own instance:

```sh
bun install
wrangler r2 bucket create rail-store
cf artifacts namespaces create --namespace rail
cf artifacts namespaces repos create rail --name demo-app
wrangler deploy
```

Then push `demo-app/` to the Artifacts remote returned by `repos create`:

```sh
git push https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/rail/demo-app.git main
```

## Exact triggers & bindings (`wrangler.jsonc`)

- **`artifacts`:** `{ "binding": "ARTIFACTS", "namespace": "rail" }` — reads commit trees for lockfile hashing and mints 10-minute scoped read tokens per Sandbox step.
- **`triggers.events`:** `cf.artifacts.repo.pushed` filtered by `namespace: "rail"`, `repo_name: "demo-app"`, targeting `workflow_name: "rail-ci"`.
- **`workflows`:** `RailWorkflow` (`rail-ci`) orchestrating cache, 4× parallel Sandbox steps, preview gate, and promotion.
- **`containers` + `durable_objects`:** `CiSandbox` (`@cloudflare/ci/worker`, `cloudflare/sandbox:0.12.1`) for ephemeral step execution; `RailDO` (SQLite DO) for receipt index, deploy counter, and atomic production pointer.
- **`r2_buckets`:** `STORE` (`rail-store`) for lockfile dependency tarballs, built Worker bundles, and durable receipt JSON.
- **`worker_loaders`:** `LOADER` for network-isolated (`globalOutbound: null`) preview verification and live `/app` serving.

## Local development

Run against the local Artifacts simulator and Wrangler dev:

```sh
cf artifacts --local namespaces create --namespace rail
cf artifacts --local namespaces repos create rail --name demo-app
bun run dev
```

## License

MIT
