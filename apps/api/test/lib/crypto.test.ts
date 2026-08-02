import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../../src/lib/crypto.js";

const KEY = "0".repeat(64);
const OTHER_KEY = "1".repeat(64);

describe("crypto", () => {
  it("round-trips a token", () => {
    const ciphertext = encryptToken("secret-value", KEY);
    expect(decryptToken(ciphertext, KEY)).toBe("secret-value");
  });

  it("produces different ciphertext each call (random IV)", () => {
    const a = encryptToken("secret-value", KEY);
    const b = encryptToken("secret-value", KEY);
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with the wrong key", () => {
    const ciphertext = encryptToken("secret-value", KEY);
    expect(() => decryptToken(ciphertext, OTHER_KEY)).toThrow();
  });
});
