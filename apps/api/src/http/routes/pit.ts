import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { upsertPitInstallation } from "../../db/installations.js";
import { validateLocationAccess } from "../../ghl/client.js";

const pitRequestSchema = z.object({
  token: z.string().min(1),
  locationId: z.string().min(1),
});

export async function registerPitRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/pit", async (request, reply) => {
    const { token, locationId } = pitRequestSchema.parse(request.body);

    const isValid = await validateLocationAccess(token, locationId);
    if (!isValid) {
      return reply.status(401).send({
        error: "PIT did not validate against GET /locations/:locationId for this locationId",
      });
    }

    await upsertPitInstallation(locationId, token);
    return reply.send({ locationId });
  });
}
