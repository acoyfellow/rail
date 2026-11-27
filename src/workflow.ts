import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getSandbox } from "@cloudflare/sandbox";
import { resolveRailConfig, type RailConfig } from "./config";
import { scrubSecrets } from "./github";
import type {
  ArtifactsPushEvent,
  CacheEvidence,
  Env,
  GateEvidence,
  PreviewProbeEvidence,
  Receipt,
  StepEvidence,
} from "./types";

const ZERO_SHA = "0000000000000000000000000000000000000000";
const MAX_LOG_CHARS = 8000;

function trimLog(s: string | undefined): string {
  if (!s) return "";
  return s.length > MAX_LOG_CHARS ? `…(truncated)\n${s.slice(-MAX_LOG_CHARS)}` : s;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cloneCommand(sha: string): string {
  return [
    "rm -rf /workspace && mkdir -p /workspace && cd /workspace",
    "git init -q",
    'git remote add origin "$ARTIFACTS_REMOTE"',
    'git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" fetch --depth=1 origin ' + sha,
    "git checkout -q FETCH_HEAD",
  ].join(" && ");
}

function decodeBlob(raw: Uint8Array | string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return typeof raw === "string" ? raw : new TextDecoder().decode(raw);
}

export class RailWorkflow extends WorkflowEntrypoint<Env, ArtifactsPushEvent> {
  async run(event: WorkflowEvent<ArtifactsPushEvent>, step: WorkflowStep): Promise<{ receiptId: string; outcome: string }> {
    const push = event.payload;
    if (!push || push.type !== "cf.artifacts.repo.pushed") {
      return { receiptId: "ignored", outcome: "IGNORED" };
    }
    const { namespace, repoName } = push.source;
    const { ref, before, after, commits } = push.payload;
    if (after === ZERO_SHA || !ref.startsWith("refs/heads/")) {
      return { receiptId: "ignored", outcome: "IGNORED" };
    }
    const branch = ref.slice("refs/heads/".length);
    const prMatch = /^pr-(\d+)$/.exec(branch);
    const prNumber = prMatch ? prMatch[1] : undefined;

    const startedAt = new Date().toISOString();
    const startWall = Date.now();
    const shortSha = after.slice(0, 7);
    const receiptId = `rcpt_${Date.now().toString(36)}_${shortSha}`;
    const lastCommit = commits?.at(-1);
    const commitMessage = lastCommit?.message?.trim() || "(no commit message)";
    const author = lastCommit?.author?.name || "unknown";
    const origin = this.env.PUBLIC_ORIGIN || "https://rail.customer0.dev";
    const railStub = this.env.RAIL.get(this.env.RAIL.idFromName(`${namespace}/${repoName}/main`));

    const baseReceipt: Receipt = {
      id: receiptId,
      schemaVersion: "rail.receipt.v1",
      workflowInstanceId: event.instanceId,
      outcome: "RUNNING",
      repo: { namespace, name: repoName, branch, ref },
      commit: { sha: after, shortSha, beforeSha: before, message: commitMessage, author },
      timings: { startedAt },
      steps: [],
      deploy: { deployed: false },
      capabilities: [
        "artifacts:read(10m-scoped-token-per-step)",
        "r2:cache(lockfile-sha256)",
        "sandbox:ephemeral-runners(parallel)",
        "worker-loader:preview-isolate(globalOutbound=null)",
        "durable-object:atomic-promote",
      ],
      urls: {
        human: `${origin}/receipt/${receiptId}`,
        json: `${origin}/receipt/${receiptId}.json`,
        liveApp: `${origin}/app`,
      },
      nextActionHint: "wait",
    };

    // 1. Record start in Durable Object (control path: zero containers)
    await step.do("record-start", async () => {
      await railStub.saveReceipt(baseReceipt);
    });

    try {
      // 2. Resolve lockfile cache key & repo config (rail.json or package.json) with zero containers
      const checkoutMeta = await step.do("resolve-cache-and-config", async () => {
        const repo = await this.env.ARTIFACTS.get(repoName);
        const remote = `https://${this.env.CLOUDFLARE_ACCOUNT_ID}.artifacts.cloudflare.net/git/${namespace}/${repoName}.git`;

        let lockFingerprint = "";
        let configFingerprint = "";
        let railBlobHash: string | null = null;
        let pkgBlobHash: string | null = null;
        let resolvedConfig: RailConfig | null = null;

        if (repo.readCommit && repo.readTree) {
          try {
            const c = await repo.readCommit(after);
            if (c) {
              const entries = (await repo.readTree(c.treeHash)) ?? [];
              const lockParts = entries
                .filter((e) => e.type === "blob" && (e.name === "package.json" || e.name === "package-lock.json"))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((e) => `${e.name}:${e.hash}`);
              lockFingerprint = lockParts.join("|");

              railBlobHash = entries.find((e) => e.type === "blob" && e.name === "rail.json")?.hash ?? null;
              pkgBlobHash = entries.find((e) => e.type === "blob" && e.name === "package.json")?.hash ?? null;
              configFingerprint = `rail:${railBlobHash ?? "none"}|pkg:${pkgBlobHash ?? "none"}`;

              // Try reading blobs directly via Artifacts binding (0 containers)
              if (repo.readBlob) {
                const railRaw = railBlobHash ? decodeBlob(await repo.readBlob(railBlobHash).catch(() => null)) : null;
                const pkgRaw = pkgBlobHash ? decodeBlob(await repo.readBlob(pkgBlobHash).catch(() => null)) : null;
                if (railRaw !== null || pkgRaw !== null) {
                  resolvedConfig = resolveRailConfig(railRaw, pkgRaw);
                }
              }
            }
          } catch {
            // fallback handled below
          }
        }

        const lockfileHash = (await sha256Hex(lockFingerprint || `fallback:${after}`)).slice(0, 16);
        const cacheKey = `cache/deps-${repoName}-${lockfileHash}.tar.gz`;
        const configHash = (await sha256Hex(configFingerprint || `cfg:${after}`)).slice(0, 16);
        const configKey = `cache/cfg-${repoName}-${configHash}.json`;

        if (!resolvedConfig) {
          const cachedCfg = await this.env.STORE.get(configKey);
          if (cachedCfg) {
            resolvedConfig = (await cachedCfg.json()) as RailConfig;
          }
        }

        return { remote, lockfileHash, cacheKey, configKey, config: resolvedConfig };
      });

      // 3. Dependency install / R2 lockfile cache check (+ resolve rail.json if not cached yet)
      const installOut = await step.do(
        "install-deps",
        { retries: { limit: 2, delay: "10 seconds" }, timeout: "5 minutes" },
        async (): Promise<{ cache: CacheEvidence; stepEvidence: StepEvidence; config: RailConfig }> => {
          const t0 = Date.now();
          const existing = await this.env.STORE.head(checkoutMeta.cacheKey);

          if (existing && checkoutMeta.config) {
            return {
              config: checkoutMeta.config,
              cache: {
                hit: true,
                key: checkoutMeta.cacheKey,
                lockfileHash: checkoutMeta.lockfileHash,
                durationMs: Date.now() - t0,
                bytes: existing.size,
              },
              stepEvidence: {
                name: "install",
                command: "r2-cache-restore node_modules",
                status: "pass",
                exitCode: 0,
                durationMs: Date.now() - t0,
                stdout: `Cache HIT for lockfile ${checkoutMeta.lockfileHash} (${existing.size} bytes in R2: ${checkoutMeta.cacheKey}). Skipped install.`,
                stderr: "",
              },
            };
          }

          const sbxId = `rail-install-${receiptId}-${Date.now().toString(36)}`;
          const sandbox = getSandbox(this.env.SANDBOX, sbxId, {
            transport: "rpc",
            enableDefaultSession: false,
            containerTimeouts: { portReadyTimeoutMS: 60_000 },
          });
          try {
            const repo = await this.env.ARTIFACTS.get(repoName);
            const tok = await repo.createToken("read", 600);
            const cloneRes = await sandbox.exec(cloneCommand(after), {
              cwd: "/",
              timeout: 120_000,
              env: { ARTIFACTS_REMOTE: checkoutMeta.remote, ARTIFACTS_TOKEN: tok.plaintext },
            });
            if (cloneRes.exitCode !== 0) {
              const fallbackCfg = checkoutMeta.config ?? resolveRailConfig(null, null);
              return {
                config: fallbackCfg,
                cache: { hit: false, key: checkoutMeta.cacheKey, lockfileHash: checkoutMeta.lockfileHash, durationMs: Date.now() - t0, bytes: 0 },
                stepEvidence: {
                  name: "install",
                  command: "git fetch && install",
                  status: "fail",
                  exitCode: cloneRes.exitCode,
                  durationMs: Date.now() - t0,
                  stdout: trimLog(cloneRes.stdout),
                  stderr: trimLog(cloneRes.stderr),
                },
              };
            }

            // Read rail.json & package.json from workspace if config wasn't resolved yet
            let config = checkoutMeta.config;
            if (!config) {
              const railRaw = await sandbox
                .readFile("/workspace/rail.json", { encoding: "utf-8" })
                .then((f) => f.content)
                .catch(() => null);
              const pkgRaw = await sandbox
                .readFile("/workspace/package.json", { encoding: "utf-8" })
                .then((f) => f.content)
                .catch(() => null);
              config = resolveRailConfig(railRaw, pkgRaw);
              await this.env.STORE.put(checkoutMeta.configKey, JSON.stringify(config), {
                httpMetadata: { contentType: "application/json" },
              });
            }

            if (existing) {
              return {
                config,
                cache: {
                  hit: true,
                  key: checkoutMeta.cacheKey,
                  lockfileHash: checkoutMeta.lockfileHash,
                  durationMs: Date.now() - t0,
                  bytes: existing.size,
                },
                stepEvidence: {
                  name: "install",
                  command: "r2-cache-restore node_modules",
                  status: "pass",
                  exitCode: 0,
                  durationMs: Date.now() - t0,
                  stdout: `Cache HIT for lockfile ${checkoutMeta.lockfileHash} (${existing.size} bytes in R2). Resolved config from ${config.source}.`,
                  stderr: "",
                },
              };
            }

            const res = await sandbox.exec(
              `${config.install} && tar -czf /tmp/node_modules.tar.gz -C /workspace node_modules`,
              { cwd: "/workspace", timeout: 180_000, env: { CI: "true" } }
            );
            if (res.exitCode !== 0) {
              return {
                config,
                cache: { hit: false, key: checkoutMeta.cacheKey, lockfileHash: checkoutMeta.lockfileHash, durationMs: Date.now() - t0, bytes: 0 },
                stepEvidence: {
                  name: "install",
                  command: config.install,
                  status: "fail",
                  exitCode: res.exitCode,
                  durationMs: Date.now() - t0,
                  stdout: trimLog(res.stdout),
                  stderr: trimLog(res.stderr),
                },
              };
            }

            const tarFile = await sandbox.readFile("/tmp/node_modules.tar.gz", { encoding: "base64" });
            const bytes = base64ToBytes(tarFile.content);
            await this.env.STORE.put(checkoutMeta.cacheKey, bytes, {
              customMetadata: { lockfileHash: checkoutMeta.lockfileHash, sha: after },
            });

            return {
              config,
              cache: {
                hit: false,
                key: checkoutMeta.cacheKey,
                lockfileHash: checkoutMeta.lockfileHash,
                durationMs: Date.now() - t0,
                bytes: bytes.byteLength,
              },
              stepEvidence: {
                name: "install",
                command: config.install,
                status: "pass",
                exitCode: 0,
                durationMs: Date.now() - t0,
                stdout: trimLog(res.stdout) + `\nCached node_modules (${bytes.byteLength} bytes) -> ${checkoutMeta.cacheKey}`,
                stderr: trimLog(res.stderr),
              },
            };
          } finally {
            await sandbox.destroy().catch(() => {});
          }
        }
      );

      const config = installOut.config;
      const receiptWithCfg: Receipt = { ...baseReceipt, configSource: config.source };
      const steps: StepEvidence[] = [installOut.stepEvidence];

      const runParallelCheck = (name: string, command: string, captureArtifactPath?: string) =>
        step.do(
          `check-${name}`,
          { retries: { limit: 2, delay: "10 seconds" }, timeout: "4 minutes" },
          async (): Promise<{ evidence: StepEvidence; bundleKey?: string; bundleBytes?: number }> => {
            const t0 = Date.now();
            const sbxId = `rail-${name}-${receiptId}-${Date.now().toString(36)}`;
            const sandbox = getSandbox(this.env.SANDBOX, sbxId, {
              transport: "rpc",
              enableDefaultSession: false,
              containerTimeouts: { portReadyTimeoutMS: 60_000 },
            });
            try {
              const repo = await this.env.ARTIFACTS.get(repoName);
              const tok = await repo.createToken("read", 600);
              const cloneRes = await sandbox.exec(cloneCommand(after), {
                cwd: "/",
                timeout: 120_000,
                env: { ARTIFACTS_REMOTE: checkoutMeta.remote, ARTIFACTS_TOKEN: tok.plaintext },
              });
              if (cloneRes.exitCode !== 0) {
                return {
                  evidence: {
                    name,
                    command,
                    status: "fail",
                    exitCode: cloneRes.exitCode,
                    durationMs: Date.now() - t0,
                    parallelGroup: "checks",
                    stdout: trimLog(cloneRes.stdout),
                    stderr: trimLog(cloneRes.stderr),
                  },
                };
              }

              const cached = await this.env.STORE.get(checkoutMeta.cacheKey);
              if (cached) {
                const buf = new Uint8Array(await cached.arrayBuffer());
                await sandbox.writeFile("/tmp/node_modules.tar.gz", bytesToBase64(buf), { encoding: "base64" });
                await sandbox.exec("tar -xzf /tmp/node_modules.tar.gz -C /workspace", { cwd: "/workspace" });
              }

              const res = await sandbox.exec(command, {
                cwd: "/workspace",
                timeout: 120_000,
                env: { CI: "true", RAIL_COMMIT_SHA: after, RAIL_SHORT_SHA: shortSha, RAIL_BRANCH: branch, ...(prNumber ? { RAIL_PR_NUMBER: prNumber } : {}) },
              });

              let bundleKey: string | undefined;
              let bundleBytes: number | undefined;
              if (captureArtifactPath && res.exitCode === 0) {
                const fullPath = captureArtifactPath.startsWith("/")
                  ? captureArtifactPath
                  : `/workspace/${captureArtifactPath}`;
                const built = await sandbox.readFile(fullPath, { encoding: "utf-8" });
                bundleKey = `deployments/${after}/worker.js`;
                const encoded = new TextEncoder().encode(built.content);
                bundleBytes = encoded.byteLength;
                await this.env.STORE.put(bundleKey, encoded, {
                  httpMetadata: { contentType: "application/javascript" },
                  customMetadata: { sha: after, receiptId, artifact: captureArtifactPath },
                });
              }

              return {
                bundleKey,
                bundleBytes,
                evidence: {
                  name,
                  command,
                  status: res.exitCode === 0 ? "pass" : "fail",
                  exitCode: res.exitCode,
                  durationMs: Date.now() - t0,
                  parallelGroup: "checks",
                  stdout: trimLog(res.stdout),
                  stderr: trimLog(res.stderr),
                },
              };
            } finally {
              await sandbox.destroy().catch(() => {});
            }
          }
        );

      // 4. Parallel checks from rail.json or auto-detected package.json scripts
      let bundleKey: string | undefined;
      let bundleBytes: number | undefined;

      if (installOut.stepEvidence.status === "pass") {
        const checkResults = await Promise.all(
          config.checks.map((chk) =>
            runParallelCheck(chk.name, chk.command, config.deploy.mode === "worker-loader" && chk.name === "build" ? config.artifact : undefined)
          )
        );
        for (const r of checkResults) {
          steps.push(r.evidence);
          if (r.bundleKey) {
            bundleKey = r.bundleKey;
            bundleBytes = r.bundleBytes;
          }
        }
      }

      const failedSteps = steps.filter((s) => s.status === "fail").map((s) => s.name);

      // 5. Fail-closed gate check on parallel runners
      const needsBundle = config.deploy.mode === "worker-loader";
      if (failedSteps.length > 0 || (needsBundle && !bundleKey)) {
        const gate: GateEvidence = {
          passed: false,
          failClosed: true,
          reason: failedSteps.length > 0 ? `check_failed: ${failedSteps.join(", ")}` : "missing_build_artifact",
          failedSteps,
        };
        const finishedAt = new Date().toISOString();
        const finalReceipt: Receipt = {
          ...receiptWithCfg,
          outcome: "FAIL",
          timings: { startedAt, finishedAt, totalMs: Date.now() - startWall },
          cache: installOut.cache,
          steps,
          gate,
          deploy: { deployed: false },
          nextActionHint: "fix_or_revert",
        };
        await step.do("emit-fail-receipt", async () => {
          await railStub.saveReceipt(finalReceipt);
          await this.env.STORE.put(`receipts/${receiptId}.json`, JSON.stringify(finalReceipt, null, 2), {
            httpMetadata: { contentType: "application/json" },
          });
        });
        return { receiptId, outcome: "FAIL" };
      }

      const isDeployBranch = branch === config.branch;

      // 5b. Command deploy mode (for multi-binding staging Workers, e.g. wrangler deploy --env staging)
      if (config.deploy.mode === "command") {
        const deployCmd = isDeployBranch ? config.deploy.command : config.deploy.prCommand;
        if (!isDeployBranch && !deployCmd) {
          const finishedAt = new Date().toISOString();
          const prPassReceipt: Receipt = {
            ...receiptWithCfg,
            outcome: "PASS",
            timings: { startedAt, finishedAt, totalMs: Date.now() - startWall },
            cache: installOut.cache,
            steps,
            gate: {
              passed: true,
              failClosed: true,
              reason: "pr_checks_passed_no_promote",
              failedSteps: [],
            },
            deploy: { deployed: false, mode: "command" },
            nextActionHint: "continue",
          };
          await step.do("emit-pr-check-only-pass", async () => {
            await railStub.saveReceipt(prPassReceipt);
            await this.env.STORE.put(`receipts/${receiptId}.json`, JSON.stringify(prPassReceipt, null, 2), {
              httpMetadata: { contentType: "application/json" },
            });
          });
          return { receiptId, outcome: "PASS" };
        }
        if (!deployCmd) {
          const finishedAt = new Date().toISOString();
          const failReceipt: Receipt = {
            ...receiptWithCfg,
            outcome: "FAIL",
            timings: { startedAt, finishedAt, totalMs: Date.now() - startWall },
            cache: installOut.cache,
            steps,
            gate: { passed: false, failClosed: true, reason: "missing_deploy_command", failedSteps: ["deploy"] },
            deploy: { deployed: false, mode: "command" },
            nextActionHint: "fix_or_revert",
          };
          await step.do("emit-missing-cmd-fail", async () => {
            await railStub.saveReceipt(failReceipt);
            await this.env.STORE.put(`receipts/${receiptId}.json`, JSON.stringify(failReceipt, null, 2), {
              httpMetadata: { contentType: "application/json" },
            });
          });
          return { receiptId, outcome: "FAIL" };
        }

        const deployStep: StepEvidence = await step.do(
          "deploy-command",
          { retries: { limit: 1, delay: "10 seconds" }, timeout: "5 minutes" },
          async (): Promise<StepEvidence> => {
            const t0 = Date.now();
            const sbxId = `rail-deploy-${receiptId}-${Date.now().toString(36)}`;
            const sandbox = getSandbox(this.env.SANDBOX, sbxId, {
              transport: "rpc",
              enableDefaultSession: false,
              containerTimeouts: { portReadyTimeoutMS: 60_000 },
            });
            try {
              const repo = await this.env.ARTIFACTS.get(repoName);
              const tok = await repo.createToken("read", 600);
              const cloneRes = await sandbox.exec(cloneCommand(after), {
                cwd: "/",
                timeout: 120_000,
                env: { ARTIFACTS_REMOTE: checkoutMeta.remote, ARTIFACTS_TOKEN: tok.plaintext },
              });
              if (cloneRes.exitCode !== 0) {
                return {
                  name: "deploy",
                  command: deployCmd,
                  status: "fail",
                  exitCode: cloneRes.exitCode,
                  durationMs: Date.now() - t0,
                  stdout: trimLog(scrubSecrets(cloneRes.stdout, [tok.plaintext, this.env.DEPLOY_API_TOKEN])),
                  stderr: trimLog(scrubSecrets(cloneRes.stderr, [tok.plaintext, this.env.DEPLOY_API_TOKEN])),
                };
              }
              const cached = await this.env.STORE.get(checkoutMeta.cacheKey);
              if (cached) {
                const buf = new Uint8Array(await cached.arrayBuffer());
                await sandbox.writeFile("/tmp/node_modules.tar.gz", bytesToBase64(buf), { encoding: "base64" });
                await sandbox.exec("tar -xzf /tmp/node_modules.tar.gz -C /workspace", { cwd: "/workspace" });
              }
              const res = await sandbox.exec(deployCmd, {
                cwd: "/workspace",
                timeout: 180_000,
                env: {
                  CI: "true",
                  RAIL_COMMIT_SHA: after,
                  RAIL_SHORT_SHA: shortSha,
                  RAIL_BRANCH: branch,
                  ...(prNumber ? { RAIL_PR_NUMBER: prNumber } : {}),
                  CLOUDFLARE_ACCOUNT_ID: this.env.CLOUDFLARE_ACCOUNT_ID,
                  ...(this.env.DEPLOY_API_TOKEN ? { CLOUDFLARE_API_TOKEN: this.env.DEPLOY_API_TOKEN } : {}),
                },
              });
              return {
                name: "deploy",
                command: deployCmd,
                status: res.exitCode === 0 ? "pass" : "fail",
                exitCode: res.exitCode,
                durationMs: Date.now() - t0,
                stdout: trimLog(scrubSecrets(res.stdout, [tok.plaintext, this.env.DEPLOY_API_TOKEN])),
                stderr: trimLog(scrubSecrets(res.stderr, [tok.plaintext, this.env.DEPLOY_API_TOKEN])),
              };
            } finally {
              await sandbox.destroy().catch(() => {});
            }
          }
        );

        steps.push(deployStep);

        let verifyOk = true;
        let verifyProbe: PreviewProbeEvidence | undefined;
        if (deployStep.status === "pass" && config.deploy.verifyUrl) {
          verifyProbe = await step.do("verify-staging-url", async (): Promise<PreviewProbeEvidence> => {
            const t0 = Date.now();
            try {
              const res = await fetch(config.deploy.verifyUrl!);
              const body = await res.text();
              const passed = res.status === 200;
              return {
                executed: true,
                passed,
                isolateId: `staging-probe-${shortSha}`,
                globalOutbound: "disabled",
                healthStatus: res.status,
                healthBody: trimLog(body),
                durationMs: Date.now() - t0,
                error: passed ? undefined : `verifyUrl returned HTTP ${res.status}`,
              };
            } catch (err) {
              return {
                executed: true,
                passed: false,
                isolateId: `staging-probe-${shortSha}`,
                globalOutbound: "disabled",
                durationMs: Date.now() - t0,
                error: String(err instanceof Error ? err.message : err),
              };
            }
          });
          verifyOk = verifyProbe.passed;
        }

        if (deployStep.status !== "pass" || !verifyOk) {
          const finishedAt = new Date().toISOString();
          const failReceipt: Receipt = {
            ...receiptWithCfg,
            outcome: "FAIL",
            timings: { startedAt, finishedAt, totalMs: Date.now() - startWall },
            cache: installOut.cache,
            steps,
            gate: {
              passed: false,
              failClosed: true,
              reason: deployStep.status !== "pass" ? `deploy_failed (exit ${deployStep.exitCode})` : (verifyProbe?.error || "verify_url_failed"),
              failedSteps: [deployStep.status !== "pass" ? "deploy" : "verify-url"],
              preview: verifyProbe,
            },
            deploy: { deployed: false, mode: "command", liveUrl: config.deploy.verifyUrl },
            nextActionHint: "fix_or_revert",
          };
          await step.do("emit-command-deploy-fail", async () => {
            await railStub.saveReceipt(failReceipt);
            await this.env.STORE.put(`receipts/${receiptId}.json`, JSON.stringify(failReceipt, null, 2), {
              httpMetadata: { contentType: "application/json" },
            });
          });
          return { receiptId, outcome: "FAIL" };
        }

        const cmdReceipt = await step.do("record-command-deploy-pass", async () => {
          const finishedAt = new Date().toISOString();
          const prod = isDeployBranch
            ? await railStub.promote({
                sha: after,
                receiptId,
                bundleKey: `command:${deployCmd}`,
                commitMessage,
                author,
              })
            : null;
          const receipt: Receipt = {
            ...receiptWithCfg,
            outcome: "PASS",
            timings: { startedAt, finishedAt, totalMs: Date.now() - startWall },
            cache: installOut.cache,
            steps,
            gate: {
              passed: true,
              failClosed: true,
              reason: !isDeployBranch
                ? "pr_preview_deploy_passed"
                : verifyProbe
                  ? "checks_deploy_and_verify_passed"
                  : "checks_and_deploy_passed",
              failedSteps: [],
              preview: verifyProbe,
            },
            deploy: {
              deployed: true,
              mode: "command",
              deployId: prod ? prod.deployId : `pr_${shortSha}`,
              liveUrl: config.deploy.verifyUrl || `${origin}/app`,
              promotedAt: prod ? prod.promotedAt : finishedAt,
            },
            nextActionHint: "continue",
          };
          await railStub.saveReceipt(receipt);
          await this.env.STORE.put(`receipts/${receiptId}.json`, JSON.stringify(receipt, null, 2), {
            httpMetadata: { contentType: "application/json" },
          });
          return receipt;
        });
        return { receiptId: cmdReceipt.id, outcome: "PASS" };
      }

      // 6. Keel-style preview gate in a network-isolated Worker Loader isolate
      const preview: PreviewProbeEvidence = await step.do("preview-gate", async () => {
        const t0 = Date.now();
        const isolateId = `preview-${shortSha}-${receiptId}`;
        try {
          const obj = await this.env.STORE.get(bundleKey!);
          if (!obj) {
            return {
              executed: true,
              passed: false,
              isolateId,
              globalOutbound: "disabled",
              durationMs: Date.now() - t0,
              error: `bundle not found in R2: ${bundleKey}`,
            };
          }
          const code = await obj.text();
          const stub = this.env.LOADER.get(isolateId, async () => ({
            compatibilityDate: "2026-06-16",
            mainModule: "worker.js",
            modules: { "worker.js": code },
            globalOutbound: null,
          }));
          const entry = stub.getEntrypoint();
          const healthRes = await entry.fetch(new Request(`https://preview.rail.internal${config.preview.healthPath}`));
          const healthBody = await healthRes.text();
          let healthOk = false;
          try {
            const parsed = JSON.parse(healthBody) as { ok?: boolean };
            healthOk = healthRes.status === 200 && parsed.ok === true;
          } catch {
            healthOk = false;
          }
          const rootRes = await entry.fetch(new Request(`https://preview.rail.internal${config.preview.rootPath}`));
          const passed = healthOk && rootRes.status === 200;
          return {
            executed: true,
            passed,
            isolateId,
            globalOutbound: "disabled",
            healthStatus: healthRes.status,
            healthBody: trimLog(healthBody),
            rootStatus: rootRes.status,
            durationMs: Date.now() - t0,
            error: passed
              ? undefined
              : `probe failed: ${config.preview.healthPath}=${healthRes.status} ${config.preview.rootPath}=${rootRes.status}`,
          };
        } catch (err) {
          return {
            executed: true,
            passed: false,
            isolateId,
            globalOutbound: "disabled",
            durationMs: Date.now() - t0,
            error: String(err instanceof Error ? err.message : err),
          };
        }
      });

      if (!preview.passed) {
        const gate: GateEvidence = {
          passed: false,
          failClosed: true,
          reason: preview.error || "preview_health_failed",
          failedSteps: ["preview-gate"],
          preview,
        };
        const finishedAt = new Date().toISOString();
        const finalReceipt: Receipt = {
          ...receiptWithCfg,
          outcome: "FAIL",
          timings: { startedAt, finishedAt, totalMs: Date.now() - startWall },
          cache: installOut.cache,
          steps,
          gate,
          deploy: { deployed: false, bundleKey, bundleBytes, previewUrl: `${origin}/preview/${after}` },
          nextActionHint: "fix_or_revert",
        };
        await step.do("emit-preview-fail-receipt", async () => {
          await railStub.saveReceipt(finalReceipt);
          await this.env.STORE.put(`receipts/${receiptId}.json`, JSON.stringify(finalReceipt, null, 2), {
            httpMetadata: { contentType: "application/json" },
          });
        });
        return { receiptId, outcome: "FAIL" };
      }

      // 7. All gates green -> promote in Durable Object on deploy branch, or keep preview-only on PR branches
      const finalReceipt = await step.do("promote-and-emit-receipt", async () => {
        const finishedAt = new Date().toISOString();
        const prod = isDeployBranch
          ? await railStub.promote({
              sha: after,
              receiptId,
              bundleKey: bundleKey!,
              commitMessage,
              author,
            })
          : null;
        const receipt: Receipt = {
          ...receiptWithCfg,
          outcome: "PASS",
          timings: { startedAt, finishedAt, totalMs: Date.now() - startWall },
          cache: installOut.cache,
          steps,
          gate: {
            passed: true,
            failClosed: true,
            reason: isDeployBranch ? "all_checks_and_preview_passed" : "pr_checks_and_preview_passed_no_promote",
            failedSteps: [],
            preview,
          },
          deploy: {
            deployed: Boolean(prod),
            mode: "worker-loader",
            deployId: prod?.deployId,
            bundleKey,
            bundleBytes,
            liveUrl: prod ? `${origin}/app` : undefined,
            previewUrl: `${origin}/preview/${after}`,
            promotedAt: prod?.promotedAt,
          },
          nextActionHint: "continue",
        };
        await railStub.saveReceipt(receipt);
        await this.env.STORE.put(`receipts/${receiptId}.json`, JSON.stringify(receipt, null, 2), {
          httpMetadata: { contentType: "application/json" },
        });
        return receipt;
      });

      return { receiptId: finalReceipt.id, outcome: "PASS" };
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const errReceipt: Receipt = {
        ...baseReceipt,
        outcome: "FAIL",
        timings: { startedAt, finishedAt, totalMs: Date.now() - startWall },
        steps: [],
        gate: {
          passed: false,
          failClosed: true,
          reason: `infra_error: ${String(err instanceof Error ? err.message : err).slice(0, 240)}`,
          failedSteps: ["workflow"],
        },
        deploy: { deployed: false },
        nextActionHint: "fix_or_revert",
      };
      await step.do("emit-infra-fail-receipt", async () => {
        await railStub.saveReceipt(errReceipt);
        await this.env.STORE.put(`receipts/${receiptId}.json`, JSON.stringify(errReceipt, null, 2), {
          httpMetadata: { contentType: "application/json" },
        });
      });
      return { receiptId, outcome: "FAIL" };
    }
  }
}
