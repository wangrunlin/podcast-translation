import * as fs from "node:fs";
import * as path from "node:path";
import { extractEpisode } from "@/lib/worker_ingest";
import {
  completeJob,
  failJob,
  getJobById,
  recordEvent,
  setJobStage,
  updateJob,
} from "@/lib/jobs";
import {
  synthesizeChineseAudio,
  transcribeAudio,
  translateSegments,
} from "@/lib/worker_models";

export async function processJob(jobId: string) {
  const job = getJobById(jobId);

  if (!job) {
    return;
  }

  try {
    recordEvent(job.sessionId, job.id, "job_started", { platform: job.platform });

    setJobStage(job.id, "extracting");
    const extracted = await extractEpisode(job);
    updateJob(job.id, {
      title: extracted.metadata.title,
      showTitle: extracted.metadata.showTitle,
      coverUrl: extracted.metadata.coverUrl,
      durationSeconds: extracted.metadata.durationSeconds,
      audioOriginalPath: extracted.originalAudioPublicPath,
    });

    if (
      extracted.metadata.durationSeconds &&
      extracted.metadata.durationSeconds > 20 * 60
    ) {
      failJob(
        job.id,
        "duration_limit",
        "This episode is over the 20 minute demo limit. Try a shorter episode.",
      );
      return;
    }

    setJobStage(job.id, "transcribing");
    const originalSegments =
      extracted.transcriptOriginal ??
      (extracted.workingAudioPath
        ? await transcribeAudio(extracted.workingAudioPath)
        : []);

    if (originalSegments.length === 0) {
      failJob(
        job.id,
        "transcript_unavailable",
        "Unable to extract transcript data from this source. For YouTube, use a video with English captions.",
      );
      return;
    }

    updateJob(job.id, { transcriptOriginal: originalSegments });

    setJobStage(job.id, "translating");
    const translatedSegments = await translateSegments(originalSegments);
    updateJob(job.id, {
      transcriptTranslated: translatedSegments,
      transcriptBilingual: translatedSegments.map((segment) => ({
        ...segment,
        translatedText: segment.translatedText ?? segment.sourceText,
      })),
    });

    setJobStage(job.id, "synthesizing");
    const outputAudio = await synthesizeChineseAudio(job.id, translatedSegments);

    setJobStage(job.id, "packaging");
    const publicAudioPath = copyOutputToPublic(job.id, outputAudio);
    updateJob(job.id, { audioTranslatedPath: publicAudioPath });

    completeJob(job.id);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The job failed unexpectedly.";
    failJob(job.id, "pipeline_error", message);
  }
}

function copyOutputToPublic(jobId: string, sourcePath: string) {
  const publicDir = path.join(process.cwd(), "public", "generated");
  fs.mkdirSync(publicDir, { recursive: true });
  const targetPath = path.join(publicDir, `${jobId}.mp3`);
  fs.copyFileSync(sourcePath, targetPath);
  return `/generated/${jobId}.mp3`;
}
