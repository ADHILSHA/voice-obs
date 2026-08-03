# Architecture

## Shape

npm workspaces monorepo, two apps, one deploy:

```
apps/web  (Vue 3 + Vite + Pinia)  --build-->  apps/api/public
apps/api  (Fastify + Prisma + BullMQ)  --serves-->  apps/api/public + /api/* + /oauth/* + /webhooks/*
```

One origin. The Vue app is a HighLevel Custom Page, embedded in an iframe inside a
HighLevel sub-account, authenticated via a `postMessage` SSO handshake with the
parent frame (`apps/web/src/stores/session.ts`) — there is no standalone login.

## Backend module map (`apps/api/src`)

- **`ghl/`** — the *only* place that calls the HighLevel API (`client.ts`, a hard
  rule from CLAUDE.md), plus OAuth token refresh (`tokens.ts`) and the SSO payload
  decrypt (`sso.ts`).
- **`ingest/`** — normalizes raw HighLevel call payloads into `Call`/`Turn` rows,
  redacting PII (phone numbers, etc.) into `{{TOKEN}}` placeholders with a
  separately-encrypted reveal map.
- **`eval/`** — the scoring/synthesis engine: deterministic checks, the LLM judge,
  health-score math, scorecard generation, and (Phase 6) recommendation clustering
  + synthesis + apply. All LLM prompts live in `eval/prompts/*.ts` as versioned
  exported functions (CLAUDE.md hard rule) — never inlined in business logic.
- **`db/`** — one repository module per domain object, thin wrappers around Prisma.
  Two recurring patterns worth knowing before reading the code: (1) several models
  (`Recommendation.agentId`, `ActionItem.callId`, `CriterionResult.criterionKey`)
  are plain scalar fields, not Prisma relations, by design — `criterionKey` in
  particular has to survive scorecard version bumps, so it can't be a foreign key
  to `Criterion.id`. Tenant-scoped queries against these resolve the parent's ids
  first, then filter by `in`, rather than a nested relation filter Prisma can't
  express. (2) `CriterionResult -> Evaluation -> Call` *are* real relations, so
  clustering queries there are direct nested filters.
- **`http/`** — Fastify routes + the tenant-isolation middleware
  (`middleware/authenticate.ts`): every `/api/*` route (except `/api/auth/*`)
  requires a valid session JWT, and `request.locationId` is decoded from that JWT
  — never accepted from a request body or query string, anywhere.
- **`jobs/`** — BullMQ queue + worker + two schedules: a 60-second delta poll
  (`deltaPoller.ts`) that's the ingestion backstop even if no webhook is
  configured, and a backfill job with progress tracking (`backfillJob.ts`).
- **`lib/`** — crypto (AES-256-GCM for token/redaction-map storage, plus the
  OpenSSL-compatible AES-256-CBC decrypt for the SSO payload), redaction, Redis
  lock helper.

## The evaluation pipeline

```
webhook or delta poll -> ingestCall.ts (normalize + redact) -> enqueue evaluate-call job
  -> evaluateCall.ts: cache check (inputHash) -> deterministic checks -> LLM judge
     -> persist Evaluation + CriterionResult rows -> checkForActionTriggers()
```

Fully automatic once a scorecard is active — no manual step per call. Caching is by
`sha256(transcript + scorecardVersion + judgePromptVersion)`: a call re-ingested
with no transcript or scorecard change is a zero-LLM-call no-op. Re-evaluating a
call (from the Call Inspector) deletes the cached `Evaluation` first, forcing a
fresh judge call regardless of the cache.

## The recommendation loop (Phase 6)

Manually triggered (a button, not automatic — clustering is only meaningful once
enough calls share a pattern, and running it after every single evaluation would
mostly be wasted queries):

```
"Find recommendations" -> findFailureClusters() [2+ occurrences of the same
  (criterionKey, rootCause)] -> synthesizeRecommendation() [LLM, minimal
  verbatim-substring prompt diff] -> persisted as Recommendation (OPEN)
  -> [human clicks Apply] -> applyRecommendation() [live prompt refetch,
  literal string replace, write to real HighLevel agent, baseline pass rate
  captured] -> impact computed on read (baseline vs. post-apply pass rate)
```

## Frontend (`apps/web/src`)

Five views (`views/`), matching BUILD_SPEC's five fixed routes: Setup, Overview,
Agent Detail, Call Inspector, Action Queue. One typed API client
(`api/client.ts`) — every backend call goes through it, no `fetch` scattered
through components. No chart library; `components/Sparkline.vue` is a hand-rolled
SVG polyline (BUILD_SPEC §3 explicitly rules out a heavy dashboard framework).

`AppShell.vue` uses `h-screen overflow-hidden` with `overflow-y-auto` scoped to the
main content pane specifically, not document-level scroll — the HighLevel iframe
doesn't reliably surface a scrollbar for whole-page scroll depending on how the
platform sizes the iframe.

## Known structural deviation from BUILD_SPEC §3

The spec describes recommendation/clustering logic living in a separate
`apps/api/src/insights/` folder. It was built inside `eval/` instead, alongside
the judge and scorecard-generation code it patterns-matches (same
prompt-builder-plus-LLM-call-plus-Zod-validation shape) — a deliberate choice,
not an oversight, made at the end of the build when moving files and rewriting
every import path was pure risk for a cosmetic gain right before a demo.
