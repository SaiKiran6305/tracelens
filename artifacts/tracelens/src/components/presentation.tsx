import { Fragment } from "react";
import { CircleCheck, CircleDashed, CircleX, Code2, Footprints, History, Loader2, Eye } from "lucide-react";
import type { TraceEvent } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import type { JourneyStep, StepStatus } from "@/lib/journey";
import type { PresentationMode } from "@/hooks/use-presentation";

export const STEP_META: Record<StepStatus, { label: string; cls: string; dot: string; Icon: typeof CircleCheck }> = {
  passed: { label: "Passed", cls: "border-ok/30 bg-ok/[0.06] text-ok", dot: "bg-ok", Icon: CircleCheck },
  failed: { label: "Failed", cls: "border-fail/35 bg-fail/[0.06] text-fail", dot: "bg-fail", Icon: CircleX },
  recovered: { label: "Recovered", cls: "border-warn/40 bg-warn/[0.07] text-warn", dot: "bg-warn", Icon: History },
  not_reached: { label: "Not reached", cls: "border-dashed border-border bg-card/50 text-muted-foreground", dot: "bg-muted-foreground/40", Icon: CircleDashed },
  pending: { label: "Waiting", cls: "border-navy/20 bg-navy/[0.03] text-navy", dot: "bg-navy/50", Icon: Loader2 },
  unknown: { label: "Outcome unverified", cls: "border-dashed border-warn/40 bg-warn/[0.04] text-warn", dot: "bg-warn/60", Icon: CircleDashed },
  observed: { label: "Observed", cls: "border-border bg-card text-navy", dot: "bg-navy/40", Icon: Eye },
};

/** The raw event that best represents a logical step when switching into Developer view. */
export function primaryEvent(step: JourneyStep | null | undefined): TraceEvent | null {
  if (!step || !step.events.length) return null;
  const apis = step.events.filter((e) => e.kind === "api");
  const failing = [...apis].reverse().find((e) => e.status != null && (e.status >= 400 || e.status === 0));
  return (step.status === "failed" ? failing : undefined) ?? apis.at(-1) ?? step.events[0];
}

export function ModeToggle({ mode, setMode, className, size = "md" }: { mode: PresentationMode; setMode: (m: PresentationMode) => void; className?: string; size?: "sm" | "md" }) {
  const opts = [
    { v: "journey" as const, label: "Journey view", Icon: Footprints },
    { v: "developer" as const, label: "Developer view", Icon: Code2 },
  ];
  return (
    <div role="group" aria-label="Presentation" className={cn("inline-flex shrink-0 rounded-full border border-navy/15 bg-paper p-1 shadow-[inset_0_1px_2px_hsl(var(--navy)/.08)]", className)} data-testid="toggle-presentation">
      {opts.map(({ v, label, Icon }) => (
        <button
          key={v}
          type="button"
          aria-pressed={mode === v}
          onClick={() => setMode(v)}
          data-testid={`button-mode-${v}`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full font-medium transition-all",
            size === "sm" ? "px-3 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
            mode === v ? "bg-navy text-paper shadow-[0_6px_14px_-8px_hsl(var(--navy)/.9)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

export function StepBadge({ status }: { status: StepStatus }) {
  const m = STEP_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", m.cls)}>
      <m.Icon className={cn("h-3 w-3", status === "pending" && "animate-spin")} /> {m.label}
    </span>
  );
}

function StepCard({ step, index, selected, onSelect }: { step: JourneyStep; index: number; selected: boolean; onSelect: (s: JourneyStep) => void }) {
  const m = STEP_META[step.status];
  return (
    <button
      type="button"
      onClick={() => onSelect(step)}
      data-testid={`step-journey-${step.id}`}
      data-step-id={step.id}
      data-step-status={step.status}
      aria-pressed={selected}
      className={cn(
        "group w-full min-w-0 rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5",
        m.cls,
        "text-foreground",
        selected && "ring-2 ring-navy/70 ring-offset-2 ring-offset-paper",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Step {index + 1}</span>
        <StepBadge status={step.status} />
      </div>
      <div className="mt-2 font-display text-lg font-bold leading-tight">{step.label}</div>
      <div className={cn("mt-1 text-sm font-medium [overflow-wrap:anywhere]", m.cls.split(" ").find((c) => c.startsWith("text-")))} data-testid={`text-step-outcome-${step.id}`}>{step.outcome}</div>
      {step.status === "recovered" && (
        <div className="mt-2 flex gap-1" aria-label="Attempts">
          {step.attempts.map((a, i) => <span key={i} className={cn("h-1.5 w-5 rounded-full", a.status === "passed" ? "bg-ok" : "bg-fail")} />)}
        </div>
      )}
    </button>
  );
}

/** Logical steps in order; steps that genuinely overlapped are stacked together. */
export function JourneyTimeline({ steps, selectedStepId, onSelect, compact }: { steps: JourneyStep[]; selectedStepId: string | null; onSelect: (s: JourneyStep) => void; compact?: boolean }) {
  const cols: JourneyStep[][] = [];
  steps.forEach((s) => {
    const last = cols.at(-1);
    if (last && s.parallelGroup && last[0].parallelGroup === s.parallelGroup) last.push(s);
    else cols.push([s]);
  });
  let n = 0;
  return (
    <div className={cn("grid-paper rounded-2xl border border-border bg-card/60", compact ? "p-3" : "p-4 md:p-6")} data-testid="timeline-journey">
      <div className={cn("flex flex-col gap-3", !compact && "md:flex-row md:items-stretch")}>
        {cols.map((col, ci) => (
          <Fragment key={ci}>
            {ci > 0 && <div className={cn("mx-auto h-4 w-px bg-navy/20", !compact && "md:my-auto md:h-px md:w-5 md:shrink-0")} />}
            <div className={cn("min-w-0 flex-1", col.length > 1 && "rounded-2xl border border-dashed border-ok/40 bg-ok/[0.04] p-2")} data-testid={col.length > 1 ? `group-parallel-${col[0].parallelGroup}` : undefined}>
              {col.length > 1 && <div className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ok">Happened together</div>}
              <div className="space-y-2">
                {col.map((s) => <StepCard key={s.id} step={s} index={n++} selected={selectedStepId === s.id} onSelect={onSelect} />)}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** Plain-English detail of a logical step. No paths, codes, ids, payloads or timings. */
export function JourneyStepDetail({ step }: { step: JourneyStep }) {
  return (
    <div data-testid={`detail-journey-${step.id}`} data-step-id={step.id}>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Outcome</div>
        <div className="mt-1 font-display text-xl font-bold [overflow-wrap:anywhere]" data-testid="text-journey-outcome">{step.outcome}</div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]" data-testid="text-journey-explanation">{step.explanation}</p>
        {step.parallelGroup && <p className="mt-3 text-sm text-ok">This step ran at the same time as another step.</p>}
      </div>
      {step.attempts.length > 0 && (
        <div className="mt-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Attempts</div>
          <ol className="mt-2 space-y-2">
            {step.attempts.map((a, i) => (
              <li key={i} className={cn("flex gap-3 rounded-xl border p-3 text-sm", a.status === "passed" ? "border-ok/30 bg-ok/5" : "border-fail/30 bg-fail/5")} data-testid={`attempt-journey-${step.id}-${i + 1}`}>
                {a.status === "passed" ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-fail" />}
                <div className="min-w-0">
                  <div className="font-semibold">Attempt {i + 1}: {a.status === "passed" ? "succeeded" : "did not succeed"}</div>
                  <div className="text-muted-foreground [overflow-wrap:anywhere]">{a.explanation}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="mt-6 text-xs text-muted-foreground">Switch to Developer view to inspect the recorded requests and responses behind this step.</p>
    </div>
  );
}
