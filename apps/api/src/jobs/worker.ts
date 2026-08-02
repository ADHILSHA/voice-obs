import { Worker } from "bullmq";
import pino from "pino";
import { ingestCall } from "../ingest/ingestCall.js";
import { runBackfill } from "./backfillJob.js";
import { pollAllInstallations } from "./deltaPoller.js";
import { JOBS_QUEUE_NAME, queueConnection, type IngestCallJobData, type RunBackfillJobData } from "./queue.js";

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
        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }
    },
    { connection: queueConnection },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, "job completed");
  });
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, "job failed");
  });

  return worker;
}
