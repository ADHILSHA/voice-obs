import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { decryptSsoPayload, extractLocationId } from "../../ghl/sso.js";
import { signSessionToken } from "../../lib/jwt.js";

const ssoRequestSchema = z.object({
  encryptedPayload: z.string().min(1),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/sso", async (request, reply) => {
    const { encryptedPayload } = ssoRequestSchema.parse(request.body);
    const user = decryptSsoPayload(encryptedPayload, env.GHL_APP_SHARED_SECRET);
    const locationId = extractLocationId(user);

    if (!locationId) {
      return reply.status(400).send({ error: "SSO payload did not include a location context" });
    }

    const userId = typeof user.userId === "string" ? user.userId : null;
    const userName = typeof user.userName === "string" ? user.userName : null;
    if (!userId || !userName) {
      return reply.status(400).send({ error: "SSO payload missing userId/userName" });
    }

    const token = signSessionToken({ locationId, userId, userName }, env.SESSION_JWT_SECRET);

    return reply.send({ token, user, locationId });
  });
}
