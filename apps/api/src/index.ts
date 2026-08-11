import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { env } from "./config/env.js";
import { registerAuthenticateHook } from "./http/middleware/authenticate.js";
import { registerActionRoutes } from "./http/routes/actions.js";
import { registerAgentRoutes } from "./http/routes/agents.js";
import { registerAuthRoutes } from "./http/routes/auth.js";
import { registerCallRoutes } from "./http/routes/calls.js";
import { registerInsightsRoutes } from "./http/routes/insights.js";
import { registerOAuthRoutes } from "./http/routes/oauth.js";
import { registerPitRoutes } from "./http/routes/pit.js";
import { registerRecommendationRoutes } from "./http/routes/recommendations.js";
import { registerSyncRoutes } from "./http/routes/sync.js";
import { registerTestCaseRoutes } from "./http/routes/testCases.js";
import { registerWebhookRoutes } from "./http/routes/webhook.js";
import { scheduleDeltaPoll } from "./jobs/queue.js";
import { startWorker } from "./jobs/worker.js";

const app = Fastify({ logger: true });

await registerAuthenticateHook(app);
await registerAuthRoutes(app);
await registerOAuthRoutes(app);
await registerPitRoutes(app);
await registerSyncRoutes(app);
await registerWebhookRoutes(app);
await registerAgentRoutes(app);
await registerCallRoutes(app);
await registerInsightsRoutes(app);
await registerActionRoutes(app);
await registerRecommendationRoutes(app);
await registerTestCaseRoutes(app);

startWorker();
await scheduleDeltaPoll();

// Resolved from cwd, not import.meta.url: dev (tsx, running src/) and build (tsc,
// emitting to dist/src/) put this file at different depths, but both are always
// started with apps/api as cwd via the workspace scripts.
await app.register(fastifyStatic, {
  root: path.join(process.cwd(), "public"),
});

app.get("/health", async () => ({ status: "ok" }));

// Vue Router owns client-side routes like /calls/:id -- a direct load or
// refresh on one of those must still serve the SPA shell, not 404. API 404s
// stay JSON.
app.setNotFoundHandler((request, reply) => {
  if (request.method !== "GET" || request.url.startsWith("/api/")) {
    return reply.status(404).send({ error: "Not found" });
  }
  return reply.sendFile("index.html");
});

await app.listen({ port: env.PORT, host: "0.0.0.0" });
