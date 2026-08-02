import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

const dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(dirname, "../../../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  // BUILD_SPEC.md calls this GHL_SSO_KEY; the actual .env in this project has it as
  // GHL_APP_SHARED_SECRET (matching the ghl-marketplace-app-template naming instead).
  GHL_APP_SHARED_SECRET: z.string().min(1),
});

export const env = envSchema.parse(process.env);
