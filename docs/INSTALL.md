# Install — sandbox setup

Numbered steps to go from a clean checkout to the app running live inside a
HighLevel sandbox sub-account. This is the exact process used to build and verify
every phase of this project — not a theoretical setup guide.

## 1. Prerequisites

- Node.js 22+, Docker (for Postgres + Redis), `cloudflared` (or any tunnel that
  gives you a public HTTPS URL to your local machine).
- A HighLevel account with access to the [Marketplace developer
  portal](https://marketplace.gohighlevel.com/) and its Testing tab.
- An Anthropic API key.

## 2. Create the HighLevel side first

1. In the developer portal's **Testing** tab, create an agency account and a
   sandbox sub-account under it.
2. In that sub-account, create a real Voice AI agent (not a mock) and place a
   handful of test calls — this app has nothing to show without real call data.
   Aim for deliberate variety (a clean success, an off-script question, an
   abandoned booking, etc.) rather than repeats of the same scenario.
3. Create a **dev app** in the developer portal:
   - Distribution: **sub-account**.
   - **OAuth Redirect URL**: `<your tunnel URL>/oauth/callback` — you won't have
     the tunnel URL yet; come back and set this after step 5.
   - **Custom Page**: left navigation, sub-account distribution, pointing at
     `<your tunnel URL>` — same caveat, fill in after step 5.
4. Note down, from the app's settings: Client ID, Client Secret, App ID, and the
   SSO/shared secret (the portal may call this the SSO key; this project's `.env`
   name for it is `GHL_APP_SHARED_SECRET`).

## 3. Local environment

```bash
git clone <repo>
cd voice-ai-observability
npm install
docker compose up -d          # Postgres + Redis
```

Create `.env` at the repo root with:

```bash
# HighLevel
GHL_CLIENT_ID=
GHL_CLIENT_SECRET=
GHL_APP_SHARED_SECRET=        # SSO/shared secret from the portal
GHL_APP_ID=
GHL_LOCATION_ID=              # your sandbox sub-account's location id
GHL_WEBHOOK_SECRET=           # invent your own value
PUBLIC_APP_URL=               # your tunnel URL, see step 5 -- update this whenever the tunnel restarts

# Auth/crypto
SESSION_JWT_SECRET=           # invent your own value
TOKEN_ENCRYPTION_KEY=         # 64 hex chars (32 bytes) -- e.g. `openssl rand -hex 32`

# Infra -- ports match this repo's docker-compose.yml (5433/6380, not the Postgres/
# Redis defaults, to avoid clashing with any natively-installed instance)
REDIS_URL=redis://localhost:6380
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/voiceobs

# LLM
ANTHROPIC_API_KEY=
```

`GHL_API_BASE`, `GHL_API_VERSION`, `MODEL_EVAL`, `MODEL_SYNTHESIS`, `PORT`, and
`EVAL_CONCURRENCY` all have working defaults (see `apps/api/src/config/env.ts`) —
only set them if you need to override.

```bash
npm run db:migrate            # applies apps/api/prisma/schema.prisma
npm run build
npm run dev
```

`npm run dev` starts both the API (port 3000) and the Vite dev server (port 5173).
The API also serves the built frontend from `apps/api/public` — that's the single
origin the Custom Page will actually load in step 6.

## 4. Tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

Copy the `https://<random>.trycloudflare.com` URL it prints. Quick tunnels like
this mint a **new random URL every time they restart** — if `cloudflared` ever
dies or you reboot, repeat this step and step 5.

## 5. Wire the tunnel URL into both HighLevel and your `.env`

Two places in the Marketplace portal, plus your local `.env`, all need the exact
same current tunnel URL:

1. `.env`'s `PUBLIC_APP_URL` — restart `npm run dev` after changing this (it's only
   read at process boot).
2. Portal → your app → **Auth/OAuth settings** → Redirect URL →
   `<tunnel URL>/oauth/callback`.
3. Portal → your app → **Custom Page** URL → `<tunnel URL>`.

## 6. Install and connect

1. From the sandbox sub-account's app marketplace, install your dev app. This runs
   the real OAuth code exchange against `/oauth/callback` and creates a real
   `Installation` row (`authMode: OAUTH`).
2. Open the app's Custom Page from the sub-account's left navigation. It should
   show "Connecting to HighLevel…" briefly (the SSO `postMessage` handshake), then
   land on Overview.
3. Go to **Setup**, trigger a backfill to pull your real agent and calls, then
   **Generate scorecard** for the agent.

At this point you have a real scorecard, real ingested calls (evaluation runs
automatically per call — no manual step), and a working dashboard.

Near-real-time ingestion via a HighLevel Workflow (Transcript Generated trigger +
a Custom Webhook action pointing at `<tunnel URL>/webhooks/ghl/voice-ai`, with an
`x-webhook-secret` header matching your `.env`'s `GHL_WEBHOOK_SECRET`) is optional
— the 60-second delta poll covers ingestion either way.

## Troubleshooting

- **"No response from parent frame after 5s"**: expected if you open the app URL
  directly in a browser tab instead of through the HighLevel sub-account's Custom
  Page — there's no SSO handshake without a real parent iframe.
- **401 on every API call right after loading**: usually the tunnel URL is stale in
  one of the three places in step 5 — check all three match exactly.
- **Cloudflare 530 on the tunnel URL**: the `cloudflared` process died; repeat
  steps 4 and 5.
