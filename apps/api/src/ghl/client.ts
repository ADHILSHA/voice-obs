import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { env } from "../config/env.js";
import { logParseFailure } from "../db/ghlParseFailures.js";

// The one module that calls HighLevel over HTTP (CLAUDE.md hard rule).

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Version: env.GHL_API_VERSION, Accept: "application/json" };
}

async function parseOrLog<T>(
  schema: z.ZodType<T>,
  json: unknown,
  locationId: string,
  endpoint: string,
): Promise<T> {
  const result = schema.safeParse(json);
  if (!result.success) {
    // Per §6.1: log the raw body, then throw a typed error -- never silently coerce.
    await logParseFailure(locationId, endpoint, json as Prisma.InputJsonValue);
    throw new Error(`GHL response from ${endpoint} failed validation: ${result.error.message}`);
  }
  return result.data;
}

const MAX_ATTEMPTS = 4;

async function ghlFetch(path: string, init: RequestInit): Promise<Response> {
  let attempt = 0;
  for (;;) {
    attempt++;
    const res = await fetch(`${env.GHL_API_BASE}${path}`, init);

    if (res.ok) return res;
    const isRetryable = res.status === 429 || res.status >= 500;
    if (!isRetryable || attempt >= MAX_ATTEMPTS) return res;

    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
    const backoffMs = retryAfterMs ?? Math.min(1000 * 2 ** (attempt - 1), 8000);
    const jitterMs = Math.random() * 250;
    await new Promise((resolve) => setTimeout(resolve, backoffMs + jitterMs));
  }
}

// Verified against HighLevel's docs for a sub-account (Location) distributed app:
// https://marketplace.gohighlevel.com/docs/Authorization/TargetUserSubAccount/
const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  scope: z.string(),
  userType: z.enum(["Company", "Location"]),
  companyId: z.string(),
  userId: z.string(),
  locationId: z.string().optional(),
  isBulkInstallation: z.boolean().optional(),
});

export type GhlTokenResponse = z.infer<typeof tokenResponseSchema>;

async function requestToken(params: Record<string, string>): Promise<GhlTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.GHL_CLIENT_ID,
    client_secret: env.GHL_CLIENT_SECRET,
    user_type: "Location",
    ...params,
  });

  const res = await ghlFetch("/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`GHL OAuth token request failed: ${res.status} ${JSON.stringify(json)}`);
  }
  // Zod parse failure throws directly here (typed error, nothing silently coerced).
  // A dedicated ghl_parse_failures log table is Phase 2 scope alongside the rest of
  // the typed data-fetching client.
  return tokenResponseSchema.parse(json);
}

export function exchangeOAuthCode(code: string): Promise<GhlTokenResponse> {
  return requestToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${env.PUBLIC_APP_URL}/oauth/callback`,
  });
}

export function refreshOAuthToken(refreshToken: string): Promise<GhlTokenResponse> {
  return requestToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

const locationTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
});

export interface GhlLocationTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  locationId: string;
  companyId: string;
}

// Converts a Company-level (agency) grant into a token scoped to one specific
// location. Confirmed via HighLevel's docs and a working curl example:
// POST /oauth/locationToken, Authorization: Bearer <agency access token>,
// form body { companyId, locationId }.
export async function getLocationAccessToken(
  agencyAccessToken: string,
  companyId: string,
  locationId: string,
): Promise<GhlLocationTokenResponse> {
  const body = new URLSearchParams({ companyId, locationId });

  const res = await ghlFetch("/oauth/locationToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Version: env.GHL_API_VERSION,
      Authorization: `Bearer ${agencyAccessToken}`,
    },
    body,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`GHL location-token exchange failed: ${res.status} ${JSON.stringify(json)}`);
  }

  const parsed = locationTokenResponseSchema.parse(json);
  return { ...parsed, locationId, companyId };
}

// Confirmed endpoint (https://marketplace.gohighlevel.com/docs/ghl/locations/get-location/):
// GET /locations/:locationId, Bearer auth, works with a PIT. Used only to prove a
// pasted PIT is valid for the claimed location -- the response body isn't consumed.
export async function validateLocationAccess(token: string, locationId: string): Promise<boolean> {
  const res = await ghlFetch(`/locations/${locationId}`, { method: "GET", headers: authHeaders(token) });
  return res.ok;
}

// Verified against a real captured call from the Phase 0 spike (test/fixtures/).
// recordingUrl is deliberately absent from this schema -- confirmed absent (key
// missing, not null) on every sample call so far; if it ever appears it'll just be
// stripped by Zod until this schema is updated to expect it.
const callLogEntrySchema = z.object({
  id: z.string(),
  contactId: z.string().optional(),
  createdAt: z.string(),
  duration: z.number(),
  agentId: z.string(),
  isAgentDeleted: z.boolean(),
  summary: z.string().optional(),
  transcript: z.string(),
  translation: z.unknown().nullable().optional(),
  extractedData: z.record(z.string(), z.unknown()).optional(),
  trialCall: z.boolean().optional(),
  executedCallActions: z.array(z.unknown()),
  agentTransferOccurred: z.boolean().optional(),
});

export type GhlCallLogEntry = z.infer<typeof callLogEntrySchema>;
export { callLogEntrySchema };

const callLogsListResponseSchema = z.object({
  callLogs: z.array(callLogEntrySchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export async function listCallLogs(
  token: string,
  locationId: string,
  params: { page: number; pageSize: number },
): Promise<z.infer<typeof callLogsListResponseSchema>> {
  const query = new URLSearchParams({
    locationId,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  const res = await ghlFetch(`/voice-ai/dashboard/call-logs?${query}`, {
    method: "GET",
    headers: authHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`listCallLogs failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return parseOrLog(callLogsListResponseSchema, json, locationId, "listCallLogs");
}

export async function getCallLog(
  token: string,
  locationId: string,
  callId: string,
): Promise<GhlCallLogEntry> {
  const res = await ghlFetch(`/voice-ai/dashboard/call-logs/${callId}?locationId=${locationId}`, {
    method: "GET",
    headers: authHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`getCallLog failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return parseOrLog(callLogEntrySchema, json, locationId, "getCallLog");
}

// Verified against a real live call to this project's own sandbox during Phase 2
// planning -- /voice-ai/dashboard/agents (naive path-symmetry with call-logs) 422s;
// this is the real path. Fields not needed downstream (voiceId, language, timezone,
// working hours, etc.) are deliberately left out of the schema rather than guessed.
const agentSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  agentName: z.string(),
  agentPrompt: z.string(),
  actions: z.array(z.unknown()),
});

export type GhlAgent = z.infer<typeof agentSchema>;

const agentsListResponseSchema = z.object({
  agents: z.array(agentSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export async function listAgents(
  token: string,
  locationId: string,
): Promise<z.infer<typeof agentsListResponseSchema>> {
  const res = await ghlFetch(`/voice-ai/agents?locationId=${locationId}`, {
    method: "GET",
    headers: authHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`listAgents failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return parseOrLog(agentsListResponseSchema, json, locationId, "listAgents");
}

export async function getAgent(token: string, locationId: string, ghlAgentId: string): Promise<GhlAgent> {
  const res = await ghlFetch(`/voice-ai/agents/${ghlAgentId}?locationId=${locationId}`, {
    method: "GET",
    headers: authHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`getAgent failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return parseOrLog(agentSchema, json, locationId, "getAgent");
}
