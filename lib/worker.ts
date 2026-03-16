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
      extracted.metadata.durationSeconds > 30 * 60
    ) {
      failJob(
        job.id,
        "duration_limit",
        "This episode is over the 30 minute MVP limit. Try a shorter episode.",
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
    const synthesis = await synthesizeChineseAudio(job.id, translatedSegments, {
      sourceAudioPath: extracted.workingAudioPath,
      originalSegments,
    });

    setJobStage(job.id, "packaging");
    const publicAudioPath = copyOutputToPublic(job.id, synthesis.outputPath);
    updateJob(job.id, {
      audioTranslatedPath: publicAudioPath,
      cloneStatus: synthesis.cloneStatus,
      cloneVoiceId: synthesis.cloneVoiceId,
    });

    completeJob(job.id);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The job failed unexpectedly.";
    failJob(job.id, "pipeline_error", message);
  }
}

function copyOutputToPublic(jobId: string, sourcePath: string) {
  const candidates = [
    path.join(process.cwd(), "public", "generated"),
    path.join("/tmp", "podcast-output"),
  ];

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const targetPath = path.join(dir, `${jobId}.mp3`);
      fs.copyFileSync(sourcePath, targetPath);
      if (dir.startsWith("/tmp")) {
        return `/api/audio/${jobId}`;
      }
      return `/generated/${jobId}.mp3`;
    } catch {
      continue;
    }
  }

  throw new Error(`Failed to copy output audio for job ${jobId}`);
}
