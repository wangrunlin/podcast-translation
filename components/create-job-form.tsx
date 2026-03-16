"use client";

import { useMemo, useState, useTransition } from "react";
import { getSessionId } from "@/lib/session";
import type { JobRecord, TranscriptSegment } from "@/lib/types";

const SAMPLE_LINKS = [
  {
    label: "Apple / Lex #491 OpenClaw",
    url: "https://podcasts.apple.com/cn/podcast/491-openclaw-the-viral-ai-agent-that-broke-the/id1434243584?i=1000749366733",
  },
  {
    label: "Apple / BBC Global News",
    url: "https://podcasts.apple.com/us/podcast/bbc-global-news-podcast/id135067274?i=1000698226228",
  },
  {
    label: "YouTube / AI founders clip",
    url: "https://www.youtube.com/watch?v=sbCvQbBi2G8",
  },
] as const;

type TranscriptTab = "translated" | "bilingual" | "original";

const CACHE_KEY_PREFIX = "podcast-translation:";
const CACHE_TTL_MS = 60 * 60 * 1000;

type CacheEntry = {
  job: JobRecord;
  cachedAt: number;
};

function getCachedResult(sourceUrl: string): JobRecord | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + sourceUrl);
    if (!raw) {
      return null;
    }
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY_PREFIX + sourceUrl);
      return null;
    }
    return entry.job;
  } catch {
    return null;
  }
}

function setCachedResult(sourceUrl: string, job: JobRecord) {
  try {
    const stripped: JobRecord = {
      ...job,
      transcriptOriginal: job.transcriptOriginal,
      transcriptTranslated: job.transcriptTranslated,
      transcriptBilingual: job.transcriptBilingual,
    };
    const entry: CacheEntry = { job: stripped, cachedAt: Date.now() };
    localStorage.setItem(CACHE_KEY_PREFIX + sourceUrl, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable
  }
}

export function CreateJobForm() {
  const sessionId = useMemo(() => getSessionId(), []);
  const [url, setUrl] = useState<string>(SAMPLE_LINKS[0].url);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<JobRecord | null>(null);
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);

  async function submit(value: string) {
    setError(null);
    setResult(null);
    setAudioDataUrl(null);

    const cached = getCachedResult(value);
    if (cached) {
      setStatus(null);
      setResult(cached);
      return;
    }

    setStatus("Processing... This may take up to 60 seconds.");

    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: value,
        targetLanguage: "zh-CN",
        sessionId,
      }),
    });

    const data = (await response.json()) as {
      error?: string;
      job?: JobRecord;
      audioDataUrl?: string | null;
      cacheHit?: boolean;
    };

    if (!response.ok || !data.job) {
      setStatus(null);
      setError(data.error ?? "Unable to process this episode.");
      return;
    }

    if (data.job.status === "failed") {
      setStatus(null);
      setError(data.job.errorMessage ?? "Translation failed.");
      return;
    }

    setCachedResult(value, data.job);
    setResult(data.job);
    setAudioDataUrl(data.audioDataUrl ?? null);
    setStatus(null);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="source-url" className="text-sm font-medium">
          Single episode URL
        </label>
        <textarea
          id="source-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Paste an Apple Podcasts episode URL, a YouTube single-video URL, or a direct audio URL."
          className="min-h-32 w-full rounded-[24px] border border-[var(--line)] bg-white px-4 py-4 text-sm outline-none transition focus:border-[var(--accent)]"
        />
      </div>

      <div className="grid gap-3 rounded-[24px] border border-[var(--line)] bg-white/70 p-4 text-sm text-[var(--muted)]">
        <div className="flex items-center justify-between">
          <span>Target language</span>
          <span className="font-medium text-[var(--foreground)]">Chinese only</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Flow</span>
          <span className="font-medium text-[var(--foreground)]">
            Sync processing (up to 60s)
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Session</span>
          <span className="mono text-xs">{sessionId}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {SAMPLE_LINKS.map((sample) => (
          <button
            key={sample.url}
            type="button"
            disabled={isPending}
            onClick={() => setUrl(sample.url)}
            className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] disabled:opacity-50"
          >
            {sample.label}
          </button>
        ))}
      </div>

      {status ? (
        <div className="rounded-2xl border border-[var(--line)] bg-white/80 px-4 py-3 text-sm text-[var(--ink-soft)]">
          {status}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-[color:rgba(178,58,56,0.3)] bg-[color:rgba(178,58,56,0.08)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(() => {
            void submit(url);
          })
        }
        className="rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Processing..." : "Translate episode"}
      </button>

      {result ? <InlineResult job={result} audioDataUrl={audioDataUrl} /> : null}
    </div>
  );
}

function InlineResult({ job, audioDataUrl }: { job: JobRecord; audioDataUrl: string | null }) {
  const [activeTab, setActiveTab] = useState<TranscriptTab>("translated");
  const transcript = selectTranscript(job, activeTab);

  return (
    <div className="mt-4 space-y-6">
      <div className="rounded-[32px] border border-[var(--line)] bg-white/80 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent-strong)]">
          Result
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          {job.title || "Untitled episode"}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {job.showTitle || "Unknown show"}
        </p>

        <div className="mt-4 grid gap-2 text-sm text-[var(--ink-soft)]">
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Platform</span>
            <span>{job.platform}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Duration</span>
            <span>
              {job.durationSeconds
                ? `${Math.floor(job.durationSeconds / 60)}m ${job.durationSeconds % 60}s`
                : "Unknown"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Status</span>
            <span className="font-medium text-green-700">{job.status}</span>
          </div>
        </div>

        {job.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={job.coverUrl}
            alt={job.title || "Episode cover"}
            className="mt-4 aspect-square w-full max-w-xs rounded-[24px] object-cover"
          />
        ) : null}

        {audioDataUrl || job.audioTranslatedPath ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-semibold">Translated audio (Chinese)</p>
            <audio
              controls
              className="w-full"
              src={audioDataUrl ?? job.audioTranslatedPath ?? undefined}
              preload="metadata"
            />
            <p className="text-xs text-[var(--muted)]">
              {job.cloneStatus === "ready"
                ? "Voice clone applied to match the original speaker."
                : job.cloneStatus === "failed"
                  ? "Translation succeeded, but voice cloning failed."
                  : "Default voice used."}
            </p>
          </div>
        ) : null}

        {job.audioOriginalPath ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-semibold">Original audio</p>
            <audio
              controls
              className="w-full"
              src={job.audioOriginalPath}
              preload="metadata"
            />
          </div>
        ) : null}

        {job.errorMessage ? (
          <div className="mt-4 rounded-2xl border border-[color:rgba(178,58,56,0.25)] bg-[color:rgba(178,58,56,0.08)] px-4 py-3 text-sm text-[var(--danger)]">
            {job.errorMessage}
          </div>
        ) : null}
      </div>

      {transcript.length > 0 ? (
        <div className="rounded-[32px] border border-[var(--line)] bg-white/80 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm font-semibold">Transcript</p>
            <div className="flex gap-1 rounded-full border border-[var(--line)] bg-white p-1">
              <TabButton
                isActive={activeTab === "translated"}
                onClick={() => setActiveTab("translated")}
              >
                Chinese
              </TabButton>
              <TabButton
                isActive={activeTab === "bilingual"}
                onClick={() => setActiveTab("bilingual")}
              >
                Bilingual
              </TabButton>
              <TabButton
                isActive={activeTab === "original"}
                onClick={() => setActiveTab("original")}
              >
                Original
              </TabButton>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {transcript.map((segment, index) => (
              <article
                key={`${segment.startMs}-${index}`}
                className="rounded-[20px] border border-[var(--line)] bg-[var(--card-strong)] p-4"
              >
                <p className="mono text-xs text-[var(--accent-strong)]">
                  {formatTimestamp(segment.startMs)} - {formatTimestamp(segment.endMs)}
                </p>
                {activeTab === "translated" ? (
                  <p className="mt-2 text-sm leading-7">
                    {segment.translatedText || segment.sourceText}
                  </p>
                ) : null}
                {activeTab === "original" ? (
                  <p className="mt-2 text-sm leading-7">{segment.sourceText}</p>
                ) : null}
                {activeTab === "bilingual" ? (
                  <div className="mt-2 space-y-1 text-sm leading-7">
                    <p>{segment.translatedText || segment.sourceText}</p>
                    <p className="text-[var(--muted)]">{segment.sourceText}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TabButton({
  children,
  isActive,
  onClick,
}: {
  children: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        isActive
          ? "bg-[var(--foreground)] text-white"
          : "text-[var(--muted)] hover:text-[var(--foreground)]"
      }`}
    >
      {children}
    </button>
  );
}

function selectTranscript(
  job: JobRecord,
  tab: TranscriptTab,
): TranscriptSegment[] {
  if (tab === "original") {
    return job.transcriptOriginal;
  }
  if (tab === "translated") {
    return job.transcriptTranslated.length > 0
      ? job.transcriptTranslated
      : job.transcriptOriginal;
  }
  return job.transcriptBilingual.length > 0
    ? job.transcriptBilingual
    : job.transcriptTranslated.length > 0
      ? job.transcriptTranslated
      : job.transcriptOriginal;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
