import Link from "next/link";
import type { JobRecord } from "@/lib/types";
import { formatJobAge, formatJobDuration, statusLabel } from "@/lib/ui";

type RecentJobsProps = {
  jobs: JobRecord[];
};

export function RecentJobs({ jobs }: RecentJobsProps) {
  return (
    <div className="panel rounded-[32px] p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-xs font-semibold">Recent Jobs</p>
          <h2 className="mt-3 text-2xl font-semibold">Latest processing history</h2>
        </div>
        <span className="text-sm text-[var(--muted)]">{jobs.length} items</span>
      </div>

      <div className="mt-6 space-y-4">
        {jobs.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-[var(--line)] bg-white/60 px-5 py-8 text-sm text-[var(--muted)]">
            No jobs yet. Create the first one from the form above.
          </div>
        ) : (
          jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="block rounded-[28px] border border-[var(--line)] bg-white/70 p-5 transition hover:-translate-y-0.5 hover:border-[var(--accent)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {job.title || "Untitled episode"}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {job.showTitle || "Unknown show"}
                  </p>
                </div>
                <span className="rounded-full bg-[color:rgba(201,107,44,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                  {statusLabel[job.status]}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
                <span>{job.platform}</span>
                <span>{formatJobDuration(job.durationSeconds)}</span>
                <span>{formatJobAge(job.updatedAt)}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
