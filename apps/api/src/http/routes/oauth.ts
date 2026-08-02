import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { upsertOAuthInstallation } from "../../db/installations.js";
import { exchangeOAuthCode } from "../../ghl/client.js";

const callbackQuerySchema = z.object({
  code: z.string().min(1),
});

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/oauth/callback", async (request, reply) => {
    const { code } = callbackQuerySchema.parse(request.query);
    const tokenResponse = await exchangeOAuthCode(code);

    if (!tokenResponse.locationId) {
      throw new Error(
        "OAuth token response had no locationId -- expected a Location-level install (userType=Location)",
      );
    }

    await upsertOAuthInstallation({
      locationId: tokenResponse.locationId,
      companyId: tokenResponse.companyId,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
    });

    return reply.redirect(env.PUBLIC_APP_URL);
  });
}
