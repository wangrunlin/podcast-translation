import { SyncDemoForm } from "@/components/sync-demo-form";

export const dynamic = "force-dynamic";

export default function DemoPage() {
  return (
    <main className="shell">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="panel rounded-[32px] p-8">
          <p className="eyebrow text-xs font-semibold">Remote Validation</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            Synchronous short-clip demo
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--muted)]">
            This route skips SQLite and async workers so it can run on Vercel.
            It is only for validating whether remote execution can complete the
            YouTube to transcript to translation to TTS chain.
          </p>
        </section>

        <SyncDemoForm />
      </div>
    </main>
  );
}
