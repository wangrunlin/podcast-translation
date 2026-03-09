import { NextRequest, NextResponse } from "next/server";
import { createJob, getJobById } from "@/lib/jobs";
import { enqueueJob } from "@/lib/queue";
import { createJobSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsed = createJobSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please provide a valid URL and a session id." },
      { status: 400 },
    );
  }

  try {
    const job = createJob(parsed.data);
    const cacheHit = job.status === "completed";
    if (!cacheHit) {
      enqueueJob(job.id);
    }

    return NextResponse.json({
      jobId: job.id,
      redirectTo: `/jobs/${job.id}`,
      cacheHit,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create this job.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("id");

  if (!jobId) {
    return NextResponse.json({ error: "Missing job id." }, { status: 400 });
  }

  const job = getJobById(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({ job });
}
