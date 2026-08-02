import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { env } from "./config/env.js";
import { registerAuthenticateHook } from "./http/middleware/authenticate.js";
import { registerAuthRoutes } from "./http/routes/auth.js";
import { registerOAuthRoutes } from "./http/routes/oauth.js";
import { registerPitRoutes } from "./http/routes/pit.js";

const app = Fastify({ logger: true });

await registerAuthenticateHook(app);
await registerAuthRoutes(app);
await registerOAuthRoutes(app);
await registerPitRoutes(app);

// Resolved from cwd, not import.meta.url: dev (tsx, running src/) and build (tsc,
// emitting to dist/src/) put this file at different depths, but both are always
// started with apps/api as cwd via the workspace scripts.
await app.register(fastifyStatic, {
  root: path.join(process.cwd(), "public"),
});

app.get("/health", async () => ({ status: "ok" }));

await app.listen({ port: env.PORT, host: "0.0.0.0" });
