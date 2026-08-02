import { AuthMode } from "../../generated/prisma/client.js";
import {
  decryptAccessToken,
  decryptRefreshToken,
  getInstallationByLocationId,
  updateOAuthTokens,
} from "../db/installations.js";
import { withLock } from "../lib/redis.js";
import { refreshOAuthToken } from "./client.js";

const REFRESH_AHEAD_MS = 5 * 60 * 1000;

// The only place OAuth refresh logic lives. Given a locationId, returns a bearer
// token that's valid right now -- a decrypted PIT as-is, or a decrypted OAuth
// access token, refreshing ahead of expiry (serialized via a Redis lock) if needed.
export async function resolveAccessToken(locationId: string): Promise<string> {
  const installation = await getInstallationByLocationId(locationId);
  if (!installation) {
    throw new Error(`No installation found for locationId ${locationId}`);
  }

  if (installation.authMode === AuthMode.PIT) {
    return decryptAccessToken(installation);
  }

  if (installation.expiresAt.getTime() - Date.now() > REFRESH_AHEAD_MS) {
    return decryptAccessToken(installation);
  }

  return withLock(`token-refresh:${locationId}`, async () => {
    // Someone else may have refreshed while we waited for the lock -- re-read
    // rather than trusting the copy fetched before we acquired it.
    const fresh = await getInstallationByLocationId(locationId);
    if (!fresh) {
      throw new Error(`Installation for ${locationId} disappeared during refresh`);
    }
    if (fresh.expiresAt.getTime() - Date.now() > REFRESH_AHEAD_MS) {
      return decryptAccessToken(fresh);
    }

    const refreshToken = decryptRefreshToken(fresh);
    const tokenResponse = await refreshOAuthToken(refreshToken);
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);
    const updated = await updateOAuthTokens(
      locationId,
      tokenResponse.access_token,
      tokenResponse.refresh_token,
      expiresAt,
    );
    return decryptAccessToken(updated);
  });
}
