export interface RailDeployConfig {
  mode: "worker-loader" | "command";
  /** Required when mode === "command", e.g. "npm run deploy:forge-tools && npm run deploy" */
  command?: string;
  /** Optional command to deploy per-PR previews on non-main branches (receives RAIL_BRANCH & RAIL_PR_NUMBER) */
  prCommand?: string;
  /** Optional post-deploy HTTP probe URL (must return 200), e.g. "https://staging.example.com/health" */
  verifyUrl?: string;
}

export interface RailConfig {
  branch: string;
  install: string;
  lockfiles: string[];
  checks: Array<{ name: string; command: string }>;
  artifact: string;
  preview: {
    healthPath: string;
    rootPath: string;
  };
  deploy: RailDeployConfig;
  source: "rail.json" | "package.json";
}

export interface RailJsonInput {
  branch?: string;
  install?: string;
  lockfiles?: string[];
  checks?: Record<string, string | false>;
  artifact?: string;
  preview?: {
    healthPath?: string;
    rootPath?: string;
  };
  deploy?: {
    mode?: "worker-loader" | "command";
    command?: string;
    prCommand?: string;
    verifyUrl?: string;
  };
}

const DEFAULT_CHECK_ORDER = ["lint", "typecheck", "test", "build"] as const;

/**
 * Resolves pipeline configuration from `rail.json` if present, otherwise auto-detects
 * scripts from `package.json`. Supports both zero-binding Worker Loader deploys (default)
 * and multi-binding staging deploys (`deploy.mode: "command"`).
 */
export function resolveRailConfig(
  railJsonRaw: string | null,
  packageJsonRaw: string | null
): RailConfig {
  const pkg = packageJsonRaw ? (JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> }) : {};
  const scripts = pkg.scripts ?? {};

  if (railJsonRaw) {
    const parsed = JSON.parse(railJsonRaw) as RailJsonInput;
    const checks: Array<{ name: string; command: string }> = [];
    if (parsed.checks) {
      for (const [name, cmd] of Object.entries(parsed.checks)) {
        if (typeof cmd === "string" && cmd.trim()) {
          checks.push({ name, command: cmd.trim() });
        }
      }
    } else {
      for (const name of DEFAULT_CHECK_ORDER) {
        if (scripts[name]) checks.push({ name, command: `npm run ${name}` });
      }
    }
    const mode = parsed.deploy?.mode === "command" ? "command" : "worker-loader";
    return {
      branch: parsed.branch || "main",
      install: parsed.install || "npm ci --no-audit --no-fund",
      lockfiles: parsed.lockfiles?.length ? parsed.lockfiles : ["package.json", "package-lock.json"],
      checks,
      artifact: parsed.artifact || "dist/worker.js",
      preview: {
        healthPath: parsed.preview?.healthPath || "/health",
        rootPath: parsed.preview?.rootPath || "/",
      },
      deploy: {
        mode,
        command: parsed.deploy?.command?.trim() || undefined,
        prCommand: parsed.deploy?.prCommand?.trim() || undefined,
        verifyUrl: parsed.deploy?.verifyUrl?.trim() || undefined,
      },
      source: "rail.json",
    };
  }

  const autoChecks: Array<{ name: string; command: string }> = [];
  for (const name of DEFAULT_CHECK_ORDER) {
    if (scripts[name]) {
      autoChecks.push({ name, command: `npm run ${name}` });
    }
  }

  return {
    branch: "main",
    install: "npm ci --no-audit --no-fund",
    lockfiles: ["package.json", "package-lock.json"],
    checks: autoChecks,
    artifact: "dist/worker.js",
    preview: {
      healthPath: "/health",
      rootPath: "/",
    },
    deploy: {
      mode: "worker-loader",
    },
    source: "package.json",
  };
}
