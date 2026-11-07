import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowRight, ChevronDown, Code2, Download, Flag, GitCompareArrows } from "lucide-react";
import {
  getCompareRunsQueryKey,
  getGetRunQueryKey,
  useCompareRuns,
  useGetRun,
  useListRuns,
  type ComparisonRow,
  type TraceEvent,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { ErrorState, Eyebrow, KindIcon, PageHeader, Skel, StatusPill, btnGhost, btnPrimary, inputCls } from "@/components/bits";
import { JourneyStepDetail, ModeToggle, StepBadge } from "@/components/presentation";
import { compareJourneySteps, projectJourney, type JourneyStep } from "@/lib/journey";
import { usePresentation } from "@/hooks/use-presentation";
import { displayPath, divergenceSummary, errMessage, eventTone, fmtMs, presentationName, readableReason } from "@/lib/trace";

const CHANGE_STYLE: Record<string, string> = {
  unchanged: "border-border bg-card",
  changed: "border-warn/40 bg-warn/5",
  missing: "border-fail/35 bg-fail/5",
  extra: "border-warn/40 bg-warn/5",
};
const CHANGE_TEXT: Record<string, string> = { unchanged: "text-ok", changed: "text-warn", missing: "text-fail", extra: "text-warn" };

function Cell({ e, side }: { e: TraceEvent | null; side: string }) {
  if (!e) return <div className="rounded-xl border border-dashed border-border/80 px-3 py-3 font-mono text-[11px] text-muted-foreground">not observed in {side}</div>;
  const tone = eventTone(e);
  return (
    <div className="min-w-0 px-1">
      <div className="flex items-center gap-2 text-sm font-medium"><KindIcon kind={e.kind} className="text-muted-foreground" /> <span className="truncate">{e.label}</span></div>
      <div className="mt-1 flex flex-wrap gap-x-2 font-mono text-[11px] text-muted-foreground">
        {e.method && <span className="break-all">{e.method} {displayPath(e.path)}</span>}
        {e.status != null && <span className={tone === "fail" ? "text-fail font-semibold" : tone === "ok" ? "text-ok" : ""}>{e.status}</span>}
        {e.durationMs != null && <span>{fmtMs(e.durationMs)}</span>}
        {e.attempt != null && e.attempt > 1 && <span className="text-warn">attempt {e.attempt}</span>}
      </div>
    </div>
  );
}

function Outcome({ s, side }: { s: JourneyStep | null; side: string }) {
  if (!s) return <div className="rounded-xl border border-dashed border-border/80 px-3 py-3 text-sm text-muted-foreground">Not part of the {side}</div>;
  return (
    <div className="min-w-0 px-1">
      <StepBadge status={s.status} />
      <div className="mt-1.5 font-display text-lg font-bold leading-tight [overflow-wrap:anywhere]">{s.outcome}</div>
    </div>
  );
}

export default function Compare() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const baselineId = params.get("baseline") ?? "";
  const runId = params.get("run") ?? "";
  const runs = useListRuns();
  const finished = useMemo(() => (runs.data ?? []).filter((r) => r.status !== "recording"), [runs.data]);
  const baselines = finished.filter((r) => r.status === "passed");
  const enabled = !!baselineId && !!runId && baselineId !== runId;
  const cmp = useCompareRuns({ baselineId, runId }, { query: { enabled, queryKey: getCompareRunsQueryKey({ baselineId, runId }) } });
  const firstRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = usePresentation();
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const bRun = useGetRun(baselineId, { query: { enabled: enabled && mode === "journey", queryKey: getGetRunQueryKey(baselineId) } });
  const cRun = useGetRun(runId, { query: { enabled: enabled && mode === "journey", queryKey: getGetRunQueryKey(runId) } });
  const jrows = useMemo(() => {
    if (!bRun.data || !cRun.data) return null;
    return compareJourneySteps(projectJourney(bRun.data.events, bRun.data.run), projectJourney(cRun.data.events, cRun.data.run));
  }, [bRun.data, cRun.data]);
  const jFirst = jrows?.find((r) => r.changed);
  const jLoading = mode === "journey" && enabled && (bRun.isLoading || cRun.isLoading);
  const jError = mode === "journey" && enabled && (bRun.isError || cRun.isError);

  useEffect(() => {
    if (baselineId || !runs.data) return;
    const b = runs.data.find((r) => r.isBaseline) ?? runs.data.find((r) => r.status === "passed");
    const other = b && runs.data.find((r) => r.id !== b.id && r.status !== "recording" && r.journeyId === b.journeyId);
    if (b) setLocation(`/compare?baseline=${b.id}${other ? `&run=${other.id}` : runId ? `&run=${runId}` : ""}`, { replace: true });
  }, [baselineId, runId, runs.data, setLocation]);

  useEffect(() => {
    if (cmp.data?.firstDivergence && mode === "developer") firstRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [cmp.data?.firstDivergence, mode]);

  const update = (b: string, r: string) => setLocation(`/compare?baseline=${b}&run=${r}`);
  const download = () => {
    if (!cmp.data) return;
    const blob = new Blob([cmp.data.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tracelens-${cmp.data.current.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-vs-baseline.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const d = cmp.data;
  const firstRow: ComparisonRow | undefined = d?.rows.find((r) => r.key === d.firstDivergence);

  return (
    <div>
      <PageHeader eyebrow="Aligned comparison" title="Where did this run stop matching?">
        <ModeToggle mode={mode} setMode={setMode} />
        {d && mode === "developer" && <button className={btnPrimary} onClick={download} data-testid="button-download-markdown"><Download className="h-4 w-4" /> Download Markdown</button>}
        {d && mode === "journey" && <button className={btnGhost} onClick={() => setMode("developer")} data-testid="button-export-developer" title="The Markdown export contains technical evidence"><Code2 className="h-4 w-4" /> Export in Developer view</button>}
      </PageHeader>

      <div className="mb-10 grid gap-4 rounded-2xl border border-border bg-card p-5 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-end">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ok">Trusted baseline</span>
          <select data-testid="select-baseline" className={inputCls} value={baselineId} onChange={(e) => update(e.target.value, runId)}>
            <option value="">Choose a passed run</option>
            {baselines.map((r) => <option key={r.id} value={r.id}>{r.isBaseline ? "[baseline] " : ""}{presentationName(r.name, mode)} · {r.journeyName}</option>)}
          </select>
        </label>
        <ArrowRight className="mx-auto hidden h-5 w-5 text-muted-foreground md:mb-3 md:block" />
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-navy">Run under inspection</span>
          <select data-testid="select-run" className={inputCls} value={runId} onChange={(e) => update(baselineId, e.target.value)}>
            <option value="">Choose a finished run</option>
            {finished.filter((r) => r.id !== baselineId).map((r) => <option key={r.id} value={r.id}>{presentationName(r.name, mode)} · {r.status}</option>)}
          </select>
        </label>
      </div>

      {runs.isLoading && <Skel className="h-64" />}
      {!runs.isLoading && baselines.length === 0 && (
        <div className="rounded-3xl border border-dashed border-navy/25 bg-card/70 p-10 text-center" data-testid="empty-compare">
          <GitCompareArrows className="mx-auto h-8 w-8 text-navy/50" />
          <h2 className="mt-4 text-2xl font-bold">You need a run you trust first</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">Record a passing checkout, then record a broken one. Comparison only works against real evidence.</p>
          <Link href="/demo" className={btnPrimary + " mt-6"} data-testid="button-compare-demo">Try checkout demo</Link>
        </div>
      )}
      {baselines.length > 0 && !enabled && !runs.isLoading && (
        <p className="text-sm text-muted-foreground">Pick two different runs to align their evidence.</p>
      )}
      {enabled && cmp.isLoading && <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skel key={i} className="h-16" />)}</div>}
      {enabled && cmp.isError && <ErrorState message={errMessage(cmp.error)} onRetry={() => cmp.refetch()} />}

      {d && mode === "journey" && jLoading && <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skel key={i} className="h-20" />)}</div>}
      {d && mode === "journey" && jError && <ErrorState message="Could not load both recordings for the journey comparison." onRetry={() => { bRun.refetch(); cRun.refetch(); }} />}
      {d && mode === "journey" && jrows && (
        <>
          <div className={cn("mb-8 flex flex-col gap-4 rounded-2xl border p-6 md:flex-row md:items-center md:justify-between", jFirst ? "border-fail/30 bg-fail/5" : "border-ok/30 bg-ok/5")} data-testid="text-journey-divergence-summary">
            <div className="flex gap-4">
              <Flag className={cn("mt-1 h-5 w-5 shrink-0", jFirst ? "text-fail" : "text-ok")} />
              <div>
                <div className="font-display text-xl font-bold">{jFirst ? `First change: ${jFirst.label}` : "The customer journey matches the baseline"}</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {jFirst ? <>Baseline: <span className="font-semibold text-foreground">{jFirst.baseline?.outcome ?? "Not part of the journey"}</span>. This run: <span className="font-semibold text-foreground">{jFirst.current?.outcome ?? "Not part of the journey"}</span>.</> : "Every step ended the same way."}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{jrows.filter((r) => r.changed).length} of {jrows.length} steps ended differently. Select a step to see what happened.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href={`/runs/${d.baseline.id}`} className={btnGhost} data-testid="link-baseline-run">Baseline</Link>
              <Link href={`/runs/${d.current.id}`} className={btnGhost} data-testid="link-current-run">This run</Link>
            </div>
          </div>
          <div className="mb-3 hidden grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] gap-4 px-4 md:grid">
            <Eyebrow>baseline</Eyebrow><div /><Eyebrow>this run</Eyebrow>
          </div>
          <div className="space-y-2">
            {jrows.map((r, i) => {
              const first = r === jFirst;
              const sel = selectedStepId === r.id;
              return (
                <div key={r.id} data-testid={`step-compare-${r.id}`} data-step-id={r.id} data-changed={r.changed}
                  className={cn("rise min-w-0 rounded-2xl border transition", r.changed ? "border-warn/40 bg-warn/5" : "border-border bg-card", first && "border-fail/35 bg-fail/5", sel && "ring-2 ring-navy/70 ring-offset-2 ring-offset-paper")}
                  style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}>
                  <button type="button" className="w-full p-4 text-left" onClick={() => setSelectedStepId(sel ? null : r.id)} aria-expanded={sel} data-testid={`button-step-compare-${r.id}`}>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="font-display text-base font-bold">{r.label}</span>
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", sel && "rotate-180")} />
                    </div>
                    <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] md:items-center md:gap-4">
                      <div className="min-w-0"><span className="mb-1 block text-[10px] uppercase text-muted-foreground md:hidden">Baseline</span><Outcome s={r.baseline} side="baseline" /></div>
                      <div className="text-center">
                        <span className={cn("inline-block whitespace-nowrap rounded-full border border-current/15 px-2 py-1 font-mono text-[10px] font-semibold uppercase", first ? "text-fail" : r.changed ? "text-warn" : "text-ok")}>{first ? "first change" : r.changed ? "changed" : "same"}</span>
                      </div>
                      <div className="min-w-0"><span className="mb-1 block text-[10px] uppercase text-muted-foreground md:hidden">This run</span><Outcome s={r.current} side="this run" /></div>
                    </div>
                  </button>
                  {sel && (
                    <div className="grid gap-4 border-t border-border p-4 md:grid-cols-2">
                      <div><Eyebrow className="mb-2">Baseline</Eyebrow>{r.baseline ? <JourneyStepDetail step={r.baseline} /> : <p className="text-sm text-muted-foreground">Not part of the baseline.</p>}</div>
                      <div><Eyebrow className="mb-2">This run</Eyebrow>{r.current ? <JourneyStepDetail step={r.current} /> : <p className="text-sm text-muted-foreground">Not part of this run.</p>}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {d && mode === "developer" && (
        <>
          <div className={cn("mb-8 flex flex-col gap-4 rounded-2xl border p-6 md:flex-row md:items-center md:justify-between", firstRow ? "border-fail/30 bg-fail/5" : "border-ok/30 bg-ok/5")} data-testid="text-divergence-summary">
            <div className="flex gap-4">
              <Flag className={cn("mt-1 h-5 w-5 shrink-0", firstRow ? "text-fail" : "text-ok")} />
              <div>
                <div className="font-display text-xl font-bold">{firstRow ? `First divergence: ${firstRow.label}` : "No meaningful divergence"}</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {firstRow ? divergenceSummary(firstRow) : "Every aligned step matches the baseline."}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{d.changedCount} of {d.rows.length} steps differ. Expand a changed step below for details.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href={`/runs/${d.baseline.id}`} className={btnGhost} data-testid="link-baseline-run">Baseline</Link>
              <Link href={`/runs/${d.current.id}`} className={btnGhost} data-testid="link-current-run">This run</Link>
            </div>
          </div>

          <div className="mb-3 hidden grid-cols-[minmax(0,1fr)_90px_minmax(0,1fr)] gap-4 px-4 md:grid">
            <div className="flex items-center gap-2"><Eyebrow>baseline</Eyebrow><StatusPill status={d.baseline.status} /></div>
            <div />
            <div className="flex items-center gap-2"><Eyebrow>current</Eyebrow><StatusPill status={d.current.status} /></div>
          </div>
          <div className="space-y-2">
            {d.rows.map((r, i) => {
              const first = r.key === d.firstDivergence;
              const stepId = (r.current ?? r.baseline)?.stepId ?? null;
              const sel = !!stepId && stepId === selectedStepId;
              return (
                <div
                  key={r.key}
                  ref={first ? firstRef : undefined}
                  data-testid={`row-compare-${i}`}
                  data-step-id={stepId ?? ""}
                  onClick={() => stepId && setSelectedStepId(stepId)}
                  className={cn("rise min-w-0 rounded-2xl border p-4", CHANGE_STYLE[r.change], first && "ring-2 ring-fail/60 ring-offset-2 ring-offset-paper", sel && !first && "ring-2 ring-navy/60 ring-offset-2 ring-offset-paper")}
                  style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}
                >
                  <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_90px_minmax(0,1fr)] md:items-center md:gap-4">
                    <div className="min-w-0"><span className="mb-2 block text-[10px] uppercase text-muted-foreground md:hidden">Baseline</span><Cell e={r.baseline} side="baseline" /></div>
                    <div className="text-center" data-testid={`badge-compare-${i}`}>
                      <span className={cn("inline-block whitespace-nowrap rounded-full border border-current/15 px-2 py-1 font-mono text-[10px] font-semibold uppercase", CHANGE_TEXT[r.change])}>{first ? "first change" : r.change}</span>
                    </div>
                    <div className="min-w-0"><span className="mb-2 block text-[10px] uppercase text-muted-foreground md:hidden">This run</span><Cell e={r.current} side="current run" /></div>
                  </div>
                  {r.reasons.length > 0 && (
                    <details key={sel ? "sel" : "x"} open={sel || undefined} className="mt-4 min-w-0 border-t border-border pt-3" data-testid={`details-compare-${i}`}>
                      <summary className="cursor-pointer text-sm font-medium text-navy hover:underline">What changed · {r.reasons.length} {r.reasons.length === 1 ? "difference" : "differences"}</summary>
                      <ul className="mt-3 space-y-2 pl-4 text-sm leading-relaxed text-foreground/80">
                        {r.reasons.map((reason, ri) => <li key={ri} className="list-disc whitespace-pre-wrap [overflow-wrap:anywhere]">{readableReason(reason)}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
