# Voice AI Observability Copilot for HighLevel

See `BUILD_SPEC.md` for the full spec and `docs/DECISIONS.md` for the tradeoff log.
This file is intentionally minimal right now — the full README (functional-vs-mocked
table, sandbox install steps, demo notes) is Phase 7 scope. What's here is just what
Phase 4's Definition of Done requires: the golden set number.

## Golden set

`npm run eval:golden` (from `apps/api/`, or `npm run eval:golden` at the repo root)
runs the LLM judge against every hand-labeled call in `apps/api/test/golden/` and
reports per-criterion and overall agreement.

**Observed range so far: 77.8%-88.9%** (14-16 of 18) across 3 hand-labeled calls (1
real sandbox call, 2 synthetic), across two consecutive runs on identical input.
BUILD_SPEC's target is 20 hand-labeled calls — not yet reached, pending either more
real sandbox test calls or Phase 7's `scripts/seed.ts`.

**The run-to-run variance itself is a real finding, not noise to average away.**
BUILD_SPEC specifies "temperature 0 everywhere" for reproducibility, but
`claude-sonnet-5` rejects the `temperature` parameter outright (`"deprecated for
this model"` — confirmed via a live API call, see `docs/DECISIONS.md`-style
findings in `eval/generateScorecard.ts`/`eval/judge.ts`). The judge therefore runs
at whatever the API's default sampling is, not temperature 0, and verdicts on
borderline criteria are measurably not stable run-to-run. This is a genuine
limitation of the current model generation versus BUILD_SPEC's original design
assumption, not a bug in the harness — worth resolving (a seed parameter? accepting
the non-determinism?) before leaning on this number for anything higher-stakes than
a smoke test.

Both disagreements in the 88.9% run were inspected, not just counted:
- `no_tool_fallback_response` on the real call: judge said `pass`, golden label said
  `not_applicable`. Genuinely ambiguous — the agent's actual behavior (telling the
  caller a team member would follow up) matches the criterion's pass condition even
  though the caller never asked an explicitly unmatched question. Defensible either
  way; not treated as a clear judge error.
- `no_assumptions_or_guesses` on the real call: judge said `fail`, golden label said
  `pass`. On inspection, the judge is right and the hand-label was wrong — the agent
  converted the caller's "tomorrow" into an absolute date ("August third, twenty
  twenty-six") that the caller never stated, which is exactly the kind of inference
  this criterion is meant to catch.
