import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { upsertOAuthInstallation } from "../../db/installations.js";
import { exchangeOAuthCode, getLocationAccessToken, type GhlTokenResponse } from "../../ghl/client.js";

const callbackQuerySchema = z.object({
  code: z.string().min(1),
});

interface LocationGrant {
  locationId: string;
  companyId: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// HighLevel's "Test Link" developer-testing shortcut issues a Company-level
// (agency) grant even when the app's Target User is Sub-account -- confirmed
// empirically against this app's actual portal config, not assumed. A real
// customer install is expected to return a Location-level grant directly. We only
// ever operate on the one sandbox location BUILD_SPEC scopes this project to, so
// on a Company grant we exchange for that location's token specifically rather
// than trying to enumerate whatever the bulk install covered.
async function resolveLocationGrant(tokenResponse: GhlTokenResponse): Promise<LocationGrant> {
  if (tokenResponse.userType !== "Company") {
    throw new Error(
      `OAuth token response had no locationId and an unexpected userType: ${tokenResponse.userType}`,
    );
  }
  return getLocationAccessToken(tokenResponse.access_token, tokenResponse.companyId, env.GHL_LOCATION_ID);
}

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/oauth/callback", async (request, reply) => {
    const { code } = callbackQuerySchema.parse(request.query);
    const tokenResponse = await exchangeOAuthCode(code);

    const locationGrant: LocationGrant = tokenResponse.locationId
      ? {
          locationId: tokenResponse.locationId,
          companyId: tokenResponse.companyId,
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token,
          expires_in: tokenResponse.expires_in,
        }
      : await resolveLocationGrant(tokenResponse);

    await upsertOAuthInstallation({
      locationId: locationGrant.locationId,
      companyId: locationGrant.companyId,
      accessToken: locationGrant.access_token,
      refreshToken: locationGrant.refresh_token,
      expiresAt: new Date(Date.now() + locationGrant.expires_in * 1000),
    });

    return reply.redirect(env.PUBLIC_APP_URL);
  });
}
