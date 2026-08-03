# Voice AI Observability Copilot for HighLevel

A HighLevel Marketplace app that scores Voice AI phone calls against a
per-agent scorecard, surfaces failures with evidence pinned to specific
transcript turns, clusters recurring failures into a recommended prompt fix,
and writes the applied fix back into the real agent — a closed loop, not a
chart page. See `docs/PRD.md` for the problem/users/non-goals and
`BUILD_SPEC.md` for the full spec.

## Setup

`docs/INSTALL.md` has the full numbered sandbox setup (HighLevel Marketplace
app, tunnel, `.env`, local infra).

## What's real vs. what isn't

Every "functional" row below has been exercised against a real HighLevel
sandbox — a real agent, real calls, a real LLM judge, a real prompt write-back
— not just unit-tested against a mock. Where something is narrower than it
sounds, or genuinely unbuilt, that's stated here rather than left implicit.

| Area | Status |
|---|---|
| OAuth install, token refresh | **Functional.** Live since Phase 1; every later phase's live verification ran through a real OAuth-issued token, not the Phase 0 PIT spike. |
| SSO iframe session | **Functional.** Real `postMessage` handshake with the HighLevel parent frame; no session outside the iframe (by design — see `docs/INSTALL.md`'s troubleshooting section). |
| Ingestion (webhook, backfill, delta poll) | **Functional**, with a caveat: the 60s delta poll has done all real ingestion so far. The webhook route (`/webhooks/ghl/voice-ai`) works and is tested, but a real HighLevel Workflow (Transcript Generated trigger → Custom Webhook action) pointing at it has never actually been confirmed configured. |
| Redaction + reveal | **Functional.** PII redacted to `{{TOKEN}}` placeholders at ingest; encrypted reveal map decryptable on demand, round-tripped against real data. |
| Scorecard generation + editing + versioning | **Functional.** LLM-generated from the real agent prompt, human-editable, each save creates a new version without touching prior evaluation history. |
| Evaluation (deterministic checks + LLM judge) | **Functional**, cached by input hash. **Not deterministic run-to-run**: `claude-sonnet-5` rejects `temperature`, so verdicts on borderline criteria can vary between identical runs — see the golden-set numbers below. |
| DETERMINISTIC-method criteria | **Schema/enum exists, unused in practice.** Only `LLM`-method criteria have ever actually been generated or evaluated. |
| Dashboard (Setup, Overview, Agent Detail, Call Inspector, Action Queue) | **Functional**, all 5 screens, real data, all loading/empty/error states real (not filler). |
| Recommendations (cluster → synthesize → apply → impact) | **Functional**, live-verified end to end including a real write to a real agent's live prompt in HighLevel, confirmed independently against HighLevel's own API. Manually triggered, not automatic — clustering threshold (2+ occurrences) is tuned low for this project's real data volume, not a production default. |
| Action Queue population | **Functional**, one trigger rule: any `CRITICAL`-severity criterion `FAIL` creates an action item, automatically, on every evaluation. `HUMAN_REQUESTED` is a real enum value nothing currently produces — no detector for an explicit "let me talk to a person" moment exists yet. |
| Multi-tenant support | **Explicit non-goal.** Tenant isolation (`locationId` from the session JWT only) is real and enforced everywhere, but only ever run against one sandbox location. |
| `packages/shared` type sharing | **Removed.** Scaffolded in Phase 0, never actually imported by either app across any phase. |
| `scripts/seed.ts` | **Not built.** BUILD_SPEC lists a synthetic seed script for the demo; this project used real sandbox calls throughout instead. |

## Testing

```bash
npm test        # unit + integration, mocks the Anthropic boundary, real Postgres
npm run eval:golden   # runs the real judge against the hand-labeled golden set
```

`npm run lint` exists as a script but **`eslint` was never actually installed or
configured** — no config file, no dependency, across any phase of this build,
despite CLAUDE.md's workflow calling for it before every phase. Left undone
rather than silently added as a new dependency this late.

### Golden set

`npm run eval:golden` runs the LLM judge against every hand-labeled call in
`apps/api/test/golden/` and reports per-criterion and overall agreement.

**Observed range: 77.8%-88.9%** (14-16 of 18) across 3 hand-labeled calls (1
real sandbox call, 2 synthetic), across two consecutive runs on identical
input. BUILD_SPEC's target is 20 hand-labeled calls — not reached; no
`scripts/seed.ts` was built to synthesize the rest, and real sandbox call
volume stayed below that during this build (see the table above).

**The run-to-run variance is a real finding, not noise to average away.**
BUILD_SPEC specifies "temperature 0 everywhere" for reproducibility, but
`claude-sonnet-5` rejects the `temperature` parameter outright (`"deprecated
for this model"` — confirmed via a live API call). The judge runs at whatever
the API's default sampling is, and verdicts on borderline criteria are
measurably not stable run-to-run — a genuine limitation versus BUILD_SPEC's
design assumption, not something to lean on for anything higher-stakes than a
smoke test as-is.

Both disagreements in the 88.9% run were inspected, not just counted:
- `no_tool_fallback_response` on the real call: judge said `pass`, golden label
  said `not_applicable`. Genuinely ambiguous — the agent's actual behavior
  (telling the caller a team member would follow up) matches the criterion's
  pass condition even though the caller never asked an explicitly unmatched
  question. Defensible either way; not treated as a clear judge error.
- `no_assumptions_or_guesses` on the real call: judge said `fail`, golden label
  said `pass`. On inspection, the judge is right and the hand-label was wrong —
  the agent converted the caller's "tomorrow" into an absolute date ("August
  third, twenty twenty-six") the caller never stated, exactly the kind of
  inference this criterion is meant to catch.

## Docs index

- `docs/PRD.md` — problem, users, non-goals, one page.
- `docs/ARCHITECTURE.md` — module map, the evaluation and recommendation
  pipelines, one known structural deviation from BUILD_SPEC §3.
- `docs/INSTALL.md` — numbered sandbox setup steps.
