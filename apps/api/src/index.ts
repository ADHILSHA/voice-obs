import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { env } from "./config/env.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

await app.register(fastifyStatic, {
  root: path.join(dirname, "../public"),
});

app.get("/health", async () => ({ status: "ok" }));

await app.listen({ port: env.PORT, host: "0.0.0.0" });
