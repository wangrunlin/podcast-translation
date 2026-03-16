import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { env, hasMiniMax, hasOpenRouter } from "@/lib/env";
import type { TranscriptSegment } from "@/lib/types";

const execFileAsync = promisify(execFile);

type VoiceCloneResult = {
  voiceId: string | null;
  cloneStatus: "ready" | "failed" | null;
};

export async function transcribeAudio(audioPath: string): Promise<TranscriptSegment[]> {
  if (!hasOpenRouter()) {
    return createMockTranscript();
  }

  const base64Audio = fs.readFileSync(audioPath).toString("base64");
  const format = detectAudioFormat(audioPath);
  const response = await fetch(`${env.openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-OpenRouter-Title": "Podcast Translation MVP",
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
              text: "Transcribe this English podcast audio. Keep the wording faithful. Return 8-24 timestamped segments.",
            },
            {
              type: "input_audio",
              input_audio: {
                data: base64Audio,
                format,
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

  let parsed: { segments?: TranscriptSegment[] };
  try {
    parsed = safeJsonParse<{ segments?: TranscriptSegment[] }>(content);
  } catch {
    // Model may hallucinate mixed formats (box_2d, etc.) partway through.
    // Extract valid segments from the partial JSON.
    console.error(`[ASR] JSON parse failed (${content.length} chars). Attempting partial extraction.`);
    const rescued = rescueSegmentsFromPartialJson(content);
    if (rescued.length > 0) {
      console.log(`[ASR] Rescued ${rescued.length} segments from partial output.`);
      return rescued;
    }
    throw new Error(`Transcription returned malformed JSON (${content.length} chars). No valid segments could be recovered.`);
  }
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

  // Translate in batches to avoid model output length limits
  const BATCH_SIZE = 20;
  const results: TranscriptSegment[] = [];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const translated = await translateBatch(batch);
    results.push(...translated);
  }

  return results;
}

async function translateBatch(
  segments: TranscriptSegment[],
): Promise<TranscriptSegment[]> {
  const response = await fetch(`${env.openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-OpenRouter-Title": "Podcast Translation MVP",
    },
    body: JSON.stringify({
      model: env.openRouterTranslationModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Translate the transcript into natural simplified Chinese for audio listening. Return strict JSON: {"segments":[{"startMs":0,"endMs":1000,"sourceText":"...","translatedText":"..."}]}',
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

  let parsed: { segments?: TranscriptSegment[] };
  try {
    parsed = safeJsonParse<{ segments?: TranscriptSegment[] }>(content);
  } catch {
    console.error(`[Translation] JSON parse failed (${content.length} chars). Attempting partial extraction.`);
    const rescued = rescueTranslationSegments(content);
    if (rescued.length > 0) {
      console.log(`[Translation] Rescued ${rescued.length} segments from partial output.`);
      return rescued;
    }
    throw new Error(`Translation returned malformed JSON (${content.length} chars). No valid segments could be recovered.`);
  }
  if (!parsed.segments || parsed.segments.length === 0) {
    throw new Error("Translation response did not include segments.");
  }

  return parsed.segments;
}

export async function synthesizeChineseAudio(
  jobId: string,
  segments: TranscriptSegment[],
  options?: {
    sourceAudioPath?: string | null;
    originalSegments?: TranscriptSegment[];
  },
): Promise<{ outputPath: string; cloneStatus: "ready" | "failed" | null; cloneVoiceId: string | null }> {
  const clone = await maybeCreateVoiceClone(
    jobId,
    options?.sourceAudioPath ?? null,
    options?.originalSegments ?? [],
  );
  const audioBase64 = await synthesizeChineseAudioBase64(segments, {
    voiceId: clone.voiceId,
  });
  const outputPath = path.join(process.cwd(), "storage", "output", `${jobId}.mp3`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(audioBase64, "base64"));
  return {
    outputPath,
    cloneStatus: clone.cloneStatus,
    cloneVoiceId: clone.voiceId,
  };
}

export async function synthesizeChineseAudioBase64(
  segments: TranscriptSegment[],
  options?: { voiceId?: string | null },
): Promise<string> {
  const text = segments
    .map((segment) => segment.translatedText || segment.sourceText)
    .join(" ");

  if (!hasMiniMax()) {
    return createMockAudioBase64(text);
  }

  const payload = {
    model: env.miniMaxTtsModel,
    text,
    stream: false,
    language_boost: "Chinese",
    output_format: "hex",
    voice_setting: {
      voice_id: options?.voiceId ?? "Chinese (Mandarin)_Warm_Girl",
      speed: 1,
      vol: 1,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: "mp3",
      channel: 1,
    },
  };

  const response = await fetch(`${env.miniMaxBaseUrl}/v1/t2a_v2?GroupId=${env.miniMaxGroupId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.miniMaxApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`MiniMax speech generation failed: ${detail}`);
  }

  const data = (await response.json()) as {
    data?: { audio?: string | null };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  const audioHex = data.data?.audio;
  if (!audioHex) {
    const statusCode = data.base_resp?.status_code ?? null;
    const statusMsg = data.base_resp?.status_msg ?? "Unknown MiniMax error";
    throw new Error(
      `MiniMax did not return audio data. status_code=${statusCode} status_msg=${statusMsg}`,
    );
  }

  return Buffer.from(audioHex, "hex").toString("base64");
}

async function maybeCreateVoiceClone(
  jobId: string,
  sourceAudioPath: string | null,
  originalSegments: TranscriptSegment[],
): Promise<VoiceCloneResult> {
  if (!hasMiniMax() || !sourceAudioPath || originalSegments.length === 0 || !ffmpegPath) {
    return { voiceId: null, cloneStatus: null };
  }

  try {
    const clip = await extractVoiceCloneSample(jobId, sourceAudioPath, originalSegments);
    if (!clip) {
      return { voiceId: null, cloneStatus: "failed" };
    }

    const voiceId = await createMiniMaxVoiceClone(clip.samplePath, clip.promptText, jobId);
    if (!voiceId) {
      return { voiceId: null, cloneStatus: "failed" };
    }

    return {
      voiceId,
      cloneStatus: "ready",
    };
  } catch {
    return { voiceId: null, cloneStatus: "failed" };
  }
}

async function extractVoiceCloneSample(
  jobId: string,
  sourceAudioPath: string,
  originalSegments: TranscriptSegment[],
) {
  const candidate = [...originalSegments]
    .filter((segment) => segment.endMs > segment.startMs && segment.sourceText.trim().length > 40)
    .sort(
      (a, b) =>
        b.endMs - b.startMs - (a.endMs - a.startMs) ||
        b.sourceText.length - a.sourceText.length,
    )[0];

  if (!candidate) {
    return null;
  }

  const startSeconds = Math.max(candidate.startMs / 1000, 0);
  const rawDurationSeconds = Math.max((candidate.endMs - candidate.startMs) / 1000, 0);
  const durationSeconds = Math.max(8, Math.min(28, rawDurationSeconds));
  const samplePath = path.join(process.cwd(), "storage", "output", `${jobId}-clone-sample.mp3`);
  const ffmpegBinary = getFfmpegBinary();
  if (!ffmpegBinary) {
    return null;
  }

  fs.mkdirSync(path.dirname(samplePath), { recursive: true });
  await execFileAsync(ffmpegBinary, [
    "-ss",
    `${startSeconds}`,
    "-t",
    `${durationSeconds}`,
    "-i",
    sourceAudioPath,
    "-ac",
    "1",
    "-ar",
    "32000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    samplePath,
    "-y",
  ]);

  return {
    samplePath,
    promptText: candidate.sourceText.slice(0, 320),
  };
}

async function createMiniMaxVoiceClone(
  samplePath: string,
  promptText: string,
  jobId: string,
) {
  const fileId = await uploadMiniMaxFile(samplePath);
  const payload = {
    model: env.miniMaxVoiceCloneModel,
    voice_id: `podcast-${jobId}`,
    file_id: fileId,
    prompt: promptText,
  };

  const response = await fetch(
    `${env.miniMaxBaseUrl}/v1/voice_clone?GroupId=${env.miniMaxGroupId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.miniMaxApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    voice_id?: string;
    data?: { voice_id?: string };
  };

  return data.data?.voice_id ?? data.voice_id ?? payload.voice_id;
}

async function uploadMiniMaxFile(filePath: string) {
  const form = new FormData();
  const bytes = fs.readFileSync(filePath);
  form.append("purpose", "voice_clone");
  form.append(
    "file",
    new Blob([bytes], { type: "audio/mpeg" }),
    path.basename(filePath),
  );

  const response = await fetch(`${env.miniMaxBaseUrl}/v1/files/upload?GroupId=${env.miniMaxGroupId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.miniMaxApiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`MiniMax file upload failed: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    file?: { file_id?: string };
    data?: { file?: { file_id?: string }; file_id?: string };
    file_id?: string;
  };

  const fileId = data.data?.file?.file_id ?? data.data?.file_id ?? data.file?.file_id ?? data.file_id;
  if (!fileId) {
    throw new Error("MiniMax file upload did not return a file_id.");
  }

  return fileId;
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
    if (!ffmpegPath) {
      throw new Error("ffmpeg unavailable");
    }

    await execFileAsync(ffmpegPath, [
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
    const ffmpegBinary = getFfmpegBinary();
    if (!ffmpegBinary) {
      return Buffer.from("mock-audio").toString("base64");
    }

    await execFileAsync(ffmpegBinary, [
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

function detectAudioFormat(audioPath: string) {
  const ext = path.extname(audioPath).toLowerCase().replace(".", "");
  if (ext === "m4a") {
    return "mp4";
  }

  if (ext === "webm" || ext === "mp4" || ext === "wav" || ext === "mp3" || ext === "mpeg") {
    return ext;
  }

  return "mp3";
}

/**
 * Extract the first complete JSON object from a string by counting braces.
 * Handles cases where models output multiple JSON objects concatenated.
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\" && i + 1 < text.length) {
        i++; // skip escaped char
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Parse JSON from AI model output, tolerating common issues:
 * - Markdown code fences
 * - Control characters
 * - Trailing commas
 * - Doubled/escaped quotes from the model (e.g. ""word"" or \"\"word\"\")
 */
function safeJsonParse<T>(raw: string): T {
  // Strip markdown code fences
  let cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // Remove control characters (except \t \n \r)
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

  // Try as-is first
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // pass
  }

  // Fix trailing commas
  let fixed = cleaned.replace(/,\s*]/g, "]").replace(/,\s*}/g, "}");
  try {
    return JSON.parse(fixed) as T;
  } catch {
    // pass
  }

  // Fix doubled quotes inside strings: ""word"" -> \"word\"
  // This pattern finds "" that aren't at a string boundary (not after : or before ,/}/])
  fixed = repairDoubledQuotes(fixed);
  try {
    return JSON.parse(fixed) as T;
  } catch {
    // pass
  }

  // Fix Gemini hallucination: "box_2d": [startMs, "endMs": ... -> "startMs": startMs, "endMs": ...
  fixed = fixed.replace(
    /\{\s*"box_2d"\s*:\s*\[(\d+)\s*,\s*"endMs"/g,
    '{"startMs": $1, "endMs"'
  );
  try {
    return JSON.parse(fixed) as T;
  } catch {
    // pass
  }

  // Try extracting the first complete JSON object by brace-matching
  const firstComplete = extractFirstJsonObject(fixed);
  if (firstComplete) {
    try {
      return JSON.parse(firstComplete) as T;
    } catch {
      // pass
    }
  }

  // Last resort: extract JSON substring between first { and last }
  const firstBrace = fixed.indexOf("{");
  const lastBrace = fixed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const extracted = fixed.slice(firstBrace, lastBrace + 1);
    return JSON.parse(extracted) as T;
  }

  throw new Error(`Unable to parse JSON from model output (${raw.length} chars)`);
}

/**
 * Repair doubled quotes that AI models produce inside JSON string values.
 * Example: "he said ""hello"" to me" -> "he said \"hello\" to me"
 */
/**
 * Extract valid transcript segments from partially corrupted JSON.
 * The Gemini model sometimes starts hallucinating box_2d objects
 * partway through the response. This extracts all valid segments
 * before the corruption point.
 */
function rescueSegmentsFromPartialJson(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const segmentPattern = /\{\s*"startMs"\s*:\s*(\d+)\s*,\s*"endMs"\s*:\s*(\d+)\s*,\s*"sourceText"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;

  while ((match = segmentPattern.exec(raw)) !== null) {
    const startMs = parseInt(match[1]);
    const endMs = parseInt(match[2]);
    const sourceText = match[3]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, " ")
      .replace(/\\\\/g, "\\");

    if (sourceText.trim().length > 0 && endMs > startMs) {
      segments.push({ startMs, endMs, sourceText });
    }
  }

  return segments;
}

/**
 * Extract valid translation segments from partially corrupted JSON.
 * Matches segments that include translatedText.
 */
function rescueTranslationSegments(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const pattern = /\{\s*"startMs"\s*:\s*(\d+)\s*,\s*"endMs"\s*:\s*(\d+)\s*,\s*"sourceText"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"translatedText"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const startMs = parseInt(match[1]);
    const endMs = parseInt(match[2]);
    const sourceText = match[3].replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\\\/g, "\\");
    const translatedText = match[4].replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\\\/g, "\\");

    if (translatedText.trim().length > 0) {
      segments.push({ startMs, endMs, sourceText, translatedText });
    }
  }

  return segments;
}

function repairDoubledQuotes(json: string): string {
  const result: string[] = [];
  let inString = false;
  let i = 0;

  while (i < json.length) {
    const ch = json[i];

    if (!inString) {
      result.push(ch);
      if (ch === '"') {
        inString = true;
      }
      i++;
      continue;
    }

    // Inside a string
    if (ch === '\\') {
      // Escaped character — keep both
      result.push(ch, json[i + 1] ?? "");
      i += 2;
      continue;
    }

    if (ch === '"') {
      const next = json[i + 1];
      // Check if this is a doubled quote inside a string: ""
      // A real string-end quote is followed by , } ] : or whitespace
      if (next === '"') {
        // Look ahead past the second quote
        const afterPair = json[i + 2];
        // If after "" we see a letter/digit/space that continues text,
        // this is a doubled-quote inside the string
        if (afterPair && afterPair !== ',' && afterPair !== '}' && afterPair !== ']' && afterPair !== ':') {
          result.push('\\"');
          i += 2;
          continue;
        }
        // If "" is followed by , } ] etc., treat first " as end of string
        // and second " as start of next string — this is normal JSON
      }
      // Normal end of string
      result.push(ch);
      inString = false;
      i++;
      continue;
    }

    result.push(ch);
    i++;
  }

  return result.join("");
}

function getFfmpegBinary() {
  if (!ffmpegPath) {
    return null;
  }

  try {
    fs.chmodSync(ffmpegPath, 0o755);
  } catch {
    // Best effort only.
  }

  return ffmpegPath;
}
