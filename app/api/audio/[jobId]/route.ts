import * as fs from "node:fs";
import * as path from "node:path";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;

  if (!/^[\w-]+$/.test(jobId)) {
    return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  }

  const filePath = path.join("/tmp", "podcast-output", `${jobId}.mp3`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: "Audio file not found. It may have expired from this server instance." },
      { status: 404 },
    );
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buffer.length),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
