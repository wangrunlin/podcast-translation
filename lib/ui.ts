import type { JobStage, JobStatus } from "@/lib/types";

export const statusLabel: Record<JobStatus, string> = {
  queued: "Queued",
  extracting: "Extracting",
  transcribing: "Transcribing",
  translating: "Translating",
  synthesizing: "Synthesizing",
  packaging: "Packaging",
  completed: "Completed",
  failed: "Failed",
};

export const stageLabel: Record<JobStage, string> = {
  queued: "Waiting for worker",
  extracting: "Fetching audio",
  transcribing: "Transcribing English speech",
  translating: "Translating to Chinese",
  synthesizing: "Generating Chinese voice",
  packaging: "Preparing player assets",
  completed: "Ready to play",
  failed: "Stopped with an error",
};

export function formatJobDuration(seconds: number | null) {
  if (!seconds || Number.isNaN(seconds)) {
    return "Unknown";
  }

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export function formatJobAge(updatedAt: string) {
  const diff = Date.now() - new Date(updatedAt).getTime();
  const mins = Math.max(1, Math.floor(diff / 60000));
  if (mins < 60) {
    return `${mins} min ago`;
  }

  const hours = Math.floor(mins / 60);
  return `${hours} hr ago`;
}

export function formatJobTimestamp(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

export function isTerminalStatus(status: JobStatus) {
  return status === "completed" || status === "failed";
}
