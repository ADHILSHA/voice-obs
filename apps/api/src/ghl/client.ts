import { z } from "zod";
import { env } from "../config/env.js";

// The one module that calls HighLevel over HTTP (CLAUDE.md hard rule). Only auth-
// necessary calls today: OAuth code/token exchange and a PIT-validation probe.
// Data-fetching endpoints (call logs, agents, ...) are Phase 2 scope and get added
// here, not in a new file.

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
  const res = await ghlFetch(`/locations/${locationId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: env.GHL_API_VERSION,
      Accept: "application/json",
    },
  });
  return res.ok;
}
