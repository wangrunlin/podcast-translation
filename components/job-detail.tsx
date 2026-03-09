"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { JobRecord, TranscriptSegment } from "@/lib/types";
import {
  formatJobDuration,
  formatJobTimestamp,
  isTerminalStatus,
  stageLabel,
  statusLabel,
} from "@/lib/ui";
import { getSessionId } from "@/lib/session";

type JobDetailProps = {
  initialJob: JobRecord;
};

type TranscriptTab = "translated" | "bilingual" | "original";

export function JobDetail({ initialJob }: JobDetailProps) {
  const sessionId = useMemo(() => getSessionId(), []);
  const [job, setJob] = useState(initialJob);
  const [activeTab, setActiveTab] = useState<TranscriptTab>("translated");
  const [isRetryPending, startRetryTransition] = useTransition();

  useEffect(() => {
    if (isTerminalStatus(job.status)) {
      return;
    }

    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { job: JobRecord };
      setJob(data.job);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [job.id, job.status]);

  const transcript = selectTranscript(job, activeTab);

  return (
    <div className="grid gap-6 lg:grid-cols-[0.88fr_1.12fr]">
      <section className="panel rounded-[32px] p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="text-sm text-[var(--muted)] underline-offset-4 hover:underline"
          >
            Back to home
          </Link>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
            {statusLabel[job.status]}
          </span>
        </div>

        <div className="mt-6">
          <p className="eyebrow text-xs font-semibold">Job</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {job.title || "Untitled episode"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {job.showTitle || "Unknown show"}
          </p>
        </div>

        <div className="mt-6 grid gap-3 rounded-[28px] border border-[var(--line)] bg-white/70 p-5 text-sm text-[var(--ink-soft)]">
          <DetailRow label="Platform" value={job.platform} />
          <DetailRow label="Duration" value={formatJobDuration(job.durationSeconds)} />
          <DetailRow label="Stage" value={stageLabel[job.currentStage]} />
          <DetailRow label="Session" value={sessionId} mono />
        </div>

        {job.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={job.coverUrl}
            alt={job.title || "Episode cover"}
            className="mt-6 aspect-square w-full rounded-[28px] object-cover"
          />
        ) : (
          <div className="mt-6 flex aspect-square w-full items-center justify-center rounded-[28px] bg-[color:rgba(201,107,44,0.12)] text-sm text-[var(--accent-strong)]">
            No cover image available
          </div>
        )}

        {job.status === "completed" && job.audioTranslatedPath ? (
          <div className="mt-6 rounded-[28px] border border-[var(--line)] bg-white/80 p-5">
            <p className="text-sm font-semibold">Translated audio</p>
            <audio
              controls
              className="mt-4 w-full"
              src={job.audioTranslatedPath}
              preload="metadata"
            />
          </div>
        ) : null}

        {job.errorMessage ? (
          <div className="mt-6 rounded-[28px] border border-[color:rgba(178,58,56,0.25)] bg-[color:rgba(178,58,56,0.08)] p-5 text-sm text-[var(--danger)]">
            {job.errorMessage}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {job.sourceUrl ? (
            <a
              href={job.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold"
            >
              Open source
            </a>
          ) : null}
          {job.status === "failed" ? (
            <button
              type="button"
              disabled={isRetryPending}
              onClick={() =>
                startRetryTransition(async () => {
                  await fetch(`/api/jobs/${job.id}/retry`, { method: "POST" });
                  const response = await fetch(`/api/jobs/${job.id}`, {
                    cache: "no-store",
                  });
                  const data = (await response.json()) as { job: JobRecord };
                  setJob(data.job);
                })
              }
              className="rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {isRetryPending ? "Retrying..." : "Retry job"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="panel rounded-[32px] p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow text-xs font-semibold">Transcript</p>
            <h2 className="mt-3 text-2xl font-semibold">Read while you listen</h2>
          </div>
          <div className="flex flex-wrap gap-2 rounded-full border border-[var(--line)] bg-white p-1">
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

        <div className="mt-6 rounded-[28px] border border-[var(--line)] bg-white/70 p-5">
          {transcript.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-[var(--line)] p-8 text-sm text-[var(--muted)]">
              Transcript will appear here after the job reaches the completed
              state.
            </div>
          ) : (
            <div className="space-y-4">
              {transcript.map((segment, index) => (
                <article
                  key={`${segment.startMs}-${index}`}
                  className="rounded-[24px] border border-[var(--line)] bg-[var(--card-strong)] p-4"
                >
                  <p className="mono text-xs text-[var(--accent-strong)]">
                    {formatJobTimestamp(segment.startMs)} -{" "}
                    {formatJobTimestamp(segment.endMs)}
                  </p>
                  {activeTab === "translated" ? (
                    <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                      {segment.translatedText || segment.sourceText}
                    </p>
                  ) : null}
                  {activeTab === "original" ? (
                    <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                      {segment.sourceText}
                    </p>
                  ) : null}
                  {activeTab === "bilingual" ? (
                    <div className="mt-3 space-y-2 text-sm leading-7">
                      <p>{segment.translatedText || segment.sourceText}</p>
                      <p className="text-[var(--muted)]">{segment.sourceText}</p>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={mono ? "mono text-xs text-right" : "text-right"}>{value}</span>
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
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        isActive
          ? "bg-[var(--foreground)] text-white"
          : "text-[var(--muted)] hover:text-[var(--foreground)]"
      }`}
    >
      {children}
    </button>
  );
}

function selectTranscript(job: JobRecord, tab: TranscriptTab): TranscriptSegment[] {
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
