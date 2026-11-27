import type { CiSandbox } from "@cloudflare/ci/worker";
import type { RailDO } from "./rail-do";

export interface ArtifactsRepo {
  createToken(scope: "read" | "write", expiresInSeconds?: number): Promise<{ plaintext: string }>;
  readCommit?(hash: string): Promise<{ treeHash: string } | null>;
  readTree?(hash: string): Promise<Array<{ name: string; mode: string; hash: string; type: "blob" | "tree" | "commit" }> | null>;
}

export interface ArtifactsBinding {
  get(repoName: string): Promise<ArtifactsRepo>;
}

export interface WorkerLoaderStub {
  getEntrypoint(): { fetch(req: Request): Promise<Response> };
}

export interface WorkerLoaderBinding {
  get(
    id: string,
    factory: () => Promise<{
      compatibilityDate: string;
      mainModule: string;
      modules: Record<string, string>;
      globalOutbound?: null;
      env?: Record<string, unknown>;
    }>
  ): WorkerLoaderStub;
}

export interface Env {
  ARTIFACTS: ArtifactsBinding;
  STORE: R2Bucket;
  LOADER: WorkerLoaderBinding;
  SANDBOX: DurableObjectNamespace<CiSandbox>;
  RAIL: DurableObjectNamespace<RailDO>;
  RAIL_WORKFLOW: Workflow<ArtifactsPushEvent>;
  CLOUDFLARE_ACCOUNT_ID: string;
  ARTIFACTS_NAMESPACE: string;
  ARTIFACTS_REPO: string;
  PUBLIC_ORIGIN: string;
}

export interface ArtifactsPushEvent {
  id?: string;
  type: "cf.artifacts.repo.pushed";
  source: {
    type?: "artifacts.repo";
    namespace: string;
    repoName: string;
  };
  payload: {
    ref: string;
    before: string;
    after: string;
    commits: Array<{
      id: string;
      message: string;
      author: { name: string; email: string };
    }>;
  };
}

export interface StepEvidence {
  name: string;
  command: string;
  status: "pass" | "fail" | "skipped";
  exitCode: number;
  durationMs: number;
  parallelGroup?: string;
  stdout: string;
  stderr: string;
}

export interface CacheEvidence {
  hit: boolean;
  key: string;
  lockfileHash: string;
  durationMs: number;
  bytes: number;
}

export interface PreviewProbeEvidence {
  executed: boolean;
  passed: boolean;
  isolateId: string;
  globalOutbound: "disabled";
  healthStatus?: number;
  healthBody?: string;
  rootStatus?: number;
  durationMs: number;
  error?: string;
}

export interface GateEvidence {
  passed: boolean;
  failClosed: true;
  reason: string;
  failedSteps: string[];
  preview?: PreviewProbeEvidence;
}

export interface DeployEvidence {
  deployed: boolean;
  deployId?: string;
  bundleKey?: string;
  bundleBytes?: number;
  liveUrl?: string;
  previewUrl?: string;
  promotedAt?: string;
}

export interface Receipt {
  id: string;
  schemaVersion: "rail.receipt.v1";
  workflowInstanceId: string;
  outcome: "RUNNING" | "PASS" | "FAIL";
  repo: {
    namespace: string;
    name: string;
    branch: string;
    ref: string;
  };
  commit: {
    sha: string;
    shortSha: string;
    beforeSha: string;
    message: string;
    author: string;
  };
  timings: {
    startedAt: string;
    finishedAt?: string;
    totalMs?: number;
  };
  cache?: CacheEvidence;
  steps: StepEvidence[];
  gate?: GateEvidence;
  deploy: DeployEvidence;
  capabilities: string[];
  urls: {
    human: string;
    json: string;
    liveApp: string;
  };
  nextActionHint?: "continue" | "fix_or_revert" | "wait";
}

export interface ProductionState {
  sha: string;
  shortSha: string;
  deployId: string;
  receiptId: string;
  bundleKey: string;
  commitMessage: string;
  author: string;
  promotedAt: string;
}
