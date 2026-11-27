#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

interface Options {
  account: string;
  namespace: string;
  repo: string;
  workerName: string;
  bucket: string;
  domain?: string;
  appDir?: string;
  outDir: string;
  dryRun: boolean;
}

function usage(): never {
  console.log(`rail init — wire trunk-based Cloudflare CI/CD into any new or existing app

Usage:
  bun run init -- --account <ACCOUNT_ID> --namespace <NS> --repo <REPO> [options]

Options:
  --account <id>       Cloudflare account ID (32-char hex) [required]
  --namespace <name>   Cloudflare Artifacts namespace (e.g. myteam) [required]
  --repo <name>        Cloudflare Artifacts repo name (e.g. my-app) [required]
  --domain <host>      Optional custom domain (e.g. rail.example.com). Omit for workers.dev.
  --worker <name>      Worker name (default: rail-<repo>)
  --bucket <name>      R2 bucket name (default: <namespace>-rail-store)
  --app-dir <path>     Existing or new app directory where starter rail.json will be written
  --out-dir <path>     Directory for generated wrangler.jsonc (default: .)
  --dry-run            Print plan & generated files without calling cf or writing files
  -h, --help           Show this help
`);
  process.exit(0);
}

function parseArgs(argv: string[]): Options {
  const map = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") usage();
    if (a === "--dry-run") {
      map.set("dryRun", true);
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[++i];
      if (!val || val.startsWith("--")) {
        console.error(`Missing value for --${key}`);
        process.exit(1);
      }
      map.set(key, val);
    }
  }
  const account = String(map.get("account") || process.env.CLOUDFLARE_ACCOUNT_ID || "");
  const namespace = String(map.get("namespace") || "");
  const repo = String(map.get("repo") || "");
  if (!account || !namespace || !repo) {
    console.error("Error: --account, --namespace, and --repo are required. Run with --help.");
    process.exit(1);
  }
  return {
    account,
    namespace,
    repo,
    workerName: String(map.get("worker") || `rail-${repo}`),
    bucket: String(map.get("bucket") || `${namespace}-rail-store`),
    domain: map.get("domain") ? String(map.get("domain")) : undefined,
    appDir: map.get("app-dir") ? String(map.get("app-dir")) : undefined,
    outDir: resolve(String(map.get("out-dir") || ".")),
    dryRun: Boolean(map.get("dryRun")),
  };
}

function buildWranglerConfig(o: Options): string {
  const origin = o.domain ? `https://${o.domain}` : `https://${o.workerName}.workers.dev`;
  const cfg: Record<string, unknown> = {
    name: o.workerName,
    account_id: o.account,
    main: "src/index.ts",
    compatibility_date: "2026-06-16",
    compatibility_flags: ["nodejs_compat"],
    ...(o.domain
      ? { workers_dev: false, routes: [{ pattern: o.domain, custom_domain: true }] }
      : { workers_dev: true }),
    artifacts: [{ binding: "ARTIFACTS", namespace: o.namespace }],
    r2_buckets: [{ binding: "STORE", bucket_name: o.bucket }],
    worker_loaders: [{ binding: "LOADER" }],
    containers: [
      {
        class_name: "CiSandbox",
        image: `registry.cloudflare.com/${o.account}/cloudflare-sandbox:0.12.1`,
        max_instances: 16,
        instance_type: "standard-1",
      },
    ],
    durable_objects: {
      bindings: [
        { name: "SANDBOX", class_name: "CiSandbox" },
        { name: "RAIL", class_name: "RailDO" },
      ],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["CiSandbox", "RailDO"] }],
    workflows: [{ name: `${o.workerName}-ci`, binding: "RAIL_WORKFLOW", class_name: "RailWorkflow" }],
    triggers: {
      events: [
        {
          type: "cf.artifacts.repo.pushed",
          filter: { namespace: o.namespace, repo_name: o.repo },
          targets: [{ type: "workflow", workflow_name: `${o.workerName}-ci` }],
        },
      ],
    },
    vars: {
      CLOUDFLARE_ACCOUNT_ID: o.account,
      ARTIFACTS_NAMESPACE: o.namespace,
      ARTIFACTS_REPO: o.repo,
      PUBLIC_ORIGIN: origin,
    },
    observability: { enabled: true, logs: { enabled: true } },
  };
  return JSON.stringify(cfg, null, 2) + "\n";
}

function buildStarterRailJson(appDir?: string): string {
  const checks: Record<string, string> = {};
  if (appDir && existsSync(join(appDir, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      for (const k of ["lint", "typecheck", "test", "build"]) {
        if (pkg.scripts?.[k]) checks[k] = `npm run ${k}`;
      }
    } catch {
      // ignore malformed package.json
    }
  }
  if (Object.keys(checks).length === 0) {
    checks.lint = "npm run lint";
    checks.typecheck = "npm run typecheck";
    checks.test = "npm run test";
    checks.build = "npm run build";
  }
  return (
    JSON.stringify(
      {
        branch: "main",
        install: "npm ci --no-audit --no-fund",
        lockfiles: ["package.json", "package-lock.json"],
        checks,
        artifact: "dist/worker.js",
        preview: { healthPath: "/health", rootPath: "/" },
      },
      null,
      2
    ) + "\n"
  );
}

function run(cmd: string, args: string[], env: Record<string, string>) {
  const res = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  return res.status === 0;
}

const opts = parseArgs(process.argv.slice(2));
const wranglerJson = buildWranglerConfig(opts);
const remote = `https://${opts.account}.artifacts.cloudflare.net/git/${opts.namespace}/${opts.repo}.git`;

console.log(`rail init (${opts.dryRun ? "DRY RUN" : "LIVE"})`);
console.log(`  account:   ${opts.account}`);
console.log(`  artifacts: ${opts.namespace}/${opts.repo}`);
console.log(`  worker:    ${opts.workerName}`);
console.log(`  r2 bucket: ${opts.bucket}`);
console.log(`  remote:    ${remote}`);

if (opts.dryRun) {
  console.log("\n--- wrangler.jsonc (preview) ---\n" + wranglerJson);
  if (opts.appDir) {
    console.log(`--- ${join(opts.appDir, "rail.json")} (preview) ---\n` + buildStarterRailJson(opts.appDir));
  }
  console.log("Dry run complete. Re-run without --dry-run to provision resources and write files.");
  process.exit(0);
}

const env = { CLOUDFLARE_ACCOUNT_ID: opts.account };
console.log("\n1. Provisioning R2 bucket & Artifacts repo...");
run("cf", ["r2", "buckets", "create", "--name", opts.bucket], env);
run("cf", ["artifacts", "namespaces", "create", "--namespace", opts.namespace], env);
run("cf", ["artifacts", "namespaces", "repos", "create", opts.namespace, "--name", opts.repo], env);

const wranglerPath = join(opts.outDir, "wrangler.jsonc");
writeFileSync(wranglerPath, wranglerJson);
console.log(`\n2. Wrote ${wranglerPath}`);

if (opts.appDir) {
  const railPath = join(resolve(opts.appDir), "rail.json");
  if (!existsSync(railPath)) {
    writeFileSync(railPath, buildStarterRailJson(resolve(opts.appDir)));
    console.log(`   Wrote starter ${railPath}`);
  } else {
    console.log(`   Kept existing ${railPath}`);
  }
}

console.log(`
3. Finish setup in two commands:
   bun run deploy  # (wrangler deploy until cf deploy / cloudflare.config.ts supports artifacts + event triggers)
   cd ${opts.appDir || "<your-app>"} && git remote add cf ${remote} && git push cf main
`);
