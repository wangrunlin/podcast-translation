import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { env, hasMiniMax, hasOpenRouter } from "@/lib/env";
import type { TranscriptSegment } from "@/lib/types";

const execFileAsync = promisify(execFile);

export async function transcribeAudio(audioPath: string): Promise<TranscriptSegment[]> {
  if (!hasOpenRouter()) {
    return createMockTranscript();
  }

  const base64Audio = fs.readFileSync(audioPath).toString("base64");
  const response = await fetch(`${env.openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-OpenRouter-Title": "Podcast Translation Demo",
    },
    body: JSON.stringify({
      model: env.openRouterAsrModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Transcribe the English audio and return strict JSON: {"segments":[{"startMs":0,"endMs":1000,"sourceText":"..."}]}',
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe this English podcast audio. Keep 6-12 segments total for demo output.",
            },
            {
              type: "input_audio",
              input_audio: {
                data: base64Audio,
                format: "mp3",
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenRouter transcription failed: ${detail}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter transcription returned an empty response.");
  }

  const parsed = JSON.parse(content) as { segments?: TranscriptSegment[] };
  if (!parsed.segments || parsed.segments.length === 0) {
    throw new Error("Transcription response did not include segments.");
  }

  return parsed.segments;
}

export async function translateSegments(
  segments: TranscriptSegment[],
): Promise<TranscriptSegment[]> {
  if (!hasOpenRouter()) {
    return segments.map((segment) => ({
      ...segment,
      translatedText: `中文示例：${segment.sourceText}`,
    }));
  }

  const response = await fetch(`${env.openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-OpenRouter-Title": "Podcast Translation Demo",
    },
    body: JSON.stringify({
      model: env.openRouterTranslationModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Translate the transcript into natural simplified Chinese. Return strict JSON: {"segments":[{"startMs":0,"endMs":1000,"sourceText":"...","translatedText":"..."}]}',
        },
        {
          role: "user",
          content: JSON.stringify({ segments }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenRouter translation failed: ${detail}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenRouter translation returned an empty response.");
  }

  const parsed = JSON.parse(content) as { segments?: TranscriptSegment[] };
  if (!parsed.segments || parsed.segments.length === 0) {
    throw new Error("Translation response did not include segments.");
  }

  return parsed.segments;
}

export async function synthesizeChineseAudio(
  jobId: string,
  segments: TranscriptSegment[],
): Promise<string> {
  const audioBase64 = await synthesizeChineseAudioBase64(segments);
  const outputPath = path.join(process.cwd(), "storage", "output", `${jobId}.mp3`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(audioBase64, "base64"));
  return outputPath;
}

export async function synthesizeChineseAudioBase64(
  segments: TranscriptSegment[],
): Promise<string> {
  const text = segments
    .map((segment) => segment.translatedText || segment.sourceText)
    .join(" ");

  if (!hasMiniMax()) {
    return createMockAudioBase64(text);
  }

  const response = await fetch(`${env.miniMaxBaseUrl}/v1/t2a_v2?GroupId=${env.miniMaxGroupId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.miniMaxApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.miniMaxTtsModel,
      text,
      stream: false,
      voice_setting: {
        voice_id: "Chinese (Mandarin)_Gentle_Female",
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: "mp3",
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`MiniMax speech generation failed: ${detail}`);
  }

  const data = (await response.json()) as {
    data?: { audio?: string };
  };
  const audio = data.data?.audio;
  if (!audio) {
    throw new Error("MiniMax did not return audio data.");
  }

  return audio;
}

function createMockTranscript(): TranscriptSegment[] {
  return [
    {
      startMs: 0,
      endMs: 9000,
      sourceText:
        "Welcome back to the show. Today we are exploring how AI changes the way knowledge travels across languages.",
    },
    {
      startMs: 9000,
      endMs: 19000,
      sourceText:
        "The interesting part is not just transcript quality, but whether listeners will stay for a translated long-form audio experience.",
    },
    {
      startMs: 19000,
      endMs: 30000,
      sourceText:
        "For a first version, a narrow workflow can be more valuable than a broad platform with too many unstable inputs.",
    },
  ];
}

async function createMockAudioBase64(text: string) {
  const outputPath = path.join(
    process.cwd(),
    "storage",
    "output",
    `mock-${Date.now()}.mp3`,
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const safeText = text.replace(/[^a-zA-Z0-9 .,]/g, " ").slice(0, 150);

  try {
    await execFileAsync("ffmpeg", [
      "-f",
      "lavfi",
      "-i",
      `flite=text='${safeText || "Podcast translation demo"}'`,
      "-t",
      "12",
      "-q:a",
      "3",
      outputPath,
      "-y",
    ]);
  } catch {
    await execFileAsync("ffmpeg", [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=600:duration=12",
      "-q:a",
      "3",
      outputPath,
      "-y",
    ]);
  }

  const audio = fs.readFileSync(outputPath).toString("base64");
  fs.unlinkSync(outputPath);
  return audio;
}
