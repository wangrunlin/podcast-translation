import { processJob } from "@/lib/worker";

const globalForQueue = globalThis as typeof globalThis & {
  __podcastJobQueue?: Set<string>;
};

const queue = globalForQueue.__podcastJobQueue ?? new Set<string>();

if (!globalForQueue.__podcastJobQueue) {
  globalForQueue.__podcastJobQueue = queue;
}

export function enqueueJob(jobId: string) {
  if (queue.has(jobId)) {
    return;
  }

  queue.add(jobId);

  void (async () => {
    try {
      await processJob(jobId);
    } finally {
      queue.delete(jobId);
    }
  })();
}
