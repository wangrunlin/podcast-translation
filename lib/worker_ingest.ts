import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import youtubedl from "youtube-dl-exec";
import type { EpisodeMetadata, JobRecord, SourcePlatform } from "@/lib/types";

const execFileAsync = promisify(execFile);

export type ExtractResult = {
  metadata: EpisodeMetadata;
  workingAudioPath: string;
  originalAudioPublicPath: string | null;
};

export async function extractEpisode(job: JobRecord): Promise<ExtractResult> {
  const tempDir = path.join(process.cwd(), "storage", "source");
  fs.mkdirSync(tempDir, { recursive: true });

  return extractSourceToTemp({
    sourceUrl: job.sourceUrl,
    platform: job.platform,
    id: job.id,
    tempDir,
    publicOriginalUrl: job.platform === "direct" ? job.sourceUrl : null,
  });
}

export async function extractSourceToTemp(input: {
  sourceUrl: string;
  platform: SourcePlatform;
  id?: string;
  tempDir?: string;
  publicOriginalUrl?: string | null;
}): Promise<ExtractResult> {
  const tempDir =
    input.tempDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), "podcast-translation-demo-"));
  fs.mkdirSync(tempDir, { recursive: true });

  const id = input.id ?? makeTempId();

  if (input.platform === "direct") {
    return extractDirectAudio({
      id,
      sourceUrl: input.sourceUrl,
      tempDir,
      publicOriginalUrl: input.publicOriginalUrl ?? input.sourceUrl,
    });
  }

  if (input.platform === "youtube") {
    return extractYoutubeAudio({
      id,
      sourceUrl: input.sourceUrl,
      tempDir,
    });
  }

  throw new Error(
    "This platform is not wired in this demo yet. Try YouTube or a direct audio URL.",
  );
}

async function extractDirectAudio(input: {
  id: string;
  sourceUrl: string;
  tempDir: string;
  publicOriginalUrl: string | null;
}): Promise<ExtractResult> {
  const filename = `${input.id}-source.mp3`;
  const workingAudioPath = path.join(input.tempDir, filename);
  await downloadFile(input.sourceUrl, workingAudioPath);

  return {
    metadata: {
      title: "Direct audio episode",
      showTitle: "Imported audio",
      durationSeconds: await getAudioDurationSeconds(workingAudioPath),
      coverUrl: null,
      sourceUrl: input.sourceUrl,
      platform: "direct",
    },
    workingAudioPath,
    originalAudioPublicPath: input.publicOriginalUrl,
  };
}

async function extractYoutubeAudio(input: {
  id: string;
  sourceUrl: string;
  tempDir: string;
}): Promise<ExtractResult> {
  const outputTemplate = path.join(input.tempDir, `${input.id}.%(ext)s`);

  const info = (await youtubedl(input.sourceUrl, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    skipDownload: true,
  })) as {
    title?: string;
    channel?: string;
    thumbnail?: string;
    duration?: number;
  };

  await youtubedl(input.sourceUrl, {
    format: "bestaudio/best",
    output: outputTemplate,
    noWarnings: true,
    noCheckCertificates: true,
  });

  const workingAudioPath = findDownloadedFile(input.tempDir, input.id);

  return {
    metadata: {
      title: info.title ?? "YouTube episode",
      showTitle: info.channel ?? "YouTube",
      durationSeconds:
        info.duration ?? (await getAudioDurationSeconds(workingAudioPath)),
      coverUrl: info.thumbnail ?? null,
      sourceUrl: input.sourceUrl,
      platform: "youtube",
    },
    workingAudioPath,
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

function makeTempId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function findDownloadedFile(tempDir: string, id: string) {
  const match = fs
    .readdirSync(tempDir)
    .find((file) => file.startsWith(id) && !file.endsWith(".part"));

  if (!match) {
    throw new Error("YouTube audio download completed without a readable output file.");
  }

  return path.join(tempDir, match);
}
