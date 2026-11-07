import { useMemo } from "react";
import { motion } from "framer-motion";
import { ChevronRight, CornerDownRight, Split } from "lucide-react";
import type { TraceEvent } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { buildColumns, displayPath, eventTone, fmtMs } from "@/lib/trace";
import { KindIcon, toneBg, toneDot, toneText } from "@/components/bits";

export function FlowGraph({
  events,
  selectedId,
  onSelect,
  live,
}: {
  events: TraceEvent[];
  selectedId?: string | null;
  onSelect: (e: TraceEvent) => void;
  live?: boolean;
}) {
  const cols = useMemo(() => buildColumns(events), [events]);
  const byEventId = useMemo(() => new Map(events.map((e) => [e.eventId, e])), [events]);

  return (
    <div className="grid-paper overflow-x-auto rounded-2xl border border-border bg-card/60 p-6" data-testid="graph-flow">
      <div className="flex min-w-max items-stretch gap-0">
        {cols.map((col, ci) => (
          <div key={ci} className="flex items-stretch">
            {ci > 0 && (
              <div className="flex w-12 items-center justify-center">
                <svg width="48" height="12" className="text-foreground/30">
                  <line x1="2" y1="6" x2="40" y2="6" stroke="currentColor" strokeWidth="1.5" className={live ? "flow-dash" : ""} />
                  <path d="M38 2l6 4-6 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </div>
            )}
            <div className={cn("flex flex-col gap-3", col.length > 1 && "rounded-2xl border border-dashed border-navy/25 bg-navy/[0.03] p-3")}>
              {col.length > 1 && (
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-navy/70">
                  <Split className="h-3 w-3" /> parallel · overlapping timings
                </div>
              )}
              {col.map((lane) => (
                <div key={lane.stepId} className="w-[260px]" data-testid={`lane-${lane.stepId}`}>
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/70">{lane.stepId}</span>
                    {lane.timed && <span className="font-mono text-[10px] text-muted-foreground">{fmtMs(lane.end - lane.start)}</span>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {lane.events.map(({ event: e, depth }) => {
                      const tone = eventTone(e);
                      const parent = e.parentId ? byEventId.get(e.parentId) : undefined;
                      const crossLane = parent && parent.stepId !== e.stepId;
                      return (
                        <motion.button
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                          key={e.id}
                          onClick={() => onSelect(e)}
                          data-testid={`node-event-${e.sequence}`}
                          style={{ marginLeft: depth * 14 }}
                          className={cn(
                            "group relative rounded-xl border px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:shadow-[0_8px_20px_-14px_hsl(var(--navy)/.5)]",
                            toneBg[tone],
                            selectedId === e.id && "ring-2 ring-navy/70 ring-offset-2 ring-offset-paper",
                          )}
                        >
                          {depth > 0 && <CornerDownRight className="absolute -left-3.5 top-3 h-3 w-3 text-foreground/30" />}
                          <div className="flex items-center gap-2">
                            <span className={cn("grid h-5 w-5 place-items-center rounded-md bg-card/80", toneText[tone])}>
                              <KindIcon kind={e.kind} className="h-3 w-3" />
                            </span>
                            <span className="truncate text-[13px] font-medium text-foreground">{e.label}</span>
                            <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-foreground/25 transition group-hover:translate-x-0.5 group-hover:text-foreground/60" />
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
                            <span>#{e.sequence}</span>
                            {e.method && <span className="break-all text-foreground/70">{e.method} {displayPath(e.path)}</span>}
                            {e.status != null && (
                              <span className={cn("inline-flex items-center gap-1 font-semibold", toneText[tone])}>
                                <span className={cn("h-1.5 w-1.5 rounded-full", toneDot[tone])} />
                                {e.status}
                              </span>
                            )}
                            {e.durationMs != null && <span>{fmtMs(e.durationMs)}</span>}
                            {e.attempt != null && e.attempt > 1 && <span className="text-warn font-semibold">attempt {e.attempt}</span>}
                            {crossLane && <span className="text-navy/60">from {parent.stepId}#{parent.sequence}</span>}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {live && (
          <div className="flex items-center pl-6">
            <div className="flex items-center gap-2 rounded-full border border-navy/15 bg-card px-3 py-1.5 font-mono text-[11px] text-navy/70">
              <span className="live-dot h-2 w-2 rounded-full bg-ok" /> listening for evidence
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
