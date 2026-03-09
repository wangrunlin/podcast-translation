import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractSourceToTemp } from "@/lib/worker_ingest";
import {
  synthesizeChineseAudioBase64,
  transcribeAudio,
  translateSegments,
} from "@/lib/worker_models";

export const maxDuration = 60;

const requestSchema = z.union([
  z.object({
    sourceUrl: z.string().url(),
  }),
  z.object({
    audioBase64: z.string().min(1),
    audioFormat: z.enum(["mp3", "wav", "mp4", "webm", "mpeg"]).default("mp3"),
    title: z.string().optional(),
    showTitle: z.string().optional(),
  }),
]);

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please provide a valid source URL." },
      { status: 400 },
    );
  }

  try {
    const extracted =
      "sourceUrl" in parsed.data
        ? await extractFromUrl(parsed.data.sourceUrl)
        : await extractFromBase64(parsed.data);

    if (
      extracted.metadata.durationSeconds &&
      extracted.metadata.durationSeconds > 8 * 60
    ) {
      return NextResponse.json(
        {
          error:
            "This sync demo only accepts clips up to 8 minutes. Use a shorter episode sample.",
        },
        { status: 400 },
      );
    }

    const originalSegments = await transcribeAudio(extracted.workingAudioPath);
    const translatedSegments = await translateSegments(originalSegments);
    const audioBase64 = await synthesizeChineseAudioBase64(translatedSegments);

    return NextResponse.json({
      metadata: extracted.metadata,
      transcriptOriginal: originalSegments,
      transcriptTranslated: translatedSegments,
      audioDataUrl: `data:audio/mp3;base64,${audioBase64}`,
    });
  } catch (error) {
    const message = formatUnknownError(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function extractFromUrl(sourceUrl: string) {
  const platform = detectPlatform(sourceUrl);
  if (platform !== "youtube" && platform !== "direct" && platform !== "apple") {
    throw new Error(
      "This sync demo supports Apple Podcasts, YouTube URLs, or direct audio links.",
    );
  }

  return extractSourceToTemp({
    sourceUrl,
    platform,
    skipDurationProbe: true,
  });
}

async function extractFromBase64(input: {
  audioBase64: string;
  audioFormat: "mp3" | "wav" | "mp4" | "webm" | "mpeg";
  title?: string;
  showTitle?: string;
}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "podcast-demo-upload-"));
  const ext = input.audioFormat === "mpeg" ? "mp3" : input.audioFormat;
  const workingAudioPath = path.join(tempDir, `upload.${ext}`);

  fs.writeFileSync(workingAudioPath, Buffer.from(input.audioBase64, "base64"));

  return {
    metadata: {
      title: input.title ?? "Uploaded audio sample",
      showTitle: input.showTitle ?? "Manual upload",
      durationSeconds: null,
      coverUrl: null,
      sourceUrl: "upload://base64-audio",
      platform: "direct" as const,
    },
    workingAudioPath,
    originalAudioPublicPath: null,
  };
}

function detectPlatform(sourceUrl: string) {
  const normalized = sourceUrl.toLowerCase();

  if (normalized.includes("youtube.com") || normalized.includes("youtu.be")) {
    return "youtube" as const;
  }

  if (normalized.includes("podcasts.apple.com")) {
    return "apple" as const;
  }

  if (/\.(mp3|m4a|wav|ogg)(\?.*)?$/i.test(sourceUrl)) {
    return "direct" as const;
  }

  return "unknown" as const;
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) {
    const decorated = error as Error & {
      stderr?: string;
      stdout?: string;
      code?: string | number;
      cause?: unknown;
    };

    return JSON.stringify({
      name: decorated.name,
      message: decorated.message || error.toString(),
      code: decorated.code ?? null,
      stderr: decorated.stderr ?? null,
      stdout: decorated.stdout ?? null,
      cause:
        decorated.cause instanceof Error
          ? decorated.cause.message
          : decorated.cause ?? null,
    });
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Sync demo failed unexpectedly.";
  }
}
