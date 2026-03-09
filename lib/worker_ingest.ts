import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { EpisodeMetadata, JobRecord } from "@/lib/types";

const execFileAsync = promisify(execFile);

type ExtractResult = {
  metadata: EpisodeMetadata;
  workingAudioPath: string;
  originalAudioPublicPath: string | null;
};

export async function extractEpisode(job: JobRecord): Promise<ExtractResult> {
  if (job.platform === "direct") {
    return extractDirectAudio(job);
  }

  if (job.platform === "youtube") {
    return extractYoutubeAudio(job);
  }

  throw new Error(
    "This platform is not wired in this demo yet. Try YouTube or a direct audio URL.",
  );
}

async function extractDirectAudio(job: JobRecord): Promise<ExtractResult> {
  const filename = `${job.id}-source.mp3`;
  const workingAudioPath = path.join(process.cwd(), "storage", "source", filename);
  await downloadFile(job.sourceUrl, workingAudioPath);

  return {
    metadata: {
      title: "Direct audio episode",
      showTitle: "Imported audio",
      durationSeconds: await getAudioDurationSeconds(workingAudioPath),
      coverUrl: null,
      sourceUrl: job.sourceUrl,
      platform: "direct",
    },
    workingAudioPath,
    originalAudioPublicPath: job.sourceUrl,
  };
}

async function extractYoutubeAudio(job: JobRecord): Promise<ExtractResult> {
  const ytDlpAvailable = await hasYtDlpBinary();
  if (!ytDlpAvailable) {
    throw new Error(
      "yt-dlp is required for YouTube extraction. Install it or use a direct audio URL instead.",
    );
  }

  const rawInfo = await execFileAsync("yt-dlp", [
    "--dump-single-json",
    "--no-warnings",
    "--no-check-certificates",
    "--skip-download",
    job.sourceUrl,
  ]);
  const info = JSON.parse(rawInfo.stdout) as {
    title?: string;
    channel?: string;
    thumbnail?: string;
    duration?: number;
  };

  const outputPath = path.join(process.cwd(), "storage", "source", `${job.id}.mp3`);

  await execFileAsync("yt-dlp", [
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--output",
    outputPath,
    "--no-warnings",
    "--no-check-certificates",
    job.sourceUrl,
  ]);

  return {
    metadata: {
      title: info.title ?? "YouTube episode",
      showTitle: info.channel ?? "YouTube",
      durationSeconds:
        info.duration ?? (await getAudioDurationSeconds(outputPath)),
      coverUrl: info.thumbnail ?? null,
      sourceUrl: job.sourceUrl,
      platform: "youtube",
    },
    workingAudioPath: outputPath,
    originalAudioPublicPath: null,
  };
}

async function downloadFile(url: string, destinationPath: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error("Unable to download the source audio file.");
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
}

async function getAudioDurationSeconds(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return Math.round(Number.parseFloat(stdout.trim()));
}

async function hasYtDlpBinary() {
  try {
    await execFileAsync("yt-dlp", ["--version"]);
    return true;
  } catch {
    return false;
  }
}
