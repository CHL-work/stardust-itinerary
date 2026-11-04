import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(secret: string): Buffer {
  return createHash("sha256").update("stardust-google-calendar-token\0").update(secret).digest();
}

export function encryptCalendarToken(secret: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptCalendarToken(secret: string, envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 3) throw new Error("Calendar token envelope is invalid.");
  const [ivValue, tagValue, encryptedValue] = parts as [string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
