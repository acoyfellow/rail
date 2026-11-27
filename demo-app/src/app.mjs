export const APP_VERSION = "1.1.1";
export const GREETING = "Hello from rail trunk CI/CD on Cloudflare";

export function formatBanner(version, commit) {
  return `${GREETING} (v${version} · ${commit})`;
}

export function computeChecksum(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
