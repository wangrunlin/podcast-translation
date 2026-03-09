"use client";

import { useMemo, useState, useTransition } from "react";
import { getSessionId } from "@/lib/session";
import type { TranscriptSegment } from "@/lib/types";

const SAMPLE_LINKS = [
  {
    label: "Apple / 60-Second Mind",
    url: "https://podcasts.apple.com/us/podcast/60-second-mind/id262750202?uo=4",
  },
  {
    label: "Apple / English in a Minute",
    url: "https://podcasts.apple.com/us/podcast/english-in-a-minute/id1617614727?uo=4",
  },
  {
    label: "YouTube / TED-Ed",
    url: "https://www.youtube.com/watch?v=sbCvQbBi2G8",
  },
] as const;

const CACHE_KEY = "podcast-translation-cache-v1";

type DemoResult = {
  metadata: {
    title: string;
    showTitle: string;
    durationSeconds: number | null;
    coverUrl: string | null;
    sourceUrl?: string;
    platform?: string;
  };
  transcriptOriginal: TranscriptSegment[];
  transcriptTranslated: TranscriptSegment[];
  audioDataUrl: string;
};

type CacheEntry = {
  savedAt: string;
  result: DemoResult;
};

export function CreateJobForm() {
  const sessionId = useMemo(() => getSessionId(), []);
  const [url, setUrl] = useState<string>(SAMPLE_LINKS[0].url);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [cacheHit, setCacheHit] = useState(false);
  const [isPending, startTransition] = useTransition();
  const cachedEntry = useMemo(() => readCache(normalizeUrl(url)), [url]);

  const submit = async (value: string) => {
    const cacheKey = normalizeUrl(value);
    const cached = readCache(cacheKey);
    setError(null);

    if (cached) {
      setResult(cached.result);
      setCacheHit(true);
      return;
    }

    const response = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceUrl: value }),
    });

    const data = (await response.json()) as DemoResult & { error?: string };
    if (!response.ok) {
      setResult(null);
      setCacheHit(false);
      setError(data.error ?? "Unable to process this link.");
      return;
    }

    const nextResult: DemoResult = {
      metadata: data.metadata,
      transcriptOriginal: data.transcriptOriginal,
      transcriptTranslated: data.transcriptTranslated,
      audioDataUrl: data.audioDataUrl,
    };

    writeCache(cacheKey, nextResult);
    setResult(nextResult);
    setCacheHit(false);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="source-url" className="text-sm font-medium">
          Episode URL
        </label>
        <textarea
          id="source-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Paste an Apple Podcasts episode URL, a YouTube video URL with English captions, or a direct audio URL."
          className="min-h-32 w-full rounded-[24px] border border-[var(--line)] bg-white px-4 py-4 text-sm outline-none transition focus:border-[var(--accent)]"
        />
      </div>

      <div className="grid gap-3 rounded-[24px] border border-[var(--line)] bg-white/70 p-4 text-sm text-[var(--muted)]">
        <div className="flex items-center justify-between">
          <span>Target language</span>
          <span className="font-medium text-[var(--foreground)]">Chinese only</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Mode</span>
          <span className="font-medium text-[var(--foreground)]">
            Instant processing + browser cache
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>History key</span>
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

      {error ? (
        <div className="rounded-2xl border border-[color:rgba(178,58,56,0.3)] bg-[color:rgba(178,58,56,0.08)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
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
          {isPending ? "Processing..." : "Translate now"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => clearCache(normalizeUrl(url))}
          className="rounded-full border border-[var(--line)] bg-white px-5 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] disabled:opacity-50"
        >
          Clear cached result
        </button>
      </div>

      {result ? (
        <div className="space-y-4 rounded-[28px] border border-[var(--line)] bg-white/80 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-[var(--foreground)]">
                {result.metadata.title}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {result.metadata.showTitle}
              </p>
            </div>
            <span className="rounded-full bg-[color:rgba(201,107,44,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
              {cacheHit ? "Cached" : "Fresh"}
            </span>
          </div>

          <audio controls className="w-full" src={result.audioDataUrl} preload="metadata" />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-[var(--line)] bg-[var(--card-strong)] p-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">Chinese</p>
              <div className="mt-3 space-y-3 text-sm leading-7">
                {result.transcriptTranslated.map((segment, index) => (
                  <p key={`${segment.startMs}-${index}`}>
                    {segment.translatedText || segment.sourceText}
                  </p>
                ))}
              </div>
            </div>
            <div className="rounded-[24px] border border-[var(--line)] bg-[var(--card-strong)] p-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">Original</p>
              <div className="mt-3 space-y-3 text-sm leading-7 text-[var(--muted)]">
                {result.transcriptOriginal.map((segment, index) => (
                  <p key={`${segment.startMs}-${index}`}>{segment.sourceText}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!result && cachedEntry ? (
        <div className="rounded-[24px] border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--muted)]">
          A cached result exists for this link. Click `Translate now` to open it instantly.
        </div>
      ) : null}
    </div>
  );
}

function normalizeUrl(value: string) {
  return value.trim();
}

function readCache(key: string) {
  if (typeof window === "undefined" || !key) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const cache = raw ? (JSON.parse(raw) as Record<string, CacheEntry>) : {};
    return cache[key] ?? null;
  } catch {
    return null;
  }
}

function writeCache(key: string, result: DemoResult) {
  if (typeof window === "undefined" || !key) {
    return;
  }

  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const cache = raw ? (JSON.parse(raw) as Record<string, CacheEntry>) : {};
    cache[key] = {
      savedAt: new Date().toISOString(),
      result,
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache failure should never block playback.
  }
}

function clearCache(key: string) {
  if (typeof window === "undefined" || !key) {
    return;
  }

  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const cache = raw ? (JSON.parse(raw) as Record<string, CacheEntry>) : {};
    delete cache[key];
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore cache failures.
  }
}
