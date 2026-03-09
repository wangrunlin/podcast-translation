import Link from "next/link";
import { JobDetail } from "@/components/job-detail";
import { getJobById } from "@/lib/jobs";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function JobPage({ params }: PageProps) {
  const { jobId } = await params;
  const job = getJobById(jobId);

  if (!job) {
    return (
      <main className="shell">
        <div className="mx-auto max-w-3xl rounded-[32px] border border-[var(--line)] bg-white/80 p-10 text-center shadow-lg">
          <p className="eyebrow text-xs font-semibold">Missing job</p>
          <h1 className="mt-4 text-3xl font-semibold">Job not found</h1>
          <p className="mt-4 text-[var(--muted)]">
            The requested result page does not exist or has been removed.
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white"
          >
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="mx-auto max-w-6xl">
        <JobDetail initialJob={job} />
      </div>
    </main>
  );
}
