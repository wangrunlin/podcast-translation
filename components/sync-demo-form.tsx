"use client";

import { useState, useTransition } from "react";
import type { TranscriptSegment } from "@/lib/types";

const SAMPLE_URL = "https://www.youtube.com/watch?v=oeIUhjCyNDM";

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
  const [url, setUrl] = useState(SAMPLE_URL);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <section className="panel rounded-[32px] p-8">
      <div className="space-y-4">
        <label htmlFor="sync-source" className="text-sm font-medium">
          Short YouTube clip
        </label>
        <textarea
          id="sync-source"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="min-h-28 w-full rounded-[24px] border border-[var(--line)] bg-white px-4 py-4 text-sm outline-none"
        />
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
            onClick={() => setUrl(SAMPLE_URL)}
            className="rounded-full border border-[var(--line)] bg-white px-5 py-3 text-sm font-semibold"
          >
            Use tested sample
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
