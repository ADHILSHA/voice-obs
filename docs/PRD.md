# PRD — Voice AI Observability Copilot for HighLevel

## Problem

HighLevel's Voice AI agents run real phone calls, but there's no systematic way to
know whether an agent is actually doing its job well. Call logs exist; a QA process
that scores every call against explicit criteria, finds recurring failure patterns,
and turns them into a concrete prompt fix does not. Today that loop is manual —
someone has to listen to calls, notice a pattern, and remember to go edit the
agent's prompt in HighLevel. It doesn't happen at any real volume.

This app automates the **Monitor** and **Analyze** phases of that loop: ingest every
call, score it against a scorecard generated from the agent's own prompt, surface
failures with evidence pinned to specific transcript turns, cluster recurring
failures into a recommendation with a minimal prompt diff, and write the applied
fix back into the real agent — closing the loop instead of just reporting on it.

```
scorecard -> evaluation -> finding -> clustered recommendation -> prompt patch -> re-measure
```

The "re-measure" step (the impact panel on an applied recommendation) is the
differentiator over a chart page that just shows scores going up and down. It's
also the piece most exposed to real data being sparse, which shaped the
clustering threshold and the manual (not automatic) trigger.

## Users

- **The HighLevel sub-account owner / operator** running Voice AI agents who wants
  to know, without listening to every call, whether the agent is actually working
  and what specifically to fix when it isn't. This is the only user this app is
  built for — no separate admin/reviewer role, no multi-seat permissioning.

## Non-goals

Per BUILD_SPEC §1 — written here explicitly so they don't get built by accident:

- **Real-time mid-call intervention.** This is a post-call analysis layer, not a
  live-call coach or barge-in tool.
- **Multi-tenant scale hardening beyond a single sandbox location.** The
  tenant-isolation pattern (`locationId` from the decrypted session JWT, never a
  body/query param) is real and enforced everywhere, but this has only ever been
  run against one real sandbox location. No load testing, no cross-location
  performance work.
- **Billing, plans, or agency-level rollups across many sub-accounts.** Single
  location, single agent, no aggregation layer.
- **Replacing HighLevel's native call log UI.** This is an analysis layer on top of
  Voice AI, not a call-log browser — there's deliberately no general "browse all
  calls" list view; the two ways into a call's transcript are a specific finding
  (Overview's "Needs attention") or a filtered taxonomy click, both landing on the
  Call Inspector, not a paginated table.

## What "done" looks like

The full loop, live, against a real sandbox, not a mock:
1. A real Voice AI agent's prompt generates a real scorecard.
2. A real call gets ingested (webhook or 60s poll) and evaluated (LLM judge +
   deterministic checks) automatically, cached by input hash.
3. A failing criterion is reachable from Overview in two clicks, with the specific
   evidence turn highlighted.
4. A recurring failure pattern becomes a recommendation with a synthesized,
   minimal prompt diff.
5. Applying it writes the real agent's prompt in HighLevel — verified independently
   against HighLevel's own API, not just the local cache — and the impact panel
   starts tracking a real baseline-vs-current comparison.

Every one of those five steps has been live-verified against the real sandbox at
least once, not just unit-tested against mocks. Where something is real-but-narrow
(one hardcoded action-item trigger rule, a 2-occurrence clustering threshold tuned
for low data volume) or genuinely unbuilt (a `HUMAN_REQUESTED` detector,
DETERMINISTIC-method criteria), that's disclosed in the README's
functional-vs-mocked table rather than silently implied to work.
