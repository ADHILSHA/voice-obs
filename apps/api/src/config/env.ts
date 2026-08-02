import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";

// Resolved from cwd (always apps/api via the workspace scripts), not import.meta.url --
// dev (tsx, running src/) and build (tsc, emitting to dist/src/) put this file at
// different depths.
config({ path: path.join(process.cwd(), "../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  // BUILD_SPEC.md calls this GHL_SSO_KEY; the actual .env in this project has it as
  // GHL_APP_SHARED_SECRET (matching the ghl-marketplace-app-template naming instead).
  GHL_APP_SHARED_SECRET: z.string().min(1),

  GHL_CLIENT_ID: z.string().min(1),
  GHL_CLIENT_SECRET: z.string().min(1),
  GHL_API_BASE: z.string().url().default("https://services.leadconnectorhq.com"),
  GHL_API_VERSION: z.string().min(1).default("2021-07-28"),
  PUBLIC_APP_URL: z.string().url(),
  // Used only by the PIT-paste fallback path today, not by any real ingestion flow.
  GHL_LOCATION_ID: z.string().min(1),

  SESSION_JWT_SECRET: z.string().min(1),
  // 32 bytes, hex-encoded -- AES-256-GCM key for Installation token storage.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "must be 64 hex characters (32 bytes)"),

  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  DATABASE_URL: z.string().min(1),
});

export const env = envSchema.parse(process.env);
