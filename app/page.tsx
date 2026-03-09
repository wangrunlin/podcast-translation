import Link from "next/link";
import { CreateJobForm } from "@/components/create-job-form";
import { RecentJobs } from "@/components/recent-jobs";
import { listRecentJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export default function Home() {
  const recentJobs = listRecentJobs();

  return (
    <main className="shell">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-7xl flex-col gap-8">
        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="panel overflow-hidden rounded-[32px] p-8 lg:p-12">
            <div className="mb-6 inline-flex items-center gap-3 rounded-full bg-white/70 px-4 py-2 text-xs font-semibold">
              <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
              <span className="eyebrow">Demo / English to Chinese</span>
            </div>
            <div className="max-w-3xl">
              <h1 className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-6xl">
                Paste one podcast link. Get a playable Chinese episode.
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--ink-soft)]">
                This demo validates the core promise from the PRD: submit a
                single episode, process it asynchronously, and return playable
                translated audio with original, translated, and bilingual
                transcript views.
              </p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                "Apple episodes, YouTube videos with English captions, and direct audio URLs are supported.",
                "Homepage now prioritizes instant playback with browser-side caching.",
                "OpenRouter handles transcript + translation, MiniMax handles Chinese TTS.",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-3xl border border-[var(--line)] bg-white/60 p-4 text-sm leading-6 text-[var(--ink-soft)]"
                >
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/demo"
                className="rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Open instant demo
              </Link>
              <p className="self-center text-sm text-[var(--muted)]">
                The main path now runs directly on the homepage. The demo page remains for isolated debugging.
              </p>
            </div>
          </div>

          <aside className="panel rounded-[32px] p-6 lg:p-8">
            <div className="mb-6">
              <p className="eyebrow text-xs font-semibold">New Job</p>
              <h2 className="mt-3 text-2xl font-semibold">Start a translation</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                Hard limits for this demo: English to Chinese only, one clip at
                a time, and a sync processing cap of 8 minutes.
              </p>
            </div>
            <CreateJobForm />
          </aside>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="panel rounded-[32px] p-6">
            <p className="eyebrow text-xs font-semibold">Scope</p>
            <div className="mt-4 grid gap-4 text-sm leading-6 text-[var(--ink-soft)]">
              <div className="rounded-3xl bg-white/60 p-4">
                <p className="font-semibold text-[var(--foreground)]">
                  Supported inputs
                </p>
                <p className="mt-2">
                  Apple Podcasts episode links and YouTube videos with English
                  captions are supported. Direct audio links ending in mp3, m4a,
                  wav, or ogg are also supported as a deterministic fallback.
                </p>
              </div>
              <div className="rounded-3xl bg-white/60 p-4">
                <p className="font-semibold text-[var(--foreground)]">
                  Processing stages
                </p>
                <p className="mt-2">
                  Resolve source metadata, extract transcript, translate, and
                  synthesize Chinese playback. Repeated links are cached in the
                  browser for much faster replay.
                </p>
              </div>
            </div>
          </div>

          <RecentJobs jobs={recentJobs} />
        </section>
      </div>
    </main>
  );
}
