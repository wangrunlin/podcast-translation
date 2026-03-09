"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSessionId } from "@/lib/session";

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
    label: "YouTube / AI founders clip",
    url: "https://www.youtube.com/watch?v=sbCvQbBi2G8",
  },
] as const;

export function CreateJobForm() {
  const router = useRouter();
  const sessionId = useMemo(() => getSessionId(), []);
  const [url, setUrl] = useState<string>(SAMPLE_LINKS[0].url);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function submit(value: string) {
    setError(null);
    setStatus("Validating link and checking cache...");

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
      redirectTo?: string;
      cacheHit?: boolean;
    };

    if (!response.ok || !data.redirectTo) {
      setStatus(null);
      setError(data.error ?? "Unable to create a translation job.");
      return;
    }

    setStatus(data.cacheHit ? "Cached result found. Opening now..." : "Job created. Opening processing page...");
    router.push(data.redirectTo);
    router.refresh();
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
            Cached result or async job
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
        {isPending ? "Creating job..." : "Translate episode"}
      </button>
    </div>
  );
}
