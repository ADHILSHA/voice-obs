import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db/client.js";
import { upsertOAuthInstallation } from "../../src/db/installations.js";
import { refreshOAuthToken } from "../../src/ghl/client.js";
import { resolveAccessToken } from "../../src/ghl/tokens.js";

// Integration test against real Postgres + Redis (docker-compose) -- only the
// outbound GHL HTTP call is mocked. This is what actually proves the Redis lock in
// lib/redis.ts does its job, not just that the code compiles.
vi.mock("../../src/ghl/client.js", () => ({
  refreshOAuthToken: vi.fn(),
  exchangeOAuthCode: vi.fn(),
  validateLocationAccess: vi.fn(),
}));

const LOCATION_ID = "loc-test-tokens";

describe("resolveAccessToken", () => {
  beforeEach(async () => {
    vi.mocked(refreshOAuthToken).mockReset();
    vi.mocked(refreshOAuthToken).mockImplementation(async () => ({
      access_token: `new-access-${Date.now()}-${Math.random()}`,
      token_type: "Bearer",
      expires_in: 86399,
      refresh_token: `new-refresh-${Date.now()}-${Math.random()}`,
      scope: "test",
      userType: "Location",
      companyId: "company-1",
      userId: "user-1",
      locationId: LOCATION_ID,
    }));
    await prisma.installation.deleteMany({ where: { locationId: LOCATION_ID } });
  });

  afterAll(async () => {
    await prisma.installation.deleteMany({ where: { locationId: LOCATION_ID } });
    await prisma.$disconnect();
  });

  it("returns the current token without refreshing when well within expiry", async () => {
    await upsertOAuthInstallation({
      locationId: LOCATION_ID,
      accessToken: "current-access",
      refreshToken: "current-refresh",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const token = await resolveAccessToken(LOCATION_ID);
    expect(token).toBe("current-access");
    expect(refreshOAuthToken).not.toHaveBeenCalled();
  });

  it("refreshes when within the 5-minute window", async () => {
    await upsertOAuthInstallation({
      locationId: LOCATION_ID,
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      expiresAt: new Date(Date.now() + 60 * 1000),
    });

    const token = await resolveAccessToken(LOCATION_ID);
    expect(refreshOAuthToken).toHaveBeenCalledTimes(1);
    expect(token).not.toBe("stale-access");
  });

  it("does not double-refresh under concurrent callers", async () => {
    await upsertOAuthInstallation({
      locationId: LOCATION_ID,
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      expiresAt: new Date(Date.now() + 60 * 1000),
    });

    const [tokenA, tokenB, tokenC] = await Promise.all([
      resolveAccessToken(LOCATION_ID),
      resolveAccessToken(LOCATION_ID),
      resolveAccessToken(LOCATION_ID),
    ]);

    expect(refreshOAuthToken).toHaveBeenCalledTimes(1);
    expect(tokenA).toBe(tokenB);
    expect(tokenB).toBe(tokenC);
  });
});
