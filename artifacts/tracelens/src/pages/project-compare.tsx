import { useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { ArrowLeft, ArrowRight, ChevronDown, Code2, Download, Flag, GitCompareArrows } from "lucide-react";
import type { TraceEvent } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { ErrorState, Eyebrow, KindIcon, Skel, btnGhost, btnPrimary, inputCls } from "@/components/bits";
import { JourneyStepDetail, ModeToggle, StepBadge } from "@/components/presentation";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { RunStatusPill } from "@/components/project-bits";
import { compareJourneySteps, type JourneyStep } from "@/lib/journey";
import { projectRealJourney } from "@/lib/real-journey";
import { usePresentation } from "@/hooks/use-presentation";
import { saveBlob, useProject, useProjectCompare, useProjectRun } from "@/lib/project-api";
import { displayPath, errMessage, eventTone, fmtMs, readableReason } from "@/lib/trace";

const CHANGE_STYLE: Record<string, string> = { unchanged: "border-border bg-card", changed: "border-warn/40 bg-warn/5", missing: "border-fail/35 bg-fail/5", extra: "border-warn/40 bg-warn/5" };
const CHANGE_TEXT: Record<string, string> = { unchanged: "text-ok", changed: "text-warn", missing: "text-fail", extra: "text-warn" };

function Cell({ e, side, onOpen }: { e: TraceEvent | null; side: string; onOpen: (e: TraceEvent) => void }) {
  if (!e) return <div className="rounded-xl border border-dashed border-border/80 px-3 py-3 font-mono text-[11px] text-muted-foreground">not observed in {side}</div>;
  const tone = eventTone(e);
  return (
    <button type="button" onClick={(ev) => { ev.stopPropagation(); onOpen(e); }} className="block w-full min-w-0 rounded-xl px-2 py-1 text-left hover:bg-navy/[0.04] focus-visible:outline-2 focus-visible:outline-navy" aria-label={`Open evidence for ${e.label} in ${side}`}>
      <div className="flex items-center gap-2 text-sm font-medium"><KindIcon kind={e.kind} className="text-muted-foreground" /> <span className="truncate">{e.label}</span></div>
      <div className="mt-1 flex flex-wrap gap-x-2 font-mono text-[11px] text-muted-foreground">
        {e.method && <span className="break-all">{e.method} {displayPath(e.path)}</span>}
        {e.status != null && <span className={tone === "fail" ? "font-semibold text-fail" : tone === "ok" ? "text-ok" : ""}>{e.status}</span>}
        {e.durationMs != null && <span>{fmtMs(e.durationMs)}</span>}
      </div>
    </button>
  );
}

function Outcome({ s, side }: { s: JourneyStep | null; side: string }) {
  if (!s) return <div className="rounded-xl border border-dashed border-border/80 px-3 py-3 text-sm text-muted-foreground">Not part of the {side}</div>;
  return <div className="min-w-0 px-1"><StepBadge status={s.status} /><div className="mt-1.5 font-display text-lg font-bold leading-tight [overflow-wrap:anywhere]">{s.outcome}</div></div>;
}

export default function ProjectComparePage() {
  const { id = "" } = useParams<{ id: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const baselineId = params.get("baseline") ?? "";
  const runId = params.get("run") ?? "";
  const proj = useProject(id, 0, 100);
  const runs = useMemo(() => (proj.data?.runs ?? []).filter((r) => r.status !== "recording"), [proj.data]);
  const passed = runs.filter((r) => r.status === "passed");
  const cmp = useProjectCompare(id, baselineId, runId);
  const enabled = !!baselineId && !!runId && baselineId !== runId;
  const bRun = useProjectRun(enabled ? id : "", baselineId);
  const cRun = useProjectRun(enabled ? id : "", runId);
  const [mode, setMode] = usePresentation();
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ event: TraceEvent; events: TraceEvent[] } | null>(null);

  const jrows = useMemo(() => {
    if (!bRun.data || !cRun.data) return null;
    return compareJourneySteps(
      projectRealJourney(bRun.data.events, bRun.data.run.status, cmp.data?.baselineSteps ?? bRun.data.steps),
      projectRealJourney(cRun.data.events, cRun.data.run.status, cmp.data?.currentSteps ?? cRun.data.steps),
    );
  }, [bRun.data, cRun.data, cmp.data]);
  const jFirst = jrows?.find((r) => r.changed);
  const update = (b: string, r: string) => setLocation(`/projects/${id}/compare?baseline=${encodeURIComponent(b)}&run=${encodeURIComponent(r)}`, { replace: true });
  const d = cmp.data;
  const firstRow = d?.rows.find((r) => r.key === d.firstDivergence);
  const download = () => d && saveBlob(new Blob([d.markdown], { type: "text/markdown" }), `tracelens-${d.current.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-vs-baseline.md`);
  const expectedChanges = useMemo(() => {
    if (!d) return [];
    const a = new Map(d.baselineSteps.map((s) => [s.id, s])), b = new Map(d.currentSteps.map((s) => [s.id, s]));
    const out: string[] = [];
    a.forEach((s, k) => { const c = b.get(k); if (!c) out.push(`"${s.label}" was expected in the baseline but not in this run.`); else if (c.outcome !== s.outcome) out.push(`"${s.label}" expected outcome changed: ${s.outcome} → ${c.outcome}.`); });
    b.forEach((s, k) => { if (!a.has(k)) out.push(`"${s.label}" is newly expected in this run.`); });
    return out;
  }, [d]);

  return (
    <div>
      <Link href={`/projects/${id}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> {proj.data?.project.name ?? "Project"}</Link>
      <div className="rise mb-8 mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div><Eyebrow>Aligned comparison</Eyebrow><h1 className="mt-2 font-display text-3xl font-bold leading-[1.05] md:text-[2.6rem]">Where did this run stop matching?</h1></div>
        <div className="flex flex-wrap gap-2">
          <ModeToggle mode={mode} setMode={setMode} />
          {d && mode === "developer" && <button className={btnPrimary} onClick={download} data-testid="button-download-markdown"><Download className="h-4 w-4" /> Markdown</button>}
          {d && mode === "journey" && <button className={btnGhost} onClick={() => setMode("developer")}><Code2 className="h-4 w-4" /> Export in Developer view</button>}
        </div>
      </div>

      <div className="mb-8 grid gap-4 rounded-2xl border border-border bg-card p-5 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-end">
        <label className="block"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ok">Trusted baseline</span>
          <select className={inputCls} value={baselineId} onChange={(e) => update(e.target.value, runId)} data-testid="select-baseline">
            <option value="">Choose a passed run</option>
            {passed.map((r) => <option key={r.id} value={r.id}>{r.id === proj.data?.project.baselineId ? "[baseline] " : ""}{r.name}</option>)}
          </select>
        </label>
        <ArrowRight className="mx-auto hidden h-5 w-5 text-muted-foreground md:mb-3 md:block" />
        <label className="block"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-navy">Run under inspection</span>
          <select className={inputCls} value={runId} onChange={(e) => update(baselineId, e.target.value)} data-testid="select-run">
            <option value="">Choose a finished run</option>
            {runs.filter((r) => r.id !== baselineId).map((r) => <option key={r.id} value={r.id}>{r.name} · {r.status}</option>)}
          </select>
        </label>
      </div>

      {proj.isLoading && <Skel className="h-48" />}
      {proj.data && passed.length === 0 && (
        <div className="rounded-3xl border border-dashed border-navy/25 bg-card/70 p-10 text-center" data-testid="empty-compare">
          <GitCompareArrows className="mx-auto h-8 w-8 text-navy/50" />
          <h2 className="mt-4 font-display text-2xl font-bold">You need a passed run first</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">Only runs where every expected step reported its expected outcome can be a baseline.</p>
        </div>
      )}
      {!enabled && passed.length > 0 && <p className="text-sm text-muted-foreground">Pick two different runs to align their evidence.</p>}
      {enabled && cmp.isLoading && <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-16" />)}</div>}
      {enabled && cmp.isError && <ErrorState message={errMessage(cmp.error)} onRetry={() => cmp.refetch()} />}

      {d && expectedChanges.length > 0 && (
        <div className="mb-6 rounded-2xl border border-warn/35 bg-warn/5 p-4 text-sm" data-testid="expected-step-changes">
          <div className="font-semibold text-warn">Expected steps differ between these runs</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{expectedChanges.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}

      {d && mode === "journey" && (bRun.isLoading || cRun.isLoading) && <div className="space-y-3">{[0, 1, 2].map((i) => <Skel key={i} className="h-20" />)}</div>}
      {d && mode === "journey" && (bRun.isError || cRun.isError) && <ErrorState message="Could not load both recordings." onRetry={() => { bRun.refetch(); cRun.refetch(); }} />}
      {d && mode === "journey" && jrows && (
        <>
          <div className={cn("mb-6 flex gap-4 rounded-2xl border p-6", jFirst ? "border-fail/30 bg-fail/5" : "border-ok/30 bg-ok/5")} data-testid="text-journey-divergence-summary">
            <Flag className={cn("mt-1 h-5 w-5 shrink-0", jFirst ? "text-fail" : "text-ok")} />
            <div>
              <div className="font-display text-xl font-bold">{jFirst ? `First change: ${jFirst.label}` : "The journey matches the baseline"}</div>
              <p className="mt-1 text-sm text-muted-foreground">{jFirst ? <>Baseline: <b className="text-foreground">{jFirst.baseline?.outcome ?? "Not part of the journey"}</b>. This run: <b className="text-foreground">{jFirst.current?.outcome ?? "Not part of the journey"}</b>.</> : "Every step ended the same way."}</p>
            </div>
          </div>
          <div className="space-y-2">
            {jrows.map((r) => {
              const sel = selectedStepId === r.id;
              return (
                <div key={r.id} data-step-id={r.id} className={cn("rounded-2xl border", r.changed ? "border-warn/40 bg-warn/5" : "border-border bg-card", r === jFirst && "border-fail/35 bg-fail/5", sel && "ring-2 ring-navy/70 ring-offset-2 ring-offset-paper")}>
                  <button type="button" className="w-full p-4 text-left" onClick={() => setSelectedStepId(sel ? null : r.id)} aria-expanded={sel}>
                    <div className="mb-3 flex items-center justify-between gap-2"><span className="font-display text-base font-bold">{r.label}</span><ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", sel && "rotate-180")} /></div>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] md:items-center">
                      <Outcome s={r.baseline} side="baseline" />
                      <div className="text-center"><span className={cn("inline-block whitespace-nowrap rounded-full border border-current/15 px-2 py-1 font-mono text-[10px] font-semibold uppercase", r === jFirst ? "text-fail" : r.changed ? "text-warn" : "text-ok")}>{r === jFirst ? "first change" : r.changed ? "changed" : "same"}</span></div>
                      <Outcome s={r.current} side="this run" />
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
          <div className={cn("mb-6 flex gap-4 rounded-2xl border p-6", firstRow ? "border-fail/30 bg-fail/5" : "border-ok/30 bg-ok/5")} data-testid="text-divergence-summary">
            <Flag className={cn("mt-1 h-5 w-5 shrink-0", firstRow ? "text-fail" : "text-ok")} />
            <div>
              <div className="font-display text-xl font-bold">{firstRow ? `First divergence: ${firstRow.label}` : "No meaningful divergence"}</div>
              <p className="mt-1 text-sm text-muted-foreground">{d.changedCount} of {d.rows.length} aligned steps differ. Select a cell to open its raw evidence.</p>
            </div>
          </div>
          <div className="mb-3 hidden grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] gap-4 px-4 md:grid">
            <div className="flex items-center gap-2"><Eyebrow>baseline</Eyebrow><RunStatusPill status={d.baseline.status} /></div><div />
            <div className="flex items-center gap-2"><Eyebrow>current</Eyebrow><RunStatusPill status={d.current.status} /></div>
          </div>
          <div className="space-y-2">
            {d.rows.map((r, i) => {
              const first = r.key === d.firstDivergence;
              const stepId = (r.current ?? r.baseline)?.stepId ?? null;
              const sel = !!stepId && stepId === selectedStepId;
              return (
                <div key={r.key} data-step-id={stepId ?? ""} onClick={() => stepId && setSelectedStepId(stepId)} className={cn("min-w-0 rounded-2xl border p-4", CHANGE_STYLE[r.change], first && "ring-2 ring-fail/60 ring-offset-2 ring-offset-paper", sel && !first && "ring-2 ring-navy/60 ring-offset-2 ring-offset-paper")}>
                  <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] md:items-center">
                    <Cell e={r.baseline} side="baseline" onOpen={(e) => setDrawer({ event: e, events: bRun.data?.events ?? [e] })} />
                    <div className="text-center" data-testid={`badge-compare-${i}`}><span className={cn("inline-block whitespace-nowrap rounded-full border border-current/15 px-2 py-1 font-mono text-[10px] font-semibold uppercase", CHANGE_TEXT[r.change])}>{first ? "first change" : r.change}</span></div>
                    <Cell e={r.current} side="current run" onOpen={(e) => setDrawer({ event: e, events: cRun.data?.events ?? [e] })} />
                  </div>
                  {r.reasons.length > 0 && (
                    <details key={sel ? "s" : "x"} open={sel || undefined} className="mt-4 border-t border-border pt-3">
                      <summary className="cursor-pointer text-sm font-medium text-navy hover:underline">What changed · {r.reasons.length} {r.reasons.length === 1 ? "difference" : "differences"}</summary>
                      <ul className="mt-3 space-y-2 pl-4 text-sm leading-relaxed text-foreground/80">{r.reasons.map((x, ri) => <li key={ri} className="list-disc whitespace-pre-wrap [overflow-wrap:anywhere]">{readableReason(x)}</li>)}</ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <EvidenceDrawer open={!!drawer} event={drawer?.event ?? null} events={drawer?.events ?? []} mode="developer" onClose={() => setDrawer(null)} onSelect={(e) => setDrawer((d0) => d0 && { ...d0, event: e })} />
    </div>
  );
}
