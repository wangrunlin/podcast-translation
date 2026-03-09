"use client";

import { useState, useTransition } from "react";
import type { TranscriptSegment } from "@/lib/types";

const SAMPLE_LINKS = [
  {
    label: "Apple / AI Daily Brief",
    url: "https://podcasts.apple.com/us/podcast/the-ai-daily-brief-artificial-intelligence-news-and-analysis/id1680633614?i=1000753866285",
  },
  {
    label: "Apple / Lex #491 OpenClaw",
    url: "https://podcasts.apple.com/cn/podcast/491-openclaw-the-viral-ai-agent-that-broke-the/id1434243584?i=1000749366733",
  },
  {
    label: "YouTube / TED-Ed",
    url: "https://www.youtube.com/watch?v=sbCvQbBi2G8",
  },
] as const;

type DemoResult = {
  metadata: {
    title: string;
    showTitle: string;
    durationSeconds: number | null;
    coverUrl: string | null;
  };
  transcriptOriginal: TranscriptSegment[];
  transcriptTranslated: TranscriptSegment[];
  audioDataUrl: string;
};

export function SyncDemoForm() {
  const [url, setUrl] = useState<string>(SAMPLE_LINKS[0].url);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <section className="panel rounded-[32px] p-8">
      <div className="space-y-4">
        <label htmlFor="sync-source" className="text-sm font-medium">
          Apple Podcasts / YouTube clip
        </label>
        <textarea
          id="sync-source"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="min-h-28 w-full rounded-[24px] border border-[var(--line)] bg-white px-4 py-4 text-sm outline-none"
        />
        <div className="grid gap-2 rounded-[24px] border border-[var(--line)] bg-white/70 p-4 text-sm text-[var(--muted)]">
          <p className="font-medium text-[var(--foreground)]">Tested samples</p>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_LINKS.map((sample) => (
              <button
                key={sample.url}
                type="button"
                onClick={() => setUrl(sample.url)}
                className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-semibold text-[var(--foreground)]"
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                setResult(null);

                const response = await fetch("/api/demo", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sourceUrl: url }),
                });

                const data = (await response.json()) as DemoResult & { error?: string };
                if (!response.ok) {
                  setError(data.error ?? "Sync demo failed.");
                  return;
                }

                setResult(data);
              })
            }
            className="rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isPending ? "Running..." : "Run remote sync demo"}
          </button>
          <button
            type="button"
            onClick={() => setUrl(SAMPLE_LINKS[0].url)}
            className="rounded-full border border-[var(--line)] bg-white px-5 py-3 text-sm font-semibold"
          >
            Use fastest sample
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded-[24px] border border-[color:rgba(178,58,56,0.25)] bg-[color:rgba(178,58,56,0.08)] p-4 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-6 space-y-6">
          <div className="rounded-[24px] border border-[var(--line)] bg-white/70 p-5">
            <p className="text-lg font-semibold">{result.metadata.title}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {result.metadata.showTitle}
            </p>
            {result.audioDataUrl ? (
              <audio controls className="mt-4 w-full" src={result.audioDataUrl} />
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-[var(--line)] bg-white/70 p-5">
              <p className="font-semibold">Chinese</p>
              <div className="mt-4 space-y-3 text-sm leading-7">
                {result.transcriptTranslated.map((segment, index) => (
                  <p key={`${segment.startMs}-${index}`}>
                    {segment.translatedText || segment.sourceText}
                  </p>
                ))}
              </div>
            </div>
            <div className="rounded-[24px] border border-[var(--line)] bg-white/70 p-5">
              <p className="font-semibold">Original</p>
              <div className="mt-4 space-y-3 text-sm leading-7 text-[var(--muted)]">
                {result.transcriptOriginal.map((segment, index) => (
                  <p key={`${segment.startMs}-${index}`}>{segment.sourceText}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
