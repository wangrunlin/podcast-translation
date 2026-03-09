import crypto from "node:crypto";
import { db } from "@/lib/db";
import type {
  CreateJobInput,
  JobRecord,
  JobStatus,
  SourcePlatform,
  TranscriptSegment,
} from "@/lib/types";

type DbJob = {
  id: string;
  session_id: string;
  source_url: string;
  source_type: string;
  platform: SourcePlatform;
  target_language: string;
  title: string | null;
  show_title: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  status: JobStatus;
  current_stage: JobStatus;
  error_code: string | null;
  error_message: string | null;
  audio_original_path: string | null;
  audio_translated_path: string | null;
  transcript_original_json: string;
  transcript_translated_json: string;
  transcript_bilingual_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function detectPlatform(sourceUrl: string): SourcePlatform {
  const normalized = sourceUrl.toLowerCase();

  if (normalized.includes("youtube.com") || normalized.includes("youtu.be")) {
    return "youtube";
  }

  if (normalized.includes("podcasts.apple.com")) {
    return "apple";
  }

  if (/\.(mp3|m4a|wav|ogg)(\?.*)?$/i.test(sourceUrl)) {
    return "direct";
  }

  return "unknown";
}

export function createJob(input: CreateJobInput) {
  const platform = detectPlatform(input.sourceUrl);

  if (platform === "unknown") {
    throw new Error(
      "This demo currently supports Apple Podcasts, YouTube podcast URLs, or direct audio files.",
    );
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.prepare(
    `
      INSERT INTO jobs (
        id, session_id, source_url, source_type, platform, target_language,
        title, show_title, cover_url, duration_seconds, status, current_stage,
        error_code, error_message, audio_original_path, audio_translated_path,
        transcript_original_json, transcript_translated_json, transcript_bilingual_json,
        created_at, updated_at, completed_at
      ) VALUES (
        @id, @sessionId, @sourceUrl, @sourceType, @platform, @targetLanguage,
        NULL, NULL, NULL, NULL, 'queued', 'queued',
        NULL, NULL, NULL, NULL,
        '[]', '[]', '[]',
        @createdAt, @updatedAt, NULL
      )
    `,
  ).run({
    id,
    sessionId: input.sessionId,
    sourceUrl: input.sourceUrl,
    sourceType: platform === "direct" ? "audio-url" : "page-url",
    platform,
    targetLanguage: input.targetLanguage,
    createdAt: now,
    updatedAt: now,
  });

  recordEvent(input.sessionId, id, "job_created", {
    sourceUrl: input.sourceUrl,
    platform,
  });

  return getJobById(id)!;
}

export function getJobById(id: string) {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
    | DbJob
    | undefined;

  return row ? mapJob(row) : null;
}

export function listRecentJobs(limit = 8) {
  const rows = db
    .prepare("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as DbJob[];

  return rows.map(mapJob);
}

export function listJobsBySession(sessionId: string, limit = 5) {
  const rows = db
    .prepare(
      "SELECT * FROM jobs WHERE session_id = ? ORDER BY updated_at DESC LIMIT ?",
    )
    .all(sessionId, limit) as DbJob[];

  return rows.map(mapJob);
}

export function updateJob(id: string, patch: Partial<JobRecord>) {
  const current = getJobById(id);
  if (!current) {
    throw new Error("Job not found.");
  }

  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `
      UPDATE jobs SET
        title = @title,
        show_title = @showTitle,
        cover_url = @coverUrl,
        duration_seconds = @durationSeconds,
        status = @status,
        current_stage = @currentStage,
        error_code = @errorCode,
        error_message = @errorMessage,
        audio_original_path = @audioOriginalPath,
        audio_translated_path = @audioTranslatedPath,
        transcript_original_json = @transcriptOriginalJson,
        transcript_translated_json = @transcriptTranslatedJson,
        transcript_bilingual_json = @transcriptBilingualJson,
        updated_at = @updatedAt,
        completed_at = @completedAt
      WHERE id = @id
    `,
  ).run({
    id,
    title: next.title,
    showTitle: next.showTitle,
    coverUrl: next.coverUrl,
    durationSeconds: next.durationSeconds,
    status: next.status,
    currentStage: next.currentStage,
    errorCode: next.errorCode,
    errorMessage: next.errorMessage,
    audioOriginalPath: next.audioOriginalPath,
    audioTranslatedPath: next.audioTranslatedPath,
    transcriptOriginalJson: JSON.stringify(next.transcriptOriginal),
    transcriptTranslatedJson: JSON.stringify(next.transcriptTranslated),
    transcriptBilingualJson: JSON.stringify(next.transcriptBilingual),
    updatedAt: next.updatedAt,
    completedAt: next.completedAt,
  });
}

export function setJobStage(id: string, status: JobStatus, errorMessage?: string) {
  const current = getJobById(id);
  if (!current) {
    return;
  }

  updateJob(id, {
    status,
    currentStage: status,
    errorMessage: errorMessage ?? current.errorMessage,
    completedAt: status === "completed" ? new Date().toISOString() : current.completedAt,
  });
}

export function failJob(id: string, errorCode: string, errorMessage: string) {
  const job = getJobById(id);
  if (!job) {
    return;
  }

  updateJob(id, {
    status: "failed",
    currentStage: "failed",
    errorCode,
    errorMessage,
  });

  recordEvent(job.sessionId, id, "job_failed", { errorCode, errorMessage });
}

export function completeJob(id: string) {
  const job = getJobById(id);
  if (!job) {
    return;
  }

  updateJob(id, {
    status: "completed",
    currentStage: "completed",
    completedAt: new Date().toISOString(),
  });

  recordEvent(job.sessionId, id, "job_completed", {});
}

export function resetJob(id: string) {
  updateJob(id, {
    status: "queued",
    currentStage: "queued",
    errorCode: null,
    errorMessage: null,
    completedAt: null,
  });
}

export function recordEvent(
  sessionId: string | null,
  jobId: string | null,
  name: string,
  payload: Record<string, unknown>,
) {
  db.prepare(
    `
      INSERT INTO events (session_id, job_id, name, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(sessionId, jobId, name, JSON.stringify(payload), new Date().toISOString());
}

function mapJob(row: DbJob): JobRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    platform: row.platform,
    targetLanguage: row.target_language,
    title: row.title,
    showTitle: row.show_title,
    coverUrl: row.cover_url,
    durationSeconds: row.duration_seconds,
    status: row.status,
    currentStage: row.current_stage,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    audioOriginalPath: row.audio_original_path,
    audioTranslatedPath: row.audio_translated_path,
    transcriptOriginal: JSON.parse(row.transcript_original_json) as TranscriptSegment[],
    transcriptTranslated: JSON.parse(
      row.transcript_translated_json,
    ) as TranscriptSegment[],
    transcriptBilingual: JSON.parse(row.transcript_bilingual_json) as TranscriptSegment[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}
