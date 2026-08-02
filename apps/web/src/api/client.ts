export interface SsoLoginResponse {
  token: string;
  user: Record<string, unknown>;
  locationId: string;
}

export async function postSsoLogin(encryptedPayload: string): Promise<SsoLoginResponse> {
  const res = await fetch("/api/auth/sso", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encryptedPayload }),
  });

  if (!res.ok) {
    throw new Error(`/api/auth/sso -> ${res.status} ${await res.text()}`);
  }

  return res.json();
}
