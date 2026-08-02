import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "../../src/lib/jwt.js";

const SECRET = "test-secret";
const CLAIMS = { locationId: "loc1", userId: "user1", userName: "Test User" };

describe("jwt", () => {
  it("round-trips claims", () => {
    const token = signSessionToken(CLAIMS, SECRET);
    expect(verifySessionToken(token, SECRET)).toEqual(CLAIMS);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSessionToken(CLAIMS, SECRET);
    expect(() => verifySessionToken(token, "wrong-secret")).toThrow();
  });

  it("rejects a tampered token", () => {
    const token = signSessionToken(CLAIMS, SECRET);
    const tampered = token.slice(0, -1) + (token.at(-1) === "a" ? "b" : "a");
    expect(() => verifySessionToken(tampered, SECRET)).toThrow();
  });
});
