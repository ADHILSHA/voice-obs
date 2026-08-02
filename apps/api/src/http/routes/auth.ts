import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { decryptSsoPayload, extractLocationId } from "../../ghl/sso.js";

const ssoRequestSchema = z.object({
  encryptedPayload: z.string().min(1),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/sso", async (request, reply) => {
    const { encryptedPayload } = ssoRequestSchema.parse(request.body);
    const user = decryptSsoPayload(encryptedPayload, env.GHL_APP_SHARED_SECRET);
    const locationId = extractLocationId(user);
    return reply.send({ user, locationId });
  });
}
