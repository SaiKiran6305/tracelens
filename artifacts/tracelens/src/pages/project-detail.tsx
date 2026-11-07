import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import {
  Anchor, Archive, ArchiveRestore, ArrowLeft, ChevronLeft, ChevronRight, CircleStop, GitCompareArrows, KeyRound, Play,
  RefreshCw, Settings2, ShieldCheck, ShieldQuestion, TriangleAlert, X,
} from "lucide-react";
import { ErrorState, Eyebrow, Skel, btnGhost, btnPrimary, btnTeal, inputCls } from "@/components/bits";
import { CodeBlock, Field, RunStatusPill } from "@/components/project-bits";
import { ProjectForm } from "@/components/project-form";
import {
  collectorUrl, sdkUrl, useArchiveProject, useArchiveRun, useCreateCredential, useCreateSession, useFinishRun, useProject,
  useRevokeCredential, useRevokeSession, useUpdateProject, type Project, type SessionGrant,
} from "@/lib/project-api";
import { ago, errMessage } from "@/lib/trace";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const LIMIT = 25;

function browserSnippet(p: Project, token: string | null) {
  const first = p.steps[0] ?? { id: "request", outcome: "created", label: "Create request" };
  return `<script src=${JSON.stringify(sdkUrl())}></script>
<button id="tracelens-start">Start TraceLens</button>
<script>
  // Recording begins only after a person clicks Start in your app.
  document.getElementById("tracelens-start").addEventListener("click", async () => {
    const recorder = await TraceLens.connect({
      collectorUrl: ${JSON.stringify(collectorUrl())},
      projectId: ${JSON.stringify(p.publicId)},
      session: ${JSON.stringify(token ?? "<paste one-time session token>")},
      consent: true,
    });
    if (!recorder.runId) return; // A verification session only checks connectivity.

    await recorder.step(${JSON.stringify(first.id)}, async (ctx) => {
      const r = await ctx.fetch("/api/requests", { method: "POST" });
      const body = await r.json();
      // Example API contract only. Replace this predicate with your actual
      // business-success check before mapping it to your expected outcome key.
      if (r.ok && body.status === ${JSON.stringify(first.outcome)} && typeof body.id === "string" && body.id) {
        ctx.outcome(${JSON.stringify(first.outcome)}, "Expected business outcome verified");
      } // Do not report success from an arbitrary 2xx response.
    });

    await recorder.stop(); // Flush; conclude only with complete evidence.
  });
</script>`;
}

function serverSnippet(p: Project, runId: string | null) {
  const first = p.steps[0] ?? { id: "request", outcome: "created" };
  const body = { projectId: p.publicId, runId: runId ?? "<run id>", event: { eventId: "<unique id>", actionId: "<action id from browser>", stepId: first.id, kind: "internal", label: "Persist request", response: { outcome: first.outcome, message: "Request created" } } };
  return `curl -X POST ${JSON.stringify(collectorUrl() + "/server")} \\
  -H "Authorization: Bearer $TRACELENS_SERVER_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(body)}'`;
}

function useCountdown(iso: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!iso) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [iso]);
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  return ms <= 0 ? 0 : ms;
}

function SessionPanel({ project, onActive }: { project: Project; onActive: (a: boolean) => void }) {
  const { toast } = useToast();
  const [origin, setOrigin] = useState(project.origins[0] ?? "");
  const [runName, setRunName] = useState("");
  // One-time token lives in component state only: never URL, storage or logs.
  const [grant, setGrant] = useState<(SessionGrant & { purpose: "verify" | "record" }) | null>(null);
  const create = useCreateSession(project.id);
  const revoke = useRevokeSession(project.id);
  const left = useCountdown(grant?.expiresAt ?? null);
  const active = !!grant && left !== 0;
  useEffect(() => { onActive(active); }, [active, onActive]);
  useEffect(() => { if (grant?.purpose === "verify" && project.verifiedAt) toast({ title: "Installation verified", description: "The SDK completed its handshake from an allowed origin." }); }, [project.verifiedAt, grant?.purpose, toast]);

  const start = (purpose: "verify" | "record") => create.mutate(
    { origin, purpose, name: purpose === "record" && runName.trim() ? runName.trim() : undefined },
    { onSuccess: (g) => setGrant({ ...g, purpose }), onError: (e) => toast({ title: "Could not create session", description: errMessage(e), variant: "destructive" }) },
  );
  const doRevoke = () => {
    if (!grant) return;
    revoke.mutate(grant.runId ? { runId: grant.runId } : { token: grant.token }, {
      onSuccess: () => { setGrant(null); toast({ title: "Session revoked" }); },
      onError: (e) => toast({ title: "Revoke failed", description: errMessage(e), variant: "destructive" }),
    });
  };
  const mm = left != null ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}` : "";

  return (
    <section className="rounded-3xl border border-border bg-card p-6 md:p-8" aria-labelledby="h-integrate">
      <Eyebrow>Browser SDK</Eyebrow>
      <h2 id="h-integrate" className="mt-1 font-display text-2xl font-bold">Install, verify, record</h2>
      <dl className="mt-5 grid gap-3 text-sm md:grid-cols-3">
        {[["Public project id", project.publicId], ["Collector URL", collectorUrl()], ["SDK", sdkUrl()]].map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-xl border border-border bg-paper px-3 py-2"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="mt-0.5 break-all font-mono text-[12px]">{v}</dd></div>
        ))}
      </dl>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Field label="Origin for this session">
          <select className={inputCls} value={origin} onChange={(e) => setOrigin(e.target.value)} data-testid="select-session-origin">
            {project.origins.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Run name (recording only)">
          <input className={inputCls} value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="Staging · Tuesday smoke" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} onClick={() => start("verify")} disabled={create.isPending || !origin} data-testid="button-verify-session"><ShieldCheck className="h-4 w-4" /> Create verification session</button>
          <button className={btnTeal} onClick={() => start("record")} disabled={create.isPending || !origin} data-testid="button-start-recording"><Play className="h-4 w-4" /> Start recording</button>
        </div>
      </div>

      {grant && (
        <div className={cn("mt-6 rounded-2xl border p-4", active ? "border-ok/30 bg-ok/5" : "border-border bg-muted/50")} data-testid="panel-session">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold">{grant.purpose === "verify" ? "Verification session" : "Recording session"}</span>{" "}
              {active ? <span className="text-muted-foreground">· expires in <span className="font-mono">{mm}</span> · polling for the SDK handshake</span> : <span className="text-muted-foreground">· expired</span>}
            </div>
            <div className="flex gap-2">
              {grant.runId && <Link href={`/projects/${project.id}/runs/${grant.runId}`} className={btnGhost}>Open run</Link>}
              {active && <button className={btnGhost} onClick={doRevoke} disabled={revoke.isPending} data-testid="button-revoke-session"><X className="h-4 w-4" /> Revoke</button>}
              {!active && <button className={btnGhost} onClick={() => setGrant(null)}>Dismiss</button>}
            </div>
          </div>
          {active && <p className="mt-2 text-xs text-muted-foreground">This one-time token is shown only now and kept in memory. It's scoped to this project and origin {origin} for 20 minutes. Reloading this page forgets it.</p>}
        </div>
      )}

      <div className="mt-6 space-y-2">
        <CodeBlock id="snippet-browser" label="Paste into your application" code={browserSnippet(project, active ? grant!.token : null)} />
        <ul className="grid gap-1.5 pt-2 text-xs leading-relaxed text-muted-foreground md:grid-cols-2">
          <li>• Expected outcome keys must match exactly. A 2xx response alone marks the step <b>unknown</b>, not passed.</li>
          <li>• Use explicit semantic steps. <code className="font-mono">ctx.fetch</code> keeps action and parent correlation, even for parallel calls.</li>
          <li>• Payloads are OFF by default. Metadata-only schemas are opt-in. No arbitrary inputs and no secret headers are sent.</li>
          <li>• <code className="font-mono">recorder.stop()</code> flushes and finishes conclusively. Stopping from this dashboard marks the run incomplete.</li>
        </ul>
      </div>
    </section>
  );
}

function CredentialsPanel({ project, credentials, runId }: { project: Project; credentials: { id: string; name: string; createdAt: string; revokedAt: string | null; expiresAt: string | null }[]; runId: string | null }) {
  const { toast } = useToast();
  const create = useCreateCredential(project.id);
  const revoke = useRevokeCredential(project.id);
  const [name, setName] = useState("Backend worker");
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const live = credentials.filter((c) => !c.revokedAt);
  const make = (onDone?: (id: string) => void) => create.mutate(name.trim() || "Server key", {
    onSuccess: (r) => { setFresh({ id: r.id, token: r.token }); onDone?.(r.id); },
    onError: (e) => toast({ title: "Could not create credential", description: errMessage(e), variant: "destructive" }),
  });
  const rotate = (oldId: string) => make(() => revoke.mutate(oldId, {
    onSuccess: () => toast({ title: "Rotated", description: "The previous key is revoked." }),
    onError: (e) => toast({ title: "New key created, but revoking the old one failed", description: errMessage(e), variant: "destructive" }),
  }));

  return (
    <section className="rounded-3xl border border-border bg-card p-6 md:p-8" aria-labelledby="h-creds">
      <Eyebrow>Optional</Eyebrow>
      <h2 id="h-creds" className="mt-1 font-display text-2xl font-bold">Server credentials</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Let your backend report internal steps for a run. Server tokens belong on your server only. Never put them in the browser SDK.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <input className={inputCls + " max-w-xs"} value={name} onChange={(e) => setName(e.target.value)} aria-label="Credential name" />
        <button className={btnGhost} onClick={() => make()} disabled={create.isPending} data-testid="button-create-credential"><KeyRound className="h-4 w-4" /> Create server token</button>
      </div>
      {fresh && (
        <div className="mt-5 rounded-2xl border border-warn/40 bg-warn/5 p-4" role="status">
          <div className="flex items-start gap-2 text-sm font-semibold text-warn"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Copy this token now. It is shown once, and must stay server-side.</div>
          <div className="mt-3"><CodeBlock id="server-token" code={fresh.token} /></div>
          <button className="mt-3 text-sm text-muted-foreground underline" onClick={() => setFresh(null)}>I've stored it, hide token</button>
        </div>
      )}
      <ul className="mt-5 divide-y divide-border rounded-2xl border border-border">
        {credentials.length === 0 && <li className="p-4 text-sm text-muted-foreground">No server credentials.</li>}
        {credentials.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className={cn("font-medium", c.revokedAt && "text-muted-foreground line-through")}>{c.name}</div>
              <div className="font-mono text-[11px] text-muted-foreground">created {ago(c.createdAt)}{c.expiresAt ? ` · expires ${new Date(c.expiresAt).toLocaleDateString()}` : ""}{c.revokedAt ? ` · revoked ${ago(c.revokedAt)}` : ""}</div>
            </div>
            {!c.revokedAt && (
              <div className="flex gap-2">
                <button className={btnGhost} onClick={() => rotate(c.id)} disabled={create.isPending || revoke.isPending}><RefreshCw className="h-4 w-4" /> Rotate</button>
                <button className={btnGhost} onClick={() => confirm(`Revoke "${c.name}"? Servers using it will be rejected.`) && revoke.mutate(c.id)} disabled={revoke.isPending}>Revoke</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {live.length > 0 && <div className="mt-5"><CodeBlock id="snippet-server" label="Report an internal step from your server" code={serverSnippet(project, runId)} /></div>}
    </section>
  );
}

export default function ProjectDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [offset, setOffset] = useState(0);
  const [archivedRuns, setArchivedRuns] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pollRecording, setPollRecording] = useState(false);
  const q = useProject(id, offset, LIMIT, sessionActive || pollRecording, archivedRuns);
  const archiveRun = useArchiveRun(id);
  const finish = useFinishRun(id);
  const archive = useArchiveProject();
  const update = useUpdateProject(id);
  const { toast } = useToast();
  const runs = useMemo(() => q.data?.runs ?? [], [q.data]);
  const recording = runs.some((r) => r.status === "recording");
  useEffect(() => setPollRecording(recording), [recording]);

  if (q.isLoading) return <div className="space-y-6"><Skel className="h-28" /><Skel className="h-80" /><Skel className="h-60" /></div>;
  if (q.isError || !q.data) return (
    <div className="space-y-6">
      <Link href="/projects" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Projects</Link>
      <ErrorState message={q.error ? errMessage(q.error) : "Project not found."} onRetry={() => q.refetch()} />
    </div>
  );
  const { project: p, total, credentials } = q.data;
  const baseline = runs.find((r) => r.id === p.baselineId);
  const latestFinished = runs.find((r) => r.status !== "recording" && r.id !== p.baselineId);
  const latestRun = runs[0]?.id ?? null;

  return (
    <div className="space-y-8">
      <Link href="/projects" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Projects</Link>
      <header className="rise flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {p.verifiedAt
              ? <span className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2.5 py-0.5 text-xs font-semibold text-ok" data-testid="status-verified"><ShieldCheck className="h-3.5 w-3.5" /> SDK verified {ago(p.verifiedAt)}</span>
              : <span className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn/10 px-2.5 py-0.5 text-xs font-semibold text-warn" data-testid="status-unverified"><ShieldQuestion className="h-3.5 w-3.5" /> Not verified yet</span>}
            {p.archivedAt && <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">Archived</span>}
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold leading-tight md:text-[2.6rem]">{p.name}</h1>
          <a href={p.url} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-xs text-muted-foreground hover:text-navy">{p.url}</a>
          <p className="mt-2 text-sm text-muted-foreground">{p.workflowName} · retention {p.retentionDays} days · origins {p.origins.join(", ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} onClick={() => setEditing((e) => !e)} aria-expanded={editing}><Settings2 className="h-4 w-4" /> Settings</button>
          <button className={btnGhost} disabled={archive.isPending} data-testid="button-archive"
            onClick={() => (p.archivedAt || confirm("Archive this project? Runs are kept and you can restore it.")) && archive.mutate({ id: p.id, archived: !p.archivedAt }, { onError: (e) => toast({ title: "Failed", description: errMessage(e), variant: "destructive" }) })}>
            {p.archivedAt ? <><ArchiveRestore className="h-4 w-4" /> Restore</> : <><Archive className="h-4 w-4" /> Archive</>}
          </button>
        </div>
      </header>

      {editing && (
        <section className="rounded-3xl border border-border bg-card p-6 md:p-8">
          <h2 className="mb-5 font-display text-xl font-bold">Project settings</h2>
          <ProjectForm includeUrl={false} initial={p} submitLabel="Save changes" pending={update.isPending} serverError={update.isError ? errMessage(update.error) : null}
            onSubmit={({ name, origins, workflowName, steps, retentionDays }) => update.mutate({ name, origins, workflowName, steps, retentionDays }, { onSuccess: () => { setEditing(false); toast({ title: "Saved" }); } })} />
        </section>
      )}

      <section aria-label="Expected steps" className="flex flex-wrap items-center gap-2">
        <Eyebrow className="mr-2">Expected</Eyebrow>
        {p.steps.map((s, i) => (
          <span key={s.id} className="rounded-full border border-border bg-card px-3 py-1 text-xs"><span className="font-mono text-muted-foreground">{i + 1}.</span> {s.label} <span className="font-mono text-ok">→ {s.outcome}</span></span>
        ))}
      </section>

      {!p.archivedAt && <SessionPanel project={p} onActive={setSessionActive} />}

      <section aria-labelledby="h-runs">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><Eyebrow>{archivedRuns ? "Archived runs" : "Recorded runs"}</Eyebrow><h2 id="h-runs" className="mt-1 font-display text-2xl font-bold">{total} {total === 1 ? "run" : "runs"}</h2></div>
          <button className={btnGhost} aria-pressed={archivedRuns} data-testid="button-show-archived-runs" onClick={() => { setArchivedRuns(!archivedRuns); setOffset(0); }}>{archivedRuns ? "Show active runs" : "Show archived runs"}</button>
          {baseline && latestFinished && (
            <Link href={`/projects/${p.id}/compare?baseline=${baseline.id}&run=${latestFinished.id}`} className={btnPrimary} data-testid="link-compare-latest"><GitCompareArrows className="h-4 w-4" /> Compare latest to baseline</Link>
          )}
        </div>
        {runs.length === 0 ? (
          <div className="grid-paper rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center text-sm text-muted-foreground" data-testid="empty-runs">
            No runs yet. Start a recording session above, then press Start in your application.
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 md:flex-nowrap">
                <Link href={`/projects/${p.id}/runs/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3" data-testid={`link-run-${r.id}`}>
                  <RunStatusPill status={r.status} />
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  {r.id === p.baselineId && <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok"><Anchor className="h-3 w-3" /> baseline</span>}
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{ago(r.createdAt)}</span>
                </Link>
                {r.status !== "recording" && r.id !== p.baselineId && <button className={btnGhost + " py-1.5"} disabled={archiveRun.isPending} data-testid={`button-archive-run-${r.id}`}
                  onClick={() => archiveRun.mutate({ runId: r.id, archived: !archivedRuns }, { onError: e => toast({ title: "Could not update run", description: errMessage(e), variant: "destructive" }) })}>
                  {archivedRuns ? "Restore run" : "Archive run"}
                </button>}
                {r.status === "recording" && (
                  <button className={btnGhost + " py-1.5"} disabled={finish.isPending} onClick={() => finish.mutate(r.id, { onSuccess: () => toast({ title: "Stopped", description: "Marked incomplete. Use recorder.stop() in your app to finish conclusively." }) })} data-testid={`button-stop-${r.id}`}>
                    <CircleStop className="h-4 w-4" /> Stop
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {total > LIMIT && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
            <div className="flex gap-2">
              <button className={btnGhost} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
              <button className={btnGhost} disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </section>

      <CredentialsPanel project={p} credentials={credentials} runId={latestRun} />
    </div>
  );
}
