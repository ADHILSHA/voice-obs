# CLAUDE.md

Read BUILD_SPEC.md before any task. It is the source of truth.

## Architecture
npm workspaces monorepo. `packages/shared` holds Zod schemas and types imported by both
`apps/api` (Fastify + Prisma + BullMQ) and `apps/web` (Vue 3 + Vite + Pinia + Tailwind).
The Vue app builds into `apps/api/public` and is served by the API. One origin, one deploy.

## Hard rules
- All HighLevel API calls go through `apps/api/src/ghl/client.ts`. Nowhere else.
- Zod validation at every boundary: GHL responses, webhooks, LLM output, our request bodies.
  Types are inferred from schemas, never declared twice.
- `locationId` comes only from the decrypted session JWT. Never from a body or query string.
- LLM prompts live in `apps/api/src/eval/prompts/` as versioned exported functions.
- No commented-out code, no TODOs, no placeholder functions that return null.
- No try/catch that swallows an error and returns a default.
- Comments explain why, never what.
- Structured logging with locationId/callId/jobId. No console.log outside `scripts/`.

## Workflow
- Ask before adding a dependency. Justify it in one line.
- Ask before creating a file outside the structure in BUILD_SPEC.md section 3.
- When the spec is ambiguous, stop and ask. Do not invent a HighLevel API field name.
- Run `npm test` and `npm run lint` before saying a phase is done.