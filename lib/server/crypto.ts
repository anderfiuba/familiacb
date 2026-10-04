import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { env } from "./env";

const KEY_VERSION = 1;

function masterKey(): Buffer {
  return Buffer.from(env().CREDENTIALS_ENCRYPTION_KEY, "base64");
}

/** AAD amarra o texto cifrado ao dono e ao provedor: não dá para copiar o blob de outro usuário. */
function aad(userId: string, provider: string) {
  return Buffer.from(`familiacb:v${KEY_VERSION}:${userId}:${provider}`, "utf8");
}

export type Sealed = { ciphertext: string; iv: string; auth_tag: string; key_version: number };

export function seal(plain: object, userId: string, provider: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(aad(userId, provider));
  const data = Buffer.concat([cipher.update(JSON.stringify(plain), "utf8"), cipher.final()]);
  return {
    ciphertext: data.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    key_version: KEY_VERSION,
  };
}

export function open<T>(s: Sealed, userId: string, provider: string): T {
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(s.iv, "base64"));
  decipher.setAAD(aad(userId, provider));
  decipher.setAuthTag(Buffer.from(s.auth_tag, "base64"));
  const out = Buffer.concat([
    decipher.update(Buffer.from(s.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(out.toString("utf8")) as T;
}

export function sha256(v: string) {
  return createHash("sha256").update(v).digest("hex");
}
