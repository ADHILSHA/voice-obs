import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "./client.js";

export async function logParseFailure(
  locationId: string,
  endpoint: string,
  rawBody: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.ghlParseFailure.create({
    data: { locationId, endpoint, rawBody },
  });
}
