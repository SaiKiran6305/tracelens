import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Anchor, ArrowLeft, GitCompareArrows, ShieldAlert, XOctagon } from "lucide-react";
import {
  getGetRunQueryKey,
  getGetSummaryQueryKey,
  getListJourneysQueryKey,
  getListRunsQueryKey,
  useGetRun,
  useListJourneys,
  useSetBaseline,
  type TraceEvent,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ErrorState, Eyebrow, Skel, StatusPill, btnGhost, btnTeal } from "@/components/bits";
import { FlowGraph } from "@/components/flow-graph";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { JourneyTimeline, ModeToggle, primaryEvent } from "@/components/presentation";
import { projectJourney, type JourneyStep } from "@/lib/journey";
import { usePresentation } from "@/hooks/use-presentation";
import { VARIANT_LABEL, ago, displayPath, errMessage, fmtMs, presentationName } from "@/lib/trace";

export default function RunDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();
  const detail = useGetRun(id, {
    query: {
      enabled: !!id,
      queryKey: getGetRunQueryKey(id),
      refetchInterval: (q) => (q.state.data?.run.status === "recording" ? 1000 : false),
    },
  });
  const journeys = useListJourneys();
  const setBaseline = useSetBaseline();
  const [mode, setMode] = usePresentation();
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedId, setSelectedIdRaw] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const events = useMemo(() => detail.data?.events ?? [], [detail.data]);
  const run = detail.data?.run;
  const steps = useMemo(() => (run ? projectJourney(events, run) : []), [events, run]);
  const step = steps.find((s) => s.id === selectedStepId) ?? null;
  const selected = events.find((e) => e.id === selectedId) ?? primaryEvent(step);
  const setSelectedId = (id: string) => {
    const e = events.find((x) => x.id === id);
    setSelectedIdRaw(id);
    if (e) setSelectedStepId(e.stepId);
    setOpen(true);
  };
  const selectStep = (s: JourneyStep) => {
    setSelectedStepId(s.id);
    setSelectedIdRaw(primaryEvent(s)?.id ?? null);
    setOpen(true);
  };
  const failedStep = steps.find((s) => s.status === "failed");
  const journey = journeys.data?.find((j) => j.id === run?.journeyId);
  const firstFailure = events.find((e) => e.status != null && e.status >= 400);

  if (detail.isLoading)
    return <div className="space-y-6"><Skel className="h-24" /><Skel className="h-[360px]" /></div>;
  if (detail.isError || !run)
    return (
      <div className="space-y-6">
        <Link href="/journeys" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Journeys</Link>
        <ErrorState message={detail.error ? errMessage(detail.error) : "This run does not exist in your workspace."} onRetry={() => detail.refetch()} />
      </div>
    );

  const canBaseline = run.status === "passed" && !!run.finishedAt && !run.isBaseline;
  const doBaseline = () =>
    setBaseline.mutate(
      { id: run.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetRunQueryKey(run.id) });
          qc.invalidateQueries({ queryKey: getListJourneysQueryKey() });
          qc.invalidateQueries({ queryKey: getListRunsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
          toast({ title: "Baseline saved", description: "Future runs of this journey compare against this one." });
        },
        onError: (e) => toast({ title: "Could not set baseline", description: errMessage(e), variant: "destructive" }),
      },
    );

  return (
    <div>
      <Link href="/journeys" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:-translate-x-0.5 hover:text-foreground" data-testid="link-back">
        <ArrowLeft className="h-4 w-4" /> {run.journeyName}
      </Link>
      <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between rise">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={run.status} />
            {run.isBaseline && <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase text-ok"><Anchor className="h-3 w-3" /> baseline</span>}
            <span className="font-mono text-xs text-muted-foreground">{VARIANT_LABEL[run.variant] ?? run.variant}</span>
          </div>
          <h1 className="mt-3 text-3xl font-bold md:text-4xl" data-testid="text-run-name">{presentationName(run.name, mode)}</h1>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-muted-foreground">
            <span data-testid="text-event-count">{run.eventCount} events</span>
            {mode === "developer" && <span>{fmtMs(run.durationMs)}</span>}
            <span>started {ago(run.createdAt)}</span>
            <span>{run.finishedAt ? `finished ${ago(run.finishedAt)}` : "recording in progress"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canBaseline && (
            <button className={btnTeal} onClick={doBaseline} disabled={setBaseline.isPending} data-testid="button-set-baseline">
              <Anchor className="h-4 w-4" /> {setBaseline.isPending ? "Saving..." : "Trust as baseline"}
            </button>
          )}
          {journey?.baselineId && journey.baselineId !== run.id && run.status !== "recording" && (
            <Link href={`/compare?baseline=${journey.baselineId}&run=${run.id}`} className={btnGhost} data-testid="link-compare-run">
              <GitCompareArrows className="h-4 w-4" /> Compare with baseline
            </Link>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        {run.status === "failed" && (
          <div className="flex gap-3 rounded-2xl border border-fail/30 bg-fail/5 p-4" data-testid="status-app-failure">
            <XOctagon className="mt-0.5 h-5 w-5 shrink-0 text-fail" />
            <div>
              <div className="text-sm font-semibold text-fail">Application failure observed</div>
              <p className="text-sm text-muted-foreground">
                {mode === "journey" && failedStep ? <>Customer stopped at <button className="font-semibold text-foreground underline underline-offset-2" onClick={() => selectStep(failedStep)} data-testid="button-first-failure-step">{failedStep.label}: {failedStep.outcome}</button></> : firstFailure ? <>First failing request: <button className="break-all font-mono text-foreground underline underline-offset-2" onClick={() => setSelectedId(firstFailure.id)} data-testid="button-first-failure">#{firstFailure.sequence} {firstFailure.method} {displayPath(firstFailure.path)} {firstFailure.status}</button></> : "The run finished without a passing outcome."}
              </p>
            </div>
          </div>
        )}
        {run.recorderError && (
          <div className="flex gap-3 rounded-2xl border border-warn/35 bg-warn/5 p-4" data-testid="status-recorder-error">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
            <div>
              <div className="text-sm font-semibold text-warn">Recorder issue, not an app failure</div>
              <p className="text-sm text-muted-foreground break-words">{run.recorderError}. Evidence may be incomplete.</p>
            </div>
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>{mode === "journey" ? "Journey · click a step for what happened" : "Flow · click any node for evidence"}</Eyebrow>
        <div className="flex items-center gap-3">
          {mode === "developer" && <span className="font-mono text-[11px] text-muted-foreground">{events.length} events</span>}
          <ModeToggle mode={mode} setMode={setMode} />
        </div>
      </div>
      {events.length === 0 ? (
        <div className="grid-paper grid place-items-center rounded-2xl border border-dashed border-border bg-card/60 px-6 py-20 text-center" data-testid="empty-events">
          <div>
            <div className="mx-auto mb-4 h-3 w-3 rounded-full bg-ok live-dot" />
            <div className="font-display text-xl font-semibold">Waiting for the first event</div>
            <p className="mt-1 text-sm text-muted-foreground">Your journey will appear here as you use the app.</p>
          </div>
        </div>
      ) : (
        mode === "journey" ? (
          <JourneyTimeline steps={steps} selectedStepId={selectedStepId} onSelect={selectStep} />
        ) : (
          <FlowGraph events={events} selectedId={selected?.id ?? null} onSelect={(e: TraceEvent) => setSelectedId(e.id)} live={run.status === "recording"} />
        )
      )}

      <EvidenceDrawer
        open={open && (mode === "journey" ? !!step : !!selected || !!step)}
        event={selected}
        step={step}
        events={events}
        mode={mode}
        onModeChange={setMode}
        onClose={() => setOpen(false)}
        onSelect={(e) => setSelectedId(e.id)}
      />
    </div>
  );
}
