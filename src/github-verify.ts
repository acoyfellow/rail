function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Constant-time HMAC-SHA256 verification for GitHub's `X-Hub-Signature-256` header.
 */
export async function verifyGithubSignature(
  secret: string,
  payload: string,
  signatureHeader: string | null
): Promise<boolean> {
  if (!secret || !signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const sigBytes = hexToBytes(signatureHeader.slice("sha256=".length));
  if (!sigBytes) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
}

export function scrubSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 8) {
      out = out.split(s).join("[REDACTED]");
    }
  }
  return out;
}
