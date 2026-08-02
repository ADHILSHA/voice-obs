import { Job, Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

// Separate connection from lib/redis.ts's -- BullMQ requires maxRetriesPerRequest:
// null on any connection used for blocking queue operations.
export const queueConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const JOBS_QUEUE_NAME = "jobs";

// One queue for every background job type in this app (ingest-call, run-backfill,
// delta-poll) -- one Worker (jobs/worker.ts) dispatches by job name rather than
// managing a separate queue/connection per job type.
export const jobsQueue = new Queue(JOBS_QUEUE_NAME, { connection: queueConnection });

export interface IngestCallJobData {
  type: "ingest-call";
  locationId: string;
  ghlCallId: string;
}

export function enqueueIngestCall(locationId: string, ghlCallId: string): Promise<unknown> {
  const data: IngestCallJobData = { type: "ingest-call", locationId, ghlCallId };
  return jobsQueue.add("ingest-call", data, {
    jobId: `ingest-call:${locationId}:${ghlCallId}`,
  });
}

export interface RunBackfillJobData {
  type: "run-backfill";
  locationId: string;
  days: number;
}

export function enqueueBackfill(locationId: string, days: number): Promise<Job<RunBackfillJobData>> {
  const data: RunBackfillJobData = { type: "run-backfill", locationId, days };
  return jobsQueue.add("run-backfill", data);
}

const DELTA_POLL_INTERVAL_MS = 60_000;

// BullMQ v6 schedules repeatable jobs via upsertJobScheduler, not `repeat` on
// .add() (deprecated). upsert is idempotent -- calling this on every server start
// doesn't create duplicate schedules.
export function scheduleDeltaPoll(): Promise<unknown> {
  return jobsQueue.upsertJobScheduler(
    "delta-poll-schedule",
    { every: DELTA_POLL_INTERVAL_MS },
    { name: "delta-poll" },
  );
}
