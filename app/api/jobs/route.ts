import { NextRequest, NextResponse } from "next/server";
import { createJob, getJobById, failJob } from "@/lib/jobs";
import { processJob } from "@/lib/worker";
import { createJobSchema } from "@/lib/validators";

export const maxDuration = 60;

const PROCESS_TIMEOUT_MS = 55_000;

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
      await Promise.race([
        processJob(job.id),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Processing timed out. Try a shorter episode.")),
            PROCESS_TIMEOUT_MS,
          ),
        ),
      ]).catch((error) => {
        failJob(job.id, "timeout", error instanceof Error ? error.message : "Timed out");
        throw error;
      });
    }

    const completed = getJobById(job.id);

    if (!completed) {
      return NextResponse.json(
        { error: "Job processing failed unexpectedly." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      job: completed,
      cacheHit,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create this job.";
    const isUserError =
      message.includes("currently supports") || message.includes("Please paste");
    return NextResponse.json(
      { error: message },
      { status: isUserError ? 400 : 500 },
    );
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
