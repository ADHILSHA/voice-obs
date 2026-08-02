# BUILD SPEC — Voice AI Observability Copilot for HighLevel

---

## 1. Mission

Build a HighLevel Marketplace app that automates the **Monitor** and **Analyze** phases for
Voice AI agents. It ingests Voice AI call transcripts, scores them against per-agent success
criteria, surfaces failures in a dashboard embedded inside HighLevel, and produces concrete
prompt patches that can be written back to the agent.

The product thesis is a **closed loop**, not a chart page:

```
scorecard -> evaluation -> finding -> clustered recommendation -> prompt patch -> re-measure
```

The "re-measure" step is the differentiator. Build the mechanism even if the demo seeds part
of the historical data.

### Three core domain objects

| Object | Meaning |
|---|---|
| **Scorecard** | The observability parameters (KPIs) for one agent. Generated from the agent's own prompt, then human-editable. Versioned. |
| **Finding** | One criterion failing on one call, with evidence pinned to specific transcript turn indices. |
| **Recommendation** | A cluster of findings sharing a root cause, plus a minimal proposed prompt diff and the % of call volume affected. |

### Non-goals (write these in the README; do not build them)

- Real-time mid-call intervention.
- Multi-tenant scale hardening beyond a single sandbox location.
- Billing, plans, agency-level rollups across many sub-accounts.
- Replacing HighLevel's native call log UI. We are an analysis layer on top of it.

---

## 2. Ground truth about the HighLevel platform

These facts are verified. Treat anything not listed here as unknown until the Phase 0 spike
confirms it.

**Voice AI public API** (auth: `Bearer` — a sub-account OAuth access token OR a sub-account
Private Integration Token):

- `GET /voice-ai/dashboard/call-logs` — list call logs scoped to a location. Supports filtering
  by agent, contact, call type, action types and date range (interpreted in a supplied IANA
  timezone), plus sorting and **1-based** pagination.
- `GET /voice-ai/dashboard/call-logs/{callId}` — single call detail, including transcript.
- Agents endpoints — list / get / update agents (this is how we read the agent's prompt and
  how we write a patch back).
- Actions endpoints — the agent's configured actions.

Base URL: `https://services.leadconnectorhq.com`. Send `Version: 2021-07-28` (confirm the
current version header against the docs during the spike).

**Custom Pages**: a Marketplace app can host a Custom Page that HighLevel renders in an
embedded iframe loading an externally hosted URL. Placement is either the app details page or
the left navigation. Use **left navigation, sub-account distribution**, so the app sits next
to the native AI Agents area.

**SSO in the iframe**: the Custom Page requests session info from the parent HighLevel frame
via `postMessage`. HighLevel returns an encrypted payload, which the backend decrypts using
the SSO key from the Marketplace developer portal. Reference implementation:
`GoHighLevel/ghl-marketplace-app-template`.

**Near-real-time trigger**: HighLevel workflows expose a *Transcript Generated* trigger. A
workflow using that trigger plus a Custom Webhook action gives us push ingestion without
polling. HighLevel also supports bulk CSV export of Voice AI call logs — that is our documented
fallback.

**Unknown until the spike — do not design around assumptions:**

- The exact transcript shape (array of turns with timestamps vs. one flat string).
- Whether recording URLs are returned by the API and whether they are publicly fetchable.
- The shape of `actionsTriggered` metadata.
- The exact webhook payload from a Custom Webhook workflow action.
- Whether the agent update endpoint accepts a partial prompt patch.

---

## 3. Stack and repo layout

- **Backend**: Node.js 22, TypeScript, Fastify, Prisma + PostgreSQL, BullMQ + Redis, Zod.
- **Frontend**: Vue 3 (`<script setup>`), Vite, TypeScript, Pinia, Vue Router, Tailwind.
- **LLM**: Anthropic SDK. `claude-sonnet-4-6` for per-call evaluation, a larger model for
  cross-call synthesis. Temperature 0 everywhere. All model IDs in config, never inline.
- **Charts**: a small library or hand-rolled SVG. Do not pull in a heavy dashboard framework.

```
/
  README.md
  BUILD_SPEC.md
  docs/
    ARCHITECTURE.md
    DECISIONS.md          # decision log, 5+ entries with tradeoffs
    INSTALL.md            # sandbox install steps, screenshot-friendly
    PRD.md                # one page: problem, users, non-goals
  apps/
    api/
      src/
        config/           # env parsing (Zod), model IDs, constants
        ghl/              # HighLevel client: auth, rate limit, retries, typed endpoints
        ingest/           # backfill job, webhook route, delta poller, normalizer
        eval/             # deterministic checks, LLM judge, scoring, prompts/
        insights/         # clustering, recommendation synthesis, impact tracking
        http/             # routes, auth middleware, error handler
        jobs/             # BullMQ queues, workers, schedules
        db/               # prisma client, repositories
        lib/              # redaction, hashing, logger, result types
      prisma/schema.prisma
      test/
        fixtures/         # REAL captured payloads from the spike, redacted
        golden/           # 20 hand-labeled calls + expected verdicts
    web/
      src/
        views/            # Overview, AgentDetail, CallInspector, ActionQueue, Setup
        components/
        stores/
        api/              # typed client for our own backend
        styles/
  scripts/
    seed.ts               # synthetic calls covering every failure mode
    capture-fixtures.ts   # dumps real API responses into test/fixtures
```

Single repo, npm workspaces. One `docker-compose.yml` for Postgres + Redis.

---

## 4. Environment variables

```
DATABASE_URL=
REDIS_URL=
PORT=3000
PUBLIC_APP_URL=            # tunnel URL; must match the Custom Page URL in the portal

GHL_CLIENT_ID=
GHL_CLIENT_SECRET=
GHL_SSO_KEY=               # from the Marketplace portal, used to decrypt the SSO payload
GHL_API_BASE=https://services.leadconnectorhq.com
GHL_API_VERSION=2021-07-28
GHL_WEBHOOK_SECRET=        # shared secret we put in the workflow's custom webhook header

ANTHROPIC_API_KEY=
MODEL_EVAL=claude-sonnet-4-6
MODEL_SYNTHESIS=claude-sonnet-4-6

SESSION_JWT_SECRET=
TOKEN_ENCRYPTION_KEY=      # 32-byte key, AES-256-GCM for OAuth tokens at rest
LOG_LEVEL=info
```

Ship `.env.example` with every key and a one-line comment. Never commit real values.

---

## 5. Data model

Prisma sketch. Adjust field types after the Phase 0 spike, but keep these entities and these
relationships.

```prisma
model Installation {
  id             String   @id @default(cuid())
  locationId     String   @unique
  companyId      String?
  accessToken    String   // AES-256-GCM ciphertext
  refreshToken   String
  expiresAt      DateTime
  authMode       AuthMode // OAUTH | PIT
  installedAt    DateTime @default(now())
  lastSyncedAt   DateTime?
  syncCursor     DateTime? // watermark for the delta poller
}

model Agent {
  id             String   @id @default(cuid())
  locationId     String
  ghlAgentId     String
  name           String
  promptSnapshot String   @db.Text   // last known agent prompt
  promptFetchedAt DateTime
  scorecards     Scorecard[]
  calls          Call[]
  @@unique([locationId, ghlAgentId])
}

model Scorecard {
  id          String   @id @default(cuid())
  agentId     String
  version     Int
  isActive    Boolean  @default(true)
  source      ScorecardSource // GENERATED | TEMPLATE | MANUAL
  criteria    Criterion[]
  createdAt   DateTime @default(now())
  @@unique([agentId, version])
}

model Criterion {
  id             String @id @default(cuid())
  scorecardId    String
  key            String            // stable slug, survives version bumps: "books_appointment"
  name           String
  description    String @db.Text   // what "pass" looks like, written for the judge
  category       CriterionCategory // GOAL | DATA_CAPTURE | KNOWLEDGE | CONTAINMENT | COMPLIANCE | CONVERSATIONAL
  severity       Severity          // LOW | MEDIUM | HIGH | CRITICAL
  weight         Float  @default(1)
  method         EvalMethod        // DETERMINISTIC | LLM
  deterministicRule Json?          // only when method = DETERMINISTIC
}

model Call {
  id             String   @id @default(cuid())
  locationId     String
  agentId        String
  ghlCallId      String
  direction      String?  // no source field in the API at all; nullable until a call type surfaces one
  startedAt      DateTime // populated from the API's `createdAt` -- there is no distinct call-start timestamp
  durationSec    Int
  endedReason    String?  // no raw source field either; stays null unless synthesized from the transcript's last turn
  actionsTriggered Json   // maps from the API's `executedCallActions`; populated-entry shape unconfirmed (n=1, zero actions fired so far)
  recordingUrl   String?  // confirmed absent (key missing, not null) on every sample call so far
  contactRef     String?  // opaque, never a raw phone number; maps from the API's `contactId`
  summary        String?  @db.Text // GHL's own generated call summary; not in the original spec, useful as judge context
  extractedData  Json?    // structured slot-capture data from the call; empty object on every sample so far, populated shape unconfirmed
  isTrialCall    Boolean  @default(false) // maps from `trialCall` -- GHL's own test-call flag, distinct from our seed-script `isSynthetic`
  isAgentDeleted Boolean  @default(false) // maps from `isAgentDeleted`; the agent may no longer be fetchable via the agents endpoint
  translation    Json?    // null on every sample so far; shape unconfirmed
  rawPayload     Json     // redacted
  turns          Turn[]
  evaluations    Evaluation[]
  @@unique([locationId, ghlCallId])
  @@index([agentId, startedAt])
}

model Turn {
  id       String @id @default(cuid())
  callId   String
  idx      Int      // 0-based, THE anchor for all evidence references
  role     TurnRole // AGENT | CALLER | SYSTEM
  text     String   @db.Text
  startMs  Int?
  @@unique([callId, idx])
}

model Evaluation {
  id               String   @id @default(cuid())
  callId           String
  scorecardVersion Int
  promptVersion    String   // hash of our judge prompt template
  inputHash        String   // sha256(transcript + scorecard + promptVersion)
  healthScore      Float
  metrics          Json     // deterministic outputs: talkRatio, deadAirMs, reAsks, etc.
  results          CriterionResult[]
  createdAt        DateTime @default(now())
  @@unique([callId, inputHash])
}

model CriterionResult {
  id            String  @id @default(cuid())
  evaluationId  String
  criterionKey  String
  verdict       Verdict // PASS | PARTIAL | FAIL | NOT_APPLICABLE
  confidence    Float
  evidenceTurns Int[]
  rationale     String  @db.Text
  rootCause     RootCause? // MISSING_INSTRUCTION | AMBIGUOUS_INSTRUCTION | KNOWLEDGE_GAP |
                           // FLOW_ORDERING | GUARDRAIL_MISSING | CALLER_SIDE
}

model Recommendation {
  id            String @id @default(cuid())
  agentId       String
  criterionKey  String
  rootCause     RootCause
  title         String
  body          String @db.Text
  promptDiff    Json     // { before: string, after: string, insertAfterLine?: number }
  affectedCalls Int
  affectedPct   Float
  severity      Severity
  evidenceCallIds String[]
  status        RecStatus // OPEN | APPLIED | DISMISSED
  appliedAt     DateTime?
  baselineRate  Float?    // criterion pass rate at time of apply
  createdAt     DateTime  @default(now())
}

model ActionItem {
  id        String @id @default(cuid())
  callId    String
  reason    ActionReason // HUMAN_REQUESTED | HIGH_INTENT_LOST | COMPLIANCE_MISS | KNOWLEDGE_GAP
  severity  Severity
  status    ActionStatus // OPEN | IN_PROGRESS | RESOLVED | DISMISSED
  assignee  String?
  note      String?
  createdAt DateTime @default(now())
}
```

Note: `Criterion.key` is stable across scorecard versions. All results, recommendations and
trend queries join on `criterionKey`, never on `Criterion.id`. Bumping a scorecard version must
not orphan history.

---

## 6. Backend contracts

### 6.1 HighLevel client (`src/ghl/`)

One module, no HighLevel calls anywhere else in the codebase.

- Token resolution: given a `locationId`, return a valid bearer token, refreshing if it expires
  within 5 minutes. Serialize refreshes per installation (Redis lock) so concurrent jobs do not
  double-refresh.
- Retries: exponential backoff with jitter on 429 and 5xx, max 4 attempts, respect
  `Retry-After`. Never retry 4xx other than 429.
- Every response parsed through a Zod schema. On parse failure, log the raw body to a
  `ghl_parse_failures` table and throw a typed error — do not silently coerce.
- Expose: `listCallLogs(params)`, `getCallLog(callId)`, `listAgents()`, `getAgent(id)`,
  `updateAgent(id, patch)`.

### 6.2 Ingestion (`src/ingest/`)

Three entry points, one destination.

1. **Backfill** — `POST /api/sync/backfill { days }` enqueues a job that pages through call
   logs oldest-first, fetches detail per call, normalizes, upserts, then enqueues evaluation
   jobs. Report progress to Redis so the UI can poll a percentage.
2. **Webhook** — `POST /webhooks/ghl/voice-ai`. Verify the shared secret header, respond 200
   within 100ms, enqueue the rest. Log every payload to `webhook_events` for replay.
3. **Delta poller** — cron every 60s per installation. Query call logs with
   `startedAt > syncCursor`, advance the watermark only after successful upsert. This exists
   because webhooks drop; the two paths will race and that is fine.

**Idempotency**: upsert on `(locationId, ghlCallId)`. Evaluation jobs use `inputHash` as the
BullMQ job ID so a re-ingested call never re-bills an LLM call.

**Normalizer**: the single function that converts any source shape into `Call` + `Turn[]`.
Every branch of it must be covered by a fixture test. If the transcript arrives as a flat
string, split on speaker labels and document the heuristic in a comment.

**Redaction** runs before persistence and before any LLM call:
- Phone numbers, emails, digit runs of 12+ (card-like), and street addresses -> placeholder
  tokens (`{{PHONE_1}}`).
- Store the mapping encrypted on the `Call` so the UI can re-hydrate for the operator.
- Names are kept — they matter for evaluating whether the agent captured the caller's name.

### 6.3 Evaluation (`src/eval/`)

Deterministic checks run first, cost nothing, and are fed to the judge as context:

| Metric | Definition |
|---|---|
| `talkRatioAgent` | agent chars / total chars |
| `turnCount` | total turns |
| `reAskCount` | agent turns with >0.85 normalized similarity to an earlier agent turn |
| `deadAirMaxMs` | max gap between consecutive turn `startMs` (null if no timestamps) |
| `actionFired` | whether each configured action appears in `actionsTriggered` |
| `endedAbruptly` | `endedReason` in a configured set, or last turn is a caller turn mid-sentence |
| `callerAskedForHuman` | regex bank over caller turns |

Judge call: **one request per call**, all LLM criteria batched. Structured JSON only.

```
System: You are evaluating a completed voice AI phone call against a scorecard.
        You are strict, evidence-based, and you never invent quotes.
User:   <agent_prompt>...</agent_prompt>
        <scorecard>[{key, name, description, category}]</scorecard>
        <deterministic_metrics>{...}</deterministic_metrics>
        <transcript>[0] AGENT: ...  [1] CALLER: ...</transcript>

        For each criterion return:
          verdict: pass | partial | fail | not_applicable
          confidence: 0..1
          evidenceTurns: array of turn indices you actually used
          rationale: one sentence, cite what happened, no speculation
          rootCause: only when verdict is fail or partial, one of
            missing_instruction | ambiguous_instruction | knowledge_gap |
            flow_ordering | guardrail_missing | caller_side
        Use not_applicable when the call never reached the situation the criterion
        describes. Do not penalize an agent for a goal the caller never wanted.
        Return JSON only.
```

Rules the implementation must enforce:

- Validate the response with Zod. On invalid JSON, retry once with the parse error appended,
  then fail the job loudly. Never accept a partially-parsed result.
- Drop any `evidenceTurns` index that does not exist on the call, and flag the result as
  low-trust if all indices were invalid. This is the cheapest hallucination guard available.
- `rootCause: caller_side` never generates a recommendation.
- Cache on `inputHash`; a cache hit must not call the API at all.
- Concurrency cap from config, default 4.

**Health score**: `sum(weight * verdictValue) / sum(weight)` over applicable criteria only,
where pass=1, partial=0.5, fail=0. `not_applicable` is excluded from both numerator and
denominator. Agent health = mean over a rolling 7-day window.

### 6.4 Insights (`src/insights/`)

Runs on a schedule and on demand per agent.

1. Group open findings by `(criterionKey, rootCause)` over the last 30 days.
2. Threshold: emit a recommendation only at `>= 3` occurrences, or `>= 1` when
   `severity = CRITICAL`. Below threshold, the cluster still shows in the UI as a "watching"
   signal with no patch.
3. For each qualifying cluster, send the agent's current prompt plus 3–5 representative
   evidence excerpts and ask for a **minimal patch**: the smallest text addition or edit that
   would prevent this failure. Explicitly forbid a full prompt rewrite in the system prompt.
4. Store `promptDiff` as `{ before, after }` so the UI can render a real diff.
5. Deduplicate against existing OPEN recommendations for the same `(criterionKey, rootCause)`
   — update the counts instead of creating a second row.

**Impact tracking**: on apply, snapshot `baselineRate` (that criterion's pass rate over the
prior 30 days) and stamp `appliedAt`. Any call after `appliedAt` is the "after" cohort. The UI
shows before vs. after once the after cohort has at least 5 calls, and says
"collecting data (n/5)" before that. Never render a before/after claim on n < 5.

### 6.5 Our own HTTP API

All routes under `/api`, all requiring a session JWT except the webhook and OAuth callback.

```
POST   /api/auth/sso                 body: { encryptedPayload } -> { token, user, locationId }
GET    /oauth/callback               code exchange, upsert Installation, redirect
POST   /api/auth/pit                 body: { token } -> validates and stores a PIT install

GET    /api/agents                   list with health score + trend
GET    /api/agents/:id
POST   /api/agents/:id/scorecard/generate    -> draft scorecard from the agent prompt
GET    /api/agents/:id/scorecard
PUT    /api/agents/:id/scorecard     body: full criteria array -> creates a new version

POST   /api/sync/backfill            { days } -> { jobId }
GET    /api/sync/status              -> { state, processed, total, lastSyncedAt }

GET    /api/calls                    filters: agentId, verdict, criterionKey, from, to, page
GET    /api/calls/:id                call + turns + evaluation + criterion results
POST   /api/calls/:id/reevaluate

GET    /api/insights/overview        KPI cards, taxonomy breakdown, worst criteria
GET    /api/recommendations          filters: agentId, status
POST   /api/recommendations/:id/apply     writes the patch back to the GHL agent
POST   /api/recommendations/:id/dismiss   body: { reason }
GET    /api/recommendations/:id/impact    before/after for an applied recommendation

GET    /api/actions                  the human-intervention queue
PATCH  /api/actions/:id              { status, assignee, note }

POST   /webhooks/ghl/voice-ai        no session; shared-secret header
```

**Tenant isolation**: `locationId` comes only from the decrypted session JWT. A `locationId`
in a query string or body is ignored. Every Prisma query in a request path is scoped by the
session's `locationId`. Write one integration test that proves location A cannot read location
B — a reviewer will look for exactly this.

---

## 7. Frontend

Five routes. Styled to feel native to HighLevel: neutral greys, restrained accent colour, 6px
radii, no gradients, no drop shadows beyond a hairline border. It must not look like a
different product bolted into an iframe.

### Setup (`/setup`)
First-run: connection state, backfill trigger with progress, scorecard generation per agent.
An empty account must never show an empty dashboard with no path forward.

### Overview (`/`)
- Header KPIs: calls analyzed, mean agent health, open recommendations, action queue depth.
- Agent cards: name, health score, 7-day sparkline, top failing criterion, call count.
- Failure taxonomy: breakdown by `rootCause` with counts. Clicking filters the call list.
- "Needs attention" strip: the 5 most recent critical findings.

### Agent detail (`/agents/:id`)
- Criterion table: name, category, pass rate, trend arrow, failing call count. Sortable.
- Recommendations for this agent, each expandable to the diff.
- Scorecard editor (drawer): add / edit / remove criteria, set weight and severity, save as a
  new version with a confirmation that explains versioning.

### Call inspector (`/calls/:id`)
**This is the screen the demo sells. Build it carefully.**
- Left: transcript as turns. Turns cited by a failing criterion get a coloured left border.
- Right: criterion list with verdict pills, confidence, and rationale. Hovering a criterion
  highlights its `evidenceTurns` in the transcript and scrolls the first one into view.
- Header: duration, ended reason, actions fired, health score, deterministic metrics as chips.
- Audio player when `recordingUrl` exists; hide the control entirely when it does not, rather
  than showing a dead button.
- Redacted spans render as a subtle chip; a "reveal" toggle re-hydrates them.

### Action queue (`/actions`)
A real work queue: filter by reason and status, assign, add a note, resolve, dismiss. Each row
links to the call inspector at the relevant turn.

### Frontend rules
- No `localStorage` for session state — the iframe context is hostile to it. Keep the JWT in
  memory in a Pinia store; on reload, re-run the SSO handshake.
- Every list view has explicit loading, empty and error states. Empty states say what to do
  next, not "no data".
- Numbers that are estimates are labelled as estimates.
- One typed API client module. No `fetch` calls scattered through components.

---

## 8. Phases

Work in this order. Each phase ends with a commit and a working state.

### Phase 0 — Spike and de-risk (do first, no exceptions)

1. Create the agency account, a sandbox sub-account from the developer portal Testing tab, and
   a dev app with sub-account distribution, an OAuth redirect URL, and a Custom Page pointing
   at your tunnel.
2. Build one real Voice AI agent in the sandbox. Place 8–10 test calls that deliberately
   include: a pricing question the agent cannot answer, a request for a human, a skipped
   qualification question, a hangup mid-booking, and two clean successes.
3. Write `scripts/capture-fixtures.ts`. Hit the call logs list and detail endpoints with a PIT
   and dump raw JSON into `test/fixtures/`. **Read the output before writing any schema.**
4. Prove the iframe SSO handshake end to end: postMessage -> encrypted payload -> backend
   decrypt -> user object.

**Acceptance**: `test/fixtures/` contains real redacted payloads, and a deployed page inside
HighLevel renders the logged-in user's name.

If (3) fails, fall back to CSV import and record it in `docs/DECISIONS.md`. If (4) fails, fall
back to a manual location-ID entry screen. Decide by the end of Phase 0 — not on day five.

### Phase 1 — Auth and shell

OAuth install and token refresh, PIT paste as an escape hatch, session JWT, tenant scoping
middleware, app shell with routing and layout, health endpoint, docker-compose up.

**Acceptance**: install the app into the sandbox, land on `/setup`, see the location name.
Tokens survive a restart and refresh automatically.

### Phase 2 — Ingestion

Normalizer with fixture tests, backfill job with progress, webhook route, delta poller,
redaction, idempotent upserts.

**Acceptance**: a backfill imports every sandbox call; placing a new test call makes it appear
within 60 seconds without a manual refresh of the backfill; running the backfill twice creates
zero duplicate rows.

### Phase 3 — Scorecards

Prompt-to-scorecard generation, three starter templates (lead qualification, appointment
booking, support triage), scorecard editor with versioning.

**Acceptance**: generating a scorecard from the sandbox agent's real prompt produces 6–10
sensible criteria. Editing and saving creates version 2 without breaking version 1's stored
results.

### Phase 4 — Evaluation engine

Deterministic checks, LLM judge, Zod validation, evidence-index validation, caching, health
scoring, the golden set.

**Acceptance**: every ingested call has an evaluation. Re-running costs zero API calls.
`npm run eval:golden` reports agreement against the 20 hand-labeled calls and the number is
written into the README.

### Phase 5 — Dashboard

Overview, agent detail, call inspector, action queue.

**Acceptance**: from the overview you can reach a specific failing turn of a specific call in
two clicks. Hover-to-highlight works. All five states (loading, empty, error, partial, full)
are reachable and non-broken.

### Phase 6 — Recommendations and the loop

Clustering, minimal-patch synthesis, diff rendering, apply / copy / dismiss, write-back to the
agent, impact tracking.

**Acceptance**: applying a recommendation changes the agent's prompt in HighLevel (verify in
the native UI), and the impact panel shows a baseline plus a "collecting data" state.

### Phase 7 — QA, docs, demo

Tests green, README with the functional-vs-mocked table, `docs/INSTALL.md` with numbered
sandbox steps, `docs/DECISIONS.md` with 5+ tradeoffs, `docs/PRD.md`, seed script for the demo.

---

## 9. Testing

- **Fixture tests** on the normalizer for every real payload captured in Phase 0. These are the
  highest-value tests in the repo.
- **Golden set**: 20 hand-labeled calls in `test/golden/` with expected verdicts per criterion.
  `npm run eval:golden` prints per-criterion agreement and overall accuracy. Run it in CI.
  This artifact is the proof that the judge is a validated instrument rather than a vibe.
- **Integration**: webhook -> job -> evaluation -> readable via the API, on a real DB.
- **Security**: a test asserting that a session for location A returns 403/404 for location B's
  call.
- Do not chase coverage percentages. Cover the normalizer, the scoring math, the tenant guard,
  and the judge-response validator.

---

## 10. Seeding and mocking

`scripts/seed.ts` generates synthetic calls covering every criterion category and every root
cause, so the dashboard is dense enough to demo and so recommendation clustering has enough
support to fire. Seeded calls are tagged `isSynthetic: true` and the UI shows a small badge on
them. Never blur the line between real and seeded data — the README table below is graded.

Maintain this table in the README and keep it honest:

| Real | Mocked / limited |
|---|---|
| OAuth install + SSO iframe session | Multi-tenant scale (one sandbox tested) |
| Live call log and transcript ingestion | Before/after impact partly uses seeded history |
| Deterministic checks + LLM evaluation | Recording playback if the API returns no URL |
| Clustering and prompt patch write-back | Assignee list (no real user directory sync) |

---

## 11. Code standards

The brief says "non-slop code" and promises a manual review. That constrains style:

- No commented-out code, no `TODO` left in a shipped file, no placeholder functions that
  return `null`.
- No defensive `try/catch` that swallows an error and returns a default. Errors propagate to a
  single handler that logs with context and returns a typed error response.
- No comment that restates the line below it. Comments explain *why* — a non-obvious API quirk,
  a deliberate tradeoff, a heuristic's assumptions.
- Names carry meaning: `evidenceTurns`, not `arr`. `criterionPassRate`, not `rate2`.
- Functions do one thing. The normalizer is allowed to be long; a route handler is not.
- Zod at every boundary: HighLevel responses, webhook payloads, LLM outputs, our own request
  bodies. Types inferred from schemas, never hand-written twice.
- Structured logging with `locationId`, `callId`, `jobId`. No `console.log` outside scripts.
- Prompts live in `src/eval/prompts/*.ts` as exported template functions with a version
  constant. Never inline a prompt string in business logic.
- Conventional commits, one phase per branch, meaningful messages.

---

## 12. Demo script (4 minutes, record last)

1. **0:00–0:30** — the problem: scroll the native HighLevel Voice AI call log manually. "This
   is the current workflow: read every transcript yourself."
2. **0:30–1:15** — setup: connect, backfill runs, scorecard auto-generates from the agent's
   own prompt, quick edit of one criterion.
3. **1:15–2:15** — overview: agent health, failure taxonomy, click through the worst criterion.
4. **2:15–3:15** — call inspector: hover a failing criterion, watch the exact turns light up.
   This is the moment that lands.
5. **3:15–4:00** — recommendation with the prompt diff, apply it, show the changed prompt in
   HighLevel's native UI, then the impact panel.

Pre-warm all data. Never let the recording depend on a live LLM call completing on camera.

---

## 13. Definition of done

- [ ] App installs into a fresh sandbox by following `docs/INSTALL.md` only.
- [ ] Real transcripts ingest via webhook and poller, backfill included.
- [ ] Every call has an evaluation traceable to a scorecard version and prompt version.
- [ ] Every finding points at real turn indices that exist on that call.
- [ ] Recommendations render a diff and can be written back to the agent.
- [ ] Impact panel shows baseline and after-cohort state with an honest n.
- [ ] Golden set agreement number is in the README.
- [ ] Functional-vs-mocked table is in the README and is accurate.
- [ ] `docs/DECISIONS.md` has 5+ real tradeoffs, including anything the Phase 0 spike forced.
- [ ] `npm test` green, `npm run lint` clean, no dead code.
