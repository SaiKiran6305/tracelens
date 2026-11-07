import { Link } from "wouter";
import { Eyebrow, PageHeader, btnGhost, btnPrimary } from "@/components/bits";
import { CodeBlock } from "@/components/project-bits";
import { collectorUrl, sdkUrl } from "@/lib/project-api";

export default function Setup() {
  const snippet = `<script src=${JSON.stringify(sdkUrl())}></script>
<script>
  startButton.addEventListener("click", async () => {
    const recorder = await TraceLens.connect({
      collectorUrl: ${JSON.stringify(collectorUrl())},
      projectId: "<public project id>",
       session: "<short-lived recording session token>",
      consent: true,
    });
     if (!recorder.runId) return; // Verification sessions only check connectivity.
    await recorder.step("request", async (ctx) => {
      const r = await ctx.fetch("/api/requests", { method: "POST" });
       const body = await r.json();
       // Example API contract: a created request has status="created" and an id.
       // Replace this with your application's actual business-success condition.
       if (r.ok && body.status === "created" && typeof body.id === "string" && body.id) {
         ctx.outcome("created", "Request created");
       } // Otherwise do not assert success: an arbitrary 2xx is not proof.
    });
     const { status } = await recorder.stop(); // Flush; conclude only with complete evidence.
    // recorder.detach() instead unpatches and leaves the session incomplete to resume
  });
</script>`;

  return (
    <div>
      <PageHeader eyebrow="SDK · how it works · limits" title="Instrument an app you control">
        <Link href="/projects/new" className={btnPrimary}>Connect application</Link>
      </PageHeader>
      <section className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-8">
          <ol className="space-y-6">
            {[
              ["Create a project", "Name, application URL, exact allowed origins, workflow and expected steps with outcome keys. Creating a project does not contact your app."],
              ["Load the SDK from TraceLens", "Your page loads sdk.js and posts to the cross-origin collector. Events are accepted only from origins you listed exactly. TraceLens never proxies your application's APIs."],
              ["Verify with a handshake", "Create a verification session in the project, then connect from your app. A successful handshake from an allowed origin marks the project verified. A valid URL alone is not verification."],
              ["Record explicitly", "Start recording issues a 20-minute, project-scoped token shown once. Connect only after the person consents, and report ctx.outcome() only after your app verifies the actual business result."],
              ["Trust, then compare", "Mark a passed run as baseline; compare later runs to find the first divergence."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy font-mono text-xs font-semibold text-paper">{i + 1}</span>
                <div><div className="font-semibold">{t}</div><p className="text-sm text-muted-foreground">{d}</p></div>
              </li>
            ))}
          </ol>
          <div className="rounded-2xl border border-warn/35 bg-warn/5 p-6" data-testid="section-limitations">
            <Eyebrow className="text-warn">Limitations, stated plainly</Eyebrow>
            <ul className="mt-3 space-y-2 text-sm text-foreground/80">
              <li>Only apps that load the SDK on a listed origin can be recorded. No arbitrary-site capture.</li>
              <li>A step passes only when your app reports the exact expected outcome key. A 2xx response alone is <b>unknown</b>.</li>
              <li>Capture is metadata-first: safe paths, methods, HTTP status, timings and declared step outcomes. Request/response payload values, input changes and headers are not captured. Opt-in field schemas report presence, empty state and type only—not values.</li>
              <li>Keep personal data and secrets out of your custom labels, outcome messages and path segments. Query strings and fragments are stripped; review your instrumentation and trusted server evidence before using it with real users.</li>
              <li>Use ctx.fetch inside explicit steps so parallel calls keep their action and parent correlation. Unwrapped calls are not attributed.</li>
              <li>Session tokens expire after 20 minutes and are shown once. Dashboard Stop marks the run incomplete. recorder.stop() flushes first; missing or dropped evidence cannot produce a passed run.</li>
              <li>Backend steps appear only if your server reports them with a server credential. TraceLens does not infer server internals.</li>
              <li>Concluded runs older than the project's retention (1 to 90 days) are automatically archived, not deleted. Baselines are preserved. Archived runs can be restored; retention does not erase their stored data.</li>
              <li>TraceLens reports observed differences. It does not claim root causes.</li>
            </ul>
          </div>
        </div>
        <div className="space-y-6">
          <CodeBlock code={snippet} id="sdk" label="Browser SDK" />
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Sample checkout recordings live in <Link href="/examples" className="font-medium text-navy underline">Examples</Link>. They are stored on the server and scoped to this browser's anonymous workspace cookie, separately from your signed-in projects.
            <div className="mt-4"><Link href="/demo" className={btnGhost}>Open checkout demo</Link></div>
          </div>
        </div>
      </section>
    </div>
  );
}
