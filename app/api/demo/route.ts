import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractSourceToTemp } from "@/lib/worker_ingest";
import {
  synthesizeChineseAudioBase64,
  transcribeAudio,
  translateSegments,
} from "@/lib/worker_models";

export const maxDuration = 60;

const requestSchema = z.object({
  sourceUrl: z.string().url(),
});

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please provide a valid source URL." },
      { status: 400 },
    );
  }

  const platform = detectPlatform(parsed.data.sourceUrl);
  if (platform !== "youtube" && platform !== "direct") {
    return NextResponse.json(
      { error: "This sync demo only supports YouTube URLs or direct audio links." },
      { status: 400 },
    );
  }

  try {
    const extracted = await extractSourceToTemp({
      sourceUrl: parsed.data.sourceUrl,
      platform,
    });

    if (
      extracted.metadata.durationSeconds &&
      extracted.metadata.durationSeconds > 2 * 60
    ) {
      return NextResponse.json(
        {
          error:
            "This sync demo only accepts clips up to 2 minutes. Use a shorter episode sample.",
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

function detectPlatform(sourceUrl: string) {
  const normalized = sourceUrl.toLowerCase();

  if (normalized.includes("youtube.com") || normalized.includes("youtu.be")) {
    return "youtube" as const;
  }

  if (/\.(mp3|m4a|wav|ogg)(\?.*)?$/i.test(sourceUrl)) {
    return "direct" as const;
  }

  return "unknown" as const;
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) {
    return error.message || error.toString();
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
