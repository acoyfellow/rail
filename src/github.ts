import { getSandbox } from "@cloudflare/sandbox";
import type { Env } from "./types";
import { scrubSecrets, verifyGithubSignature } from "./github-verify";

export { scrubSecrets, verifyGithubSignature };

const ZERO_SHA = "0000000000000000000000000000000000000000";

export interface GithubPullRequestPayload {
  action?: string;
  number?: number;
  pull_request?: {
    number?: number;
    head?: {
      sha?: string;
      ref?: string;
      repo?: { clone_url?: string };
    };
  };
  repository?: {
    name?: string;
    full_name?: string;
    clone_url?: string;
  };
}

export interface GithubPushPayload {
  ref?: string;
  after?: string;
  repository?: {
    name?: string;
    full_name?: string;
    clone_url?: string;
  };
}

/**
 * Mirrors a verified GitHub push into the configured Cloudflare Artifacts repo.
 * Pushing into Artifacts fires `cf.artifacts.repo.pushed`, keeping one canonical CI trigger path.
 */
export async function mirrorGithubPushToArtifacts(
  env: Env,
  payload: GithubPushPayload,
  targetRepoName: string,
  branch: string
): Promise<{ ok: boolean; sha: string; repo: string; error?: string }> {
  const sha = payload.after || "";
  const cloneUrl = payload.repository?.clone_url;
  if (!sha || sha === ZERO_SHA || !cloneUrl) {
    return { ok: false, sha, repo: targetRepoName, error: "missing commit sha or clone_url" };
  }

  const namespace = env.ARTIFACTS_NAMESPACE || "rail";
  const artifactsRemote = `https://${env.CLOUDFLARE_ACCOUNT_ID}.artifacts.cloudflare.net/git/${namespace}/${targetRepoName}.git`;
  const repo = await env.ARTIFACTS.get(targetRepoName);
  const tok = await repo.createToken("write", 300);

  const sbxId = `rail-mirror-${targetRepoName}-${sha.slice(0, 7)}-${Date.now().toString(36)}`;
  const sandbox = getSandbox(env.SANDBOX, sbxId, {
    transport: "rpc",
    enableDefaultSession: false,
    containerTimeouts: { portReadyTimeoutMS: 60_000 },
  });

  try {
    const authHeader = env.GITHUB_TOKEN
      ? `-c http.extraHeader="Authorization: Bearer $GITHUB_TOKEN"`
      : "";
    const cmd = [
      "rm -rf /tmp/mirror && mkdir -p /tmp/mirror && cd /tmp/mirror",
      "git init -q",
      'git remote add github "$GITHUB_CLONE_URL"',
      'git remote add artifacts "$ARTIFACTS_REMOTE"',
      `git ${authHeader} fetch --depth=50 github "${branch}"`,
      `git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" push artifacts "FETCH_HEAD:refs/heads/${branch}"`,
    ].join(" && ");

    const res = await sandbox.exec(cmd, {
      cwd: "/",
      timeout: 120_000,
      env: {
        GITHUB_CLONE_URL: cloneUrl,
        ARTIFACTS_REMOTE: artifactsRemote,
        ARTIFACTS_TOKEN: tok.plaintext,
        ...(env.GITHUB_TOKEN ? { GITHUB_TOKEN: env.GITHUB_TOKEN } : {}),
      },
    });

    if (res.exitCode !== 0) {
      return {
        ok: false,
        sha,
        repo: targetRepoName,
        error: scrubSecrets(res.stderr || res.stdout || `exit ${res.exitCode}`, [tok.plaintext, env.GITHUB_TOKEN]),
      };
    }
    return { ok: true, sha, repo: targetRepoName };
  } finally {
    await sandbox.destroy().catch(() => {});
  }
}

/**
 * Mirrors a verified GitHub pull_request head commit onto `refs/heads/pr-<number>` in Artifacts.
 * Fires `cf.artifacts.repo.pushed` for that PR branch without ever touching `main`.
 */
export async function mirrorGithubPrToArtifacts(
  env: Env,
  payload: GithubPullRequestPayload,
  targetRepoName: string
): Promise<{ ok: boolean; sha: string; repo: string; branch: string; error?: string }> {
  const prNum = payload.number ?? payload.pull_request?.number;
  const sha = payload.pull_request?.head?.sha || "";
  const headRef = payload.pull_request?.head?.ref || "";
  const cloneUrl = payload.pull_request?.head?.repo?.clone_url || payload.repository?.clone_url;
  const branch = prNum ? `pr-${prNum}` : headRef || "pr";
  if (!sha || sha === ZERO_SHA || !cloneUrl) {
    return { ok: false, sha, repo: targetRepoName, branch, error: "missing PR head sha or clone_url" };
  }

  const namespace = env.ARTIFACTS_NAMESPACE || "rail";
  const artifactsRemote = `https://${env.CLOUDFLARE_ACCOUNT_ID}.artifacts.cloudflare.net/git/${namespace}/${targetRepoName}.git`;
  const repo = await env.ARTIFACTS.get(targetRepoName);
  const tok = await repo.createToken("write", 300);

  const sbxId = `rail-pr-mirror-${targetRepoName}-${sha.slice(0, 7)}-${Date.now().toString(36)}`;
  const sandbox = getSandbox(env.SANDBOX, sbxId, {
    transport: "rpc",
    enableDefaultSession: false,
    containerTimeouts: { portReadyTimeoutMS: 60_000 },
  });

  try {
    const authHeader = env.GITHUB_TOKEN
      ? `-c http.extraHeader="Authorization: Bearer $GITHUB_TOKEN"`
      : "";
    const cmd = [
      "rm -rf /tmp/mirror && mkdir -p /tmp/mirror && cd /tmp/mirror",
      "git init -q",
      'git remote add github "$GITHUB_CLONE_URL"',
      'git remote add artifacts "$ARTIFACTS_REMOTE"',
      `git ${authHeader} fetch --depth=50 github "${sha}"`,
      `git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" push --force artifacts "FETCH_HEAD:refs/heads/${branch}"`,
    ].join(" && ");

    const res = await sandbox.exec(cmd, {
      cwd: "/",
      timeout: 120_000,
      env: {
        GITHUB_CLONE_URL: cloneUrl,
        ARTIFACTS_REMOTE: artifactsRemote,
        ARTIFACTS_TOKEN: tok.plaintext,
        ...(env.GITHUB_TOKEN ? { GITHUB_TOKEN: env.GITHUB_TOKEN } : {}),
      },
    });

    if (res.exitCode !== 0) {
      return {
        ok: false,
        sha,
        repo: targetRepoName,
        branch,
        error: scrubSecrets(res.stderr || res.stdout || `exit ${res.exitCode}`, [tok.plaintext, env.GITHUB_TOKEN]),
      };
    }
    return { ok: true, sha, repo: targetRepoName, branch };
  } finally {
    await sandbox.destroy().catch(() => {});
  }
}
