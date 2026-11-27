import { describe, expect, test } from "bun:test";
import { resolveRailConfig } from "../src/config";

describe("resolveRailConfig", () => {
  test("auto-detects scripts from package.json when rail.json is absent", () => {
    const pkg = JSON.stringify({
      scripts: { lint: "eslint .", test: "bun test", build: "esbuild ..." },
    });
    const cfg = resolveRailConfig(null, pkg);
    expect(cfg.source).toBe("package.json");
    expect(cfg.checks.map((c) => c.name)).toEqual(["lint", "test", "build"]);
    expect(cfg.artifact).toBe("dist/worker.js");
    expect(cfg.preview.healthPath).toBe("/health");
  });

  test("honors rail.json overrides and disabled checks", () => {
    const rail = JSON.stringify({
      branch: "main",
      install: "npm ci",
      checks: { lint: false, test: "npm test", build: "npm run bundle" },
      artifact: "build/index.js",
      preview: { healthPath: "/_health", rootPath: "/status" },
    });
    const cfg = resolveRailConfig(rail, JSON.stringify({ scripts: { lint: "x" } }));
    expect(cfg.source).toBe("rail.json");
    expect(cfg.checks).toEqual([
      { name: "test", command: "npm test" },
      { name: "build", command: "npm run bundle" },
    ]);
    expect(cfg.artifact).toBe("build/index.js");
    expect(cfg.preview).toEqual({ healthPath: "/_health", rootPath: "/status" });
  });

  test("parses deploy.mode: command for multi-binding staging repos (e.g. cloudflare/mcp)", () => {
    const rail = JSON.stringify({
      branch: "main",
      checks: {
        format: "npm run format:check",
        lint: "npm run lint",
        typecheck: "npm run typecheck",
        test: "npm run test",
      },
      deploy: {
        mode: "command",
        command: "npm run deploy:forge-tools && npm run deploy",
        verifyUrl: "https://staging.example.com/health",
      },
    });
    const cfg = resolveRailConfig(rail, null);
    expect(cfg.deploy.mode).toBe("command");
    expect(cfg.deploy.command).toBe("npm run deploy:forge-tools && npm run deploy");
    expect(cfg.deploy.verifyUrl).toBe("https://staging.example.com/health");
    expect(cfg.checks.map((c) => c.name)).toEqual(["format", "lint", "typecheck", "test"]);
  });
});
