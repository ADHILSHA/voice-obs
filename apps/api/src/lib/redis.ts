import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const redis = new Redis(env.REDIS_URL);

const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

// Serializes concurrent callers on the same key (e.g. one Installation's token
// refresh) so only one does the work at a time. Callers that were waiting should
// re-check state after acquiring -- the lock holder may have already done the work.
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; maxWaitMs?: number } = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? 10_000;
  const maxWaitMs = opts.maxWaitMs ?? 5_000;
  const lockKey = `lock:${key}`;
  const token = randomUUID();
  const deadline = Date.now() + maxWaitMs;

  let acquired = await redis.set(lockKey, token, "PX", ttlMs, "NX");
  while (!acquired && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    acquired = await redis.set(lockKey, token, "PX", ttlMs, "NX");
  }
  if (!acquired) {
    throw new Error(`Timed out waiting for lock: ${key}`);
  }

  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, lockKey, token);
  }
}
