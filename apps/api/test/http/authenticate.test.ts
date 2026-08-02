import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { registerAuthenticateHook } from "../../src/http/middleware/authenticate.js";
import { signSessionToken } from "../../src/lib/jwt.js";

describe("tenant-scoping middleware", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await registerAuthenticateHook(app);
    // Throwaway routes -- no such production route exists yet, this just proves the hook.
    app.get("/api/whoami", async (request) => ({ locationId: request.locationId }));
    app.post("/api/auth/test-exempt", async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("401s with no token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/whoami" });
    expect(res.statusCode).toBe(401);
  });

  it("401s with an invalid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/whoami",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("decorates locationId with a valid token", async () => {
    const token = signSessionToken(
      { locationId: "loc-123", userId: "u1", userName: "Test" },
      env.SESSION_JWT_SECRET,
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/whoami",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ locationId: "loc-123" });
  });

  it("does not require a token for /api/auth/* routes", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/test-exempt" });
    expect(res.statusCode).toBe(200);
  });
});
