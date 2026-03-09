"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSessionId } from "@/lib/session";

const SAMPLE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

export function CreateJobForm() {
  const router = useRouter();
  const sessionId = useMemo(() => getSessionId(), []);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = async (value: string) => {
    setError(null);

    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: value,
        targetLanguage: "zh-CN",
        sessionId,
      }),
    });

    const data = (await response.json()) as { error?: string; redirectTo?: string };

    if (!response.ok || !data.redirectTo) {
      setError(data.error ?? "Failed to create the job.");
      return;
    }

    router.push(data.redirectTo);
    router.refresh();
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
          placeholder="Paste a YouTube podcast URL or a direct audio URL."
          className="min-h-32 w-full rounded-[24px] border border-[var(--line)] bg-white px-4 py-4 text-sm outline-none transition focus:border-[var(--accent)]"
        />
      </div>

      <div className="grid gap-3 rounded-[24px] border border-[var(--line)] bg-white/70 p-4 text-sm text-[var(--muted)]">
        <div className="flex items-center justify-between">
          <span>Target language</span>
          <span className="font-medium text-[var(--foreground)]">Chinese only</span>
        </div>
        <div className="flex items-center justify-between">
          <span>History</span>
          <span className="mono text-xs">{sessionId}</span>
        </div>
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
          {isPending ? "Creating job..." : "Start translation"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setUrl(SAMPLE_URL);
          }}
          className="rounded-full border border-[var(--line)] bg-white px-5 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] disabled:opacity-50"
        >
          Load sample link
        </button>
      </div>
    </div>
  );
}
