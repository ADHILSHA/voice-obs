import { Worker } from "bullmq";
import pino from "pino";
import { env } from "../config/env.js";
import { evaluateCall } from "../eval/evaluateCall.js";
import { ingestCall } from "../ingest/ingestCall.js";
import { runBackfill } from "./backfillJob.js";
import { pollAllInstallations } from "./deltaPoller.js";
import {
  JOBS_QUEUE_NAME,
  queueConnection,
  type EvaluateCallJobData,
  type IngestCallJobData,
  type RunBackfillJobData,
} from "./queue.js";

const logger = pino({ name: "jobs-worker" });

export function startWorker(): Worker {
  const worker = new Worker(
    JOBS_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case "ingest-call": {
          const data = job.data as IngestCallJobData;
          await ingestCall(data.locationId, data.ghlCallId);
          return;
        }
        case "run-backfill": {
          const data = job.data as RunBackfillJobData;
          await runBackfill(data.locationId, data.days);
          return;
        }
        case "delta-poll": {
          await pollAllInstallations();
          return;
        }
        case "evaluate-call": {
          const data = job.data as EvaluateCallJobData;
          await evaluateCall(data.callId);
          return;
        }
        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }
    },
    // §6.3: "Concurrency cap from config, default 4." Applied to the whole shared
    // worker rather than per-job-type -- simplest mechanism, and throttling
    // ingest/backfill too is harmless (arguably good) at this project's scale.
    { connection: queueConnection, concurrency: env.EVAL_CONCURRENCY },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, "job completed");
  });
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, "job failed");
  });

  return worker;
}
