import { NextRequest, NextResponse } from "next/server";
import { listJobsBySession } from "@/lib/jobs";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ jobs: [] });
  }

  return NextResponse.json({ jobs: listJobsBySession(sessionId) });
}
