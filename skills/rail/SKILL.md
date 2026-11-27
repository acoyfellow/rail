---
name: rail
description: Push and deploy apps with rail (trunk-based Cloudflare CI/CD on Artifacts, Workflows, Sandbox, Worker Loader, and Durable Objects) and verify PASS/FAIL receipts.
---

# rail

Use `rail` when deploying or verifying a repo backed by Cloudflare Artifacts + Workflows + Worker Loader.

## Tools (after `pi install git:github.com/acoyfellow/rail`)

- `rail_init` — creates `rail.json` in the current repo from `package.json` scripts.
- `rail_push` — pushes `main` to the `cf` Artifacts remote, waits for the Workflow to finish, and returns the verified `PASS` or `FAIL` receipt.
- `rail_status` — reads live production state (`/app`) and recent receipts.
- `rail_receipt` — fetches a specific receipt (`id` or `"latest"`), including step logs, R2 cache hit/miss, Worker Loader preview gate, and `nextActionHint` (`continue` vs `fix_or_revert`).

## Rules

1. Never claim a deploy succeeded after `git push` alone — always verify `receipt.outcome === "PASS"` and `receipt.deploy.deployed === true`.
2. If `receipt.outcome === "FAIL"`, production was left untouched (fail-closed). Inspect the failing step's `stderr`, fix or `git revert HEAD`, and push again.
3. Set `RAIL_URL` to your own rail Worker URL (defaults to `https://rail.customer0.dev`).
