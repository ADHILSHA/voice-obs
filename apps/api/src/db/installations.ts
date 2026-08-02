import { AuthMode } from "../../generated/prisma/client.js";
import type { Installation } from "../../generated/prisma/client.js";
import { env } from "../config/env.js";
import { decryptToken, encryptToken } from "../lib/crypto.js";
import { prisma } from "./client.js";

// PITs don't expire on a schedule we control. Installation.expiresAt is non-nullable
// in the schema (it's meaningful for OAUTH installs), so PIT rows get a sentinel far
// in the future; tokens.ts never checks it for authMode = PIT.
const PIT_SENTINEL_EXPIRY = new Date("2099-01-01T00:00:00Z");

export interface OAuthTokens {
  locationId: string;
  companyId?: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export async function upsertOAuthInstallation(tokens: OAuthTokens): Promise<Installation> {
  const accessToken = encryptToken(tokens.accessToken, env.TOKEN_ENCRYPTION_KEY);
  const refreshToken = encryptToken(tokens.refreshToken, env.TOKEN_ENCRYPTION_KEY);

  return prisma.installation.upsert({
    where: { locationId: tokens.locationId },
    create: {
      locationId: tokens.locationId,
      companyId: tokens.companyId ?? null,
      accessToken,
      refreshToken,
      expiresAt: tokens.expiresAt,
      authMode: AuthMode.OAUTH,
    },
    update: {
      companyId: tokens.companyId ?? null,
      accessToken,
      refreshToken,
      expiresAt: tokens.expiresAt,
      authMode: AuthMode.OAUTH,
    },
  });
}

export async function upsertPitInstallation(locationId: string, pit: string): Promise<Installation> {
  const accessToken = encryptToken(pit, env.TOKEN_ENCRYPTION_KEY);

  return prisma.installation.upsert({
    where: { locationId },
    create: {
      locationId,
      accessToken,
      refreshToken: "",
      expiresAt: PIT_SENTINEL_EXPIRY,
      authMode: AuthMode.PIT,
    },
    update: {
      accessToken,
      authMode: AuthMode.PIT,
    },
  });
}

export async function getInstallationByLocationId(locationId: string): Promise<Installation | null> {
  return prisma.installation.findUnique({ where: { locationId } });
}

export async function updateOAuthTokens(
  locationId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
): Promise<Installation> {
  return prisma.installation.update({
    where: { locationId },
    data: {
      accessToken: encryptToken(accessToken, env.TOKEN_ENCRYPTION_KEY),
      refreshToken: encryptToken(refreshToken, env.TOKEN_ENCRYPTION_KEY),
      expiresAt,
    },
  });
}

export function decryptAccessToken(installation: Installation): string {
  return decryptToken(installation.accessToken, env.TOKEN_ENCRYPTION_KEY);
}

export function decryptRefreshToken(installation: Installation): string {
  return decryptToken(installation.refreshToken, env.TOKEN_ENCRYPTION_KEY);
}
