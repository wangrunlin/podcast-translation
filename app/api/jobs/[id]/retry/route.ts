import { NextResponse } from "next/server";
import { getJobById, resetJob } from "@/lib/jobs";
import { enqueueJob } from "@/lib/queue";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, { params }: RouteContext) {
  const { id } = await params;
  const job = getJobById(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  resetJob(id);
  enqueueJob(id);

  return NextResponse.json({ ok: true });
}
