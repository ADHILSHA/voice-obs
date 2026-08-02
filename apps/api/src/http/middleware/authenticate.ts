import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { verifySessionToken } from "../../lib/jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    locationId: string;
  }
}

// Applied to everything under /api/* except /api/auth/* (that's how a session gets
// established in the first place). /oauth/callback and /webhooks/* never match the
// /api/ prefix, so they're exempt without needing to be listed.
export async function registerAuthenticateHook(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/") || request.url.startsWith("/api/auth/")) {
      return;
    }

    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Missing session token" });
    }

    try {
      const claims = verifySessionToken(header.slice("Bearer ".length), env.SESSION_JWT_SECRET);
      request.locationId = claims.locationId;
    } catch {
      return reply.status(401).send({ error: "Invalid session token" });
    }
  });
}
