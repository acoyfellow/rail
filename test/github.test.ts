import { describe, expect, test } from "bun:test";
import { scrubSecrets, verifyGithubSignature } from "../src/github-verify";

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("verifyGithubSignature", () => {
  test("accepts valid HMAC-SHA256 signature", async () => {
    const body = JSON.stringify({ ref: "refs/heads/main", after: "abc1234" });
    const sig = await sign("super-secret-key", body);
    expect(await verifyGithubSignature("super-secret-key", body, sig)).toBe(true);
  });

  test("rejects tampered payload, wrong secret, or missing header", async () => {
    const body = JSON.stringify({ ref: "refs/heads/main", after: "abc1234" });
    const sig = await sign("super-secret-key", body);
    expect(await verifyGithubSignature("super-secret-key", body + " ", sig)).toBe(false);
    expect(await verifyGithubSignature("wrong-secret", body, sig)).toBe(false);
    expect(await verifyGithubSignature("super-secret-key", body, null)).toBe(false);
    expect(await verifyGithubSignature("super-secret-key", body, "sha1=deadbeef")).toBe(false);
  });
});

describe("scrubSecrets", () => {
  test("redacts tokens from logs", () => {
    const out = scrubSecrets("Authorization: Bearer tok_1234567890abcdef done", ["tok_1234567890abcdef"]);
    expect(out).toBe("Authorization: Bearer [REDACTED] done");
  });
});
