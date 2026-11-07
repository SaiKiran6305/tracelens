import { Link } from "wouter";
import { ArrowUpRight, Anchor } from "lucide-react";
import type { Run } from "@workspace/api-client-react";
import { StatusPill } from "@/components/bits";
import { VARIANT_LABEL, ago, fmtMs } from "@/lib/trace";

export function RunRow({ run }: { run: Run }) {
  return (
    <Link
      href={`/runs/${run.id}`}
      data-testid={`row-run-${run.id}`}
      className="group grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border/70 px-5 py-4 transition-colors last:border-0 hover:bg-secondary/60 md:grid-cols-[minmax(0,2fr)_120px_100px_90px_110px_20px]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{run.name}</span>
          {run.isBaseline && (
            <span className="inline-flex items-center gap-1 rounded-md bg-ok/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ok">
              <Anchor className="h-3 w-3" /> baseline
            </span>
          )}
          {run.recorderError && (
            <span className="rounded-md bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-warn">recorder issue</span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {run.journeyName} · {VARIANT_LABEL[run.variant] ?? run.variant}
        </div>
      </div>
      <div className="md:order-none"><StatusPill status={run.status} /></div>
      <div className="hidden font-mono text-xs text-muted-foreground md:block">{run.eventCount} events</div>
      <div className="hidden font-mono text-xs text-muted-foreground md:block">{fmtMs(run.durationMs)}</div>
      <div className="hidden text-xs text-muted-foreground md:block">{ago(run.createdAt)}</div>
      <ArrowUpRight className="hidden h-4 w-4 text-foreground/30 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground md:block" />
    </Link>
  );
}
