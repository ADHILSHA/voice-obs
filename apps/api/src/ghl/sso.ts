import { createDecipheriv, createHash } from "node:crypto";

const SALT_SIZE = 8;
const HEADER_SIZE = 16; // OpenSSL "Salted__" magic (8 bytes, implicit) + salt (8 bytes)
const KEY_SIZE = 32; // AES-256
const IV_SIZE = 16;

// Ported from GoHighLevel/ghl-marketplace-app-template's decryptSSOData (src/ghl.ts).
// That payload is produced by CryptoJS.AES.encrypt on HighLevel's side, which uses
// OpenSSL's "Salted__" format with MD5-based EVP_BytesToKey key derivation -- this
// reproduces that with Node's built-in crypto instead of pulling in crypto-js.
export function decryptSsoPayload(encryptedBase64: string, sharedSecret: string): Record<string, unknown> {
  const raw = Buffer.from(encryptedBase64, "base64");
  const salt = raw.subarray(SALT_SIZE, HEADER_SIZE);
  const cipherText = raw.subarray(HEADER_SIZE);
  const secretBuffer = Buffer.from(sharedSecret, "utf-8");

  let keyMaterial = Buffer.alloc(0);
  while (keyMaterial.length < KEY_SIZE + IV_SIZE) {
    const hasher = createHash("md5");
    hasher.update(Buffer.concat([keyMaterial.subarray(-IV_SIZE), secretBuffer, salt]));
    keyMaterial = Buffer.concat([keyMaterial, hasher.digest()]);
  }

  const key = keyMaterial.subarray(0, KEY_SIZE);
  const iv = keyMaterial.subarray(KEY_SIZE, KEY_SIZE + IV_SIZE);

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);

  return JSON.parse(decrypted.toString("utf-8"));
}

// The location-context SSO payload includes `activeLocation`, confirmed (per HighLevel's
// docs and community references) to hold the locationId directly as a string in the
// common case. This falls back defensively since we have not yet observed a live payload
// from this specific app to confirm the shape ourselves.
export function extractLocationId(user: Record<string, unknown>): string | null {
  const activeLocation = user.activeLocation;
  if (typeof activeLocation === "string") return activeLocation;
  if (activeLocation && typeof activeLocation === "object") {
    const id = (activeLocation as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  if (typeof user.locationId === "string") return user.locationId;
  return null;
}
