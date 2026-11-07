import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { Anchor, ArrowLeft, CircleStop, Download, GitCompareArrows, ShieldAlert } from "lucide-react";
import type { TraceEvent } from "@workspace/api-client-react";
import { ErrorState, Eyebrow, Skel, btnGhost, btnTeal } from "@/components/bits";
import { RunStatusPill, runStatusHint } from "@/components/project-bits";
import { FlowGraph } from "@/components/flow-graph";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { JourneyTimeline, ModeToggle, primaryEvent } from "@/components/presentation";
import type { JourneyStep } from "@/lib/journey";
import { projectRealJourney } from "@/lib/real-journey";
import { usePresentation } from "@/hooks/use-presentation";
import { downloadRunExport, useFinishRun, useProject, useProjectRun, useSetProjectBaseline } from "@/lib/project-api";
import { ago, errMessage } from "@/lib/trace";
import { useToast } from "@/hooks/use-toast";

export default function ProjectRunPage() {
  const { id = "", runId = "" } = useParams<{ id: string; runId: string }>();
  const q = useProjectRun(id, runId);
  const proj = useProject(id);
  const finish = useFinishRun(id);
  const setBaseline = useSetProjectBaseline(id);
  const { toast } = useToast();
  const [mode, setMode] = usePresentation();
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedId, setSelectedIdRaw] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const events = useMemo(() => q.data?.events ?? [], [q.data]);
  const run = q.data?.run;
  const expected = useMemo(() => q.data?.steps ?? [], [q.data]);
  const steps = useMemo(() => (run ? projectRealJourney(events, run.status, expected) : []), [events, run, expected]);
  const step = steps.find((s) => s.id === selectedStepId) ?? null;
  const selected = events.find((e) => e.id === selectedId) ?? primaryEvent(step);
  const selectEvent = (e: TraceEvent) => { setSelectedIdRaw(e.id); setSelectedStepId(e.stepId); setOpen(true); };
  const selectStep = (s: JourneyStep) => { setSelectedStepId(s.id); setSelectedIdRaw(primaryEvent(s)?.id ?? null); setOpen(true); };

  const back = <Link href={`/projects/${id}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> {proj.data?.project.name ?? "Project"}</Link>;
  if (q.isLoading) return <div className="space-y-6"><Skel className="h-24" /><Skel className="h-[360px]" /></div>;
  if (q.isError || !run) return <div className="space-y-6">{back}<ErrorState message={q.error ? errMessage(q.error) : "Run not found."} onRetry={() => q.refetch()} /></div>;

  const project = proj.data?.project;
  const isBaseline = project?.baselineId === run.id;
  const canBaseline = run.status === "passed" && !isBaseline;
  const doExport = async () => {
    setExporting(true);
    try { await downloadRunExport(id, run.id); } catch (e) { toast({ title: "Export failed", description: errMessage(e), variant: "destructive" }); }
    setExporting(false);
  };

  return (
    <div>
      {back}
      <header className="rise mb-8 mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusPill status={run.status} />
            {isBaseline && <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok"><Anchor className="h-3.5 w-3.5" /> baseline</span>}
            <span className="font-mono text-[11px] text-muted-foreground">started {ago(run.createdAt)}</span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold leading-tight md:text-[2.4rem] [overflow-wrap:anywhere]">{run.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{runStatusHint(run.status)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.status === "recording" && <button className={btnGhost} disabled={finish.isPending} onClick={() => finish.mutate(run.id)} data-testid="button-stop-run"><CircleStop className="h-4 w-4" /> Stop (mark incomplete)</button>}
          {canBaseline && <button className={btnTeal} disabled={setBaseline.isPending} onClick={() => setBaseline.mutate(run.id, { onSuccess: () => toast({ title: "Baseline set" }), onError: (e) => toast({ title: "Failed", description: errMessage(e), variant: "destructive" }) })} data-testid="button-set-baseline"><Anchor className="h-4 w-4" /> Trust as baseline</button>}
          {project?.baselineId && !isBaseline && run.status !== "recording" && <Link href={`/projects/${id}/compare?baseline=${project.baselineId}&run=${run.id}`} className={btnGhost}><GitCompareArrows className="h-4 w-4" /> Compare to baseline</Link>}
          <button className={btnGhost} onClick={doExport} disabled={exporting} data-testid="button-export"><Download className="h-4 w-4" /> Export</button>
        </div>
      </header>

      {run.status === "incomplete" && (
        <div className="mb-6 flex gap-3 rounded-2xl border border-warn/35 bg-warn/5 p-4"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" /><p className="text-sm text-muted-foreground"><span className="font-semibold text-warn">Interrupted.</span> The recording ended before the SDK finished. Steps after the last event were not observed, which is not the same as failing.</p></div>
      )}
      {run.recorderError && (
        <div className="mb-6 flex gap-3 rounded-2xl border border-warn/35 bg-warn/5 p-4"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" /><p className="break-words text-sm text-muted-foreground"><span className="font-semibold text-warn">Recorder issue, not an app failure:</span> {run.recorderError}</p></div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>{mode === "journey" ? "Journey · select a step" : "Flow · select any node for evidence"}</Eyebrow>
        <div className="flex items-center gap-3">
          {mode === "developer" && <span className="font-mono text-[11px] text-muted-foreground">{events.length} events</span>}
          <ModeToggle mode={mode} setMode={setMode} />
        </div>
      </div>

      {events.length === 0 && mode === "developer" ? (
        <div className="grid-paper grid place-items-center rounded-2xl border border-dashed border-border bg-card/60 px-6 py-20 text-center" data-testid="empty-events">
          <div>
            {run.status === "recording" && <div className="mx-auto mb-4 h-3 w-3 rounded-full bg-ok live-dot" />}
            <div className="font-display text-xl font-semibold">{run.status === "recording" ? "Waiting for the first event" : "No events were recorded"}</div>
            <p className="mt-1 text-sm text-muted-foreground">{run.status === "recording" ? "Press Start in your application. Events appear as the SDK sends them." : "The session ended before the SDK reported anything."}</p>
          </div>
        </div>
      ) : mode === "journey" ? (
        steps.length ? <JourneyTimeline steps={steps} selectedStepId={selectedStepId} onSelect={selectStep} /> :
          <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center text-sm text-muted-foreground" data-testid="empty-events">No expected steps and no events for this run.</div>
      ) : (
        <FlowGraph events={events} selectedId={selected?.id ?? null} onSelect={selectEvent} live={run.status === "recording"} />
      )}

      <EvidenceDrawer
        open={open && (mode === "journey" ? !!step : !!selected || !!step)}
        event={selected}
        step={step}
        events={events}
        mode={mode}
        onModeChange={setMode}
        onClose={() => setOpen(false)}
        onSelect={selectEvent}
      />
    </div>
  );
}
