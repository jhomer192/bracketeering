import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM. Key from BYO_ENCRYPTION_KEY (hex-32 = 32 bytes).
// Used for encrypting Spotify client_secret values stored in Supabase.
// Format: "iv_b64:authTag_b64:ciphertext_b64"

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.BYO_ENCRYPTION_KEY;
  if (!raw) throw new Error("BYO_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(`BYO_ENCRYPTION_KEY must be 32 bytes hex (got ${key.length} bytes)`);
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("malformed ciphertext");
  const [ivB64, tagB64, encB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
