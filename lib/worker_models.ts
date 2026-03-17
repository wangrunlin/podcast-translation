import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { env, hasMiniMax, hasOpenRouter } from "@/lib/env";
import type { TranscriptSegment } from "@/lib/types";

const execFileAsync = promisify(execFile);

function safeJsonParse<T>(raw: string): T {
  // Strip markdown fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1].trim() : raw;

  // Extract JSON object
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart === -1) {
    return JSON.parse(text);
  }

  const json = braceEnd > braceStart ? text.slice(braceStart, braceEnd + 1) : text.slice(braceStart);

  try {
    return JSON.parse(json);
  } catch {
    // Attempt to repair truncated JSON
    const repaired = repairTruncatedJson(json);
    return JSON.parse(repaired);
  }
}

function repairTruncatedJson(json: string): string {
  let fixed = json;

  // Close any unclosed string
  let inString = false;
  let escape = false;
  for (const ch of fixed) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; }
  }
  if (inString) {
    fixed += '"';
  }

  // Remove last incomplete key-value or object
  // Try progressively removing trailing content until brackets balance
  const attempts = [
    fixed,
    fixed.replace(/,\s*"[^"]*"\s*:\s*"[^"]*"\s*$/, ""),
    fixed.replace(/,\s*\{[^{}]*$/, ""),
    fixed.replace(/,\s*"[^"]*"\s*$/, ""),
  ];

  for (const attempt of attempts) {
    let braces = 0;
    let brackets = 0;
    let inStr = false;
    let esc = false;
    for (const ch of attempt) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") braces++;
      if (ch === "}") braces--;
      if (ch === "[") brackets++;
      if (ch === "]") brackets--;
    }

    let closed = attempt;
    for (let i = 0; i < brackets; i++) closed += "]";
    for (let i = 0; i < braces; i++) closed += "}";

    try {
      return closed;
    } catch {
      continue;
    }
  }

  return fixed;
}

async function maybeTrimAudio(audioPath: string, maxSeconds: number): Promise<string> {
  const stat = fs.statSync(audioPath);
  const MAX_BYTES = 2 * 1024 * 1024; // 2MB ~= 2min at 128kbps

  // Try ffmpeg first for proper trimming
  const ffmpegBin = getFfmpegBinary();
  if (ffmpegBin && stat.size > MAX_BYTES) {
    const trimmedPath = audioPath.replace(/(\.\w+)$/, `-trimmed$1`);
    try {
      await execFileAsync(ffmpegBin, [
        "-i", audioPath,
        "-t", `${Math.min(maxSeconds, 120)}`,
        "-ac", "1",
        "-ar", "16000",
        "-b:a", "64k",
        trimmedPath,
        "-y",
      ]);
      return trimmedPath;
    } catch {
      // Fall through to byte truncation
    }
  }

  // Fallback: byte-truncate the MP3 (MP3 frames are independent, safe to slice)
  if (stat.size > MAX_BYTES) {
    const truncatedPath = audioPath.replace(/(\.\w+)$/, `-truncated$1`);
    const fd = fs.openSync(audioPath, "r");
    const buffer = Buffer.alloc(MAX_BYTES);
    fs.readSync(fd, buffer, 0, MAX_BYTES, 0);
    fs.closeSync(fd);
    fs.writeFileSync(truncatedPath, buffer);
    return truncatedPath;
  }

  return audioPath;
}

type VoiceCloneResult = {
  voiceId: string | null;
  cloneStatus: "ready" | "failed" | null;
};

export async function transcribeAudio(audioPath: string): Promise<TranscriptSegment[]> {
  if (!hasOpenRouter()) {
    return createMockTranscript();
  }

  const trimmedPath = await maybeTrimAudio(audioPath, 600);
  const base64Audio = fs.readFileSync(trimmedPath).toString("base64");
  const format = detectAudioFormat(trimmedPath);
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
      max_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Transcribe the English audio and return strict JSON only, no markdown: {"segments":[{"startMs":0,"endMs":1000,"sourceText":"..."}]}',
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe this English podcast audio. Keep the wording faithful. Return 6-12 timestamped segments. Return ONLY valid JSON, no code fences.",
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

  const parsed = safeJsonParse(content) as { segments?: TranscriptSegment[] };
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
      "X-OpenRouter-Title": "Podcast Translation MVP",
    },
    body: JSON.stringify({
      model: env.openRouterTranslationModel,
      max_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Translate the transcript into natural simplified Chinese for audio listening. Return strict JSON only, no markdown: {"segments":[{"startMs":0,"endMs":1000,"sourceText":"...","translatedText":"..."}]}',
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

  const parsed = safeJsonParse(content) as { segments?: TranscriptSegment[] };
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
  const outputPath = path.join("/tmp", "podcast-output", `${jobId}.mp3`);
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
  if (!hasMiniMax() || !sourceAudioPath || originalSegments.length === 0 || !getFfmpegBinary()) {
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
  const samplePath = path.join("/tmp", "podcast-output", `${jobId}-clone-sample.mp3`);
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
    "/tmp",
    "podcast-output",
    `mock-${Date.now()}.mp3`,
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const safeText = text.replace(/[^a-zA-Z0-9 .,]/g, " ").slice(0, 150);

  try {
    const ffmpegBin = getFfmpegBinary();
    if (!ffmpegBin) {
      throw new Error("ffmpeg unavailable");
    }

    await execFileAsync(ffmpegBin, [
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

function getFfmpegBinary() {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    return null;
  }

  try {
    fs.chmodSync(ffmpegPath, 0o755);
  } catch {
    // Best effort only.
  }

  return ffmpegPath;
}
