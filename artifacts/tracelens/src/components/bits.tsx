import type { ReactNode } from "react";
import { AlertTriangle, ArrowRightLeft, Cog, Globe, MousePointerClick, Navigation, RotateCw } from "lucide-react";
import type { RunStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/trace";

export const toneText: Record<Tone, string> = {
  ok: "text-ok",
  fail: "text-fail",
  warn: "text-warn",
  neutral: "text-muted-foreground",
  live: "text-navy",
};
export const toneBg: Record<Tone, string> = {
  ok: "bg-ok/10 border-ok/25",
  fail: "bg-fail/10 border-fail/30",
  warn: "bg-warn/10 border-warn/30",
  neutral: "bg-muted border-border",
  live: "bg-navy/5 border-navy/15",
};
export const toneDot: Record<Tone, string> = {
  ok: "bg-ok",
  fail: "bg-fail",
  warn: "bg-warn",
  neutral: "bg-muted-foreground/50",
  live: "bg-navy",
};

export function StatusPill({ status, className }: { status: RunStatus; className?: string }) {
  const tone: Tone = status === "passed" ? "ok" : status === "failed" ? "fail" : (status as string) === "unknown" || (status as string) === "incomplete" ? "warn" : "live";
  return (
    <span
      data-testid={`status-run-${status}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em]",
        toneBg[tone],
        toneText[tone],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", toneDot[tone], status === "recording" && "live-dot")} />
      {status}
    </span>
  );
}

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const c = cn("h-3.5 w-3.5", className);
  switch (kind) {
    case "click":
      return <MousePointerClick className={c} />;
    case "navigation":
      return <Navigation className={c} />;
    case "api":
      return <Globe className={c} />;
    case "internal":
      return <Cog className={c} />;
    case "recorder":
      return <AlertTriangle className={c} />;
    default:
      return <ArrowRightLeft className={c} />;
  }
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground", className)}>
      {children}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between rise">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-2 text-3xl md:text-[2.6rem] font-bold leading-[1.05] text-foreground">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-fail/30 bg-fail/5 p-8" data-testid="status-error">
      <div className="flex items-start gap-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fail/15 text-fail">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="font-display text-lg font-semibold">Could not load this evidence</div>
          <p className="mt-1 text-sm text-muted-foreground break-words">{message}</p>
          {onRetry && (
            <button
              data-testid="button-retry"
              onClick={onRetry}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-fail/40 bg-card px-3 py-1.5 text-sm font-medium text-fail transition hover:bg-fail hover:text-white active:scale-[.98]"
            >
              <RotateCw className="h-3.5 w-3.5" /> Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Skel({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-foreground/[0.06]", className)} />;
}

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-sm font-semibold text-paper shadow-[0_1px_0_hsl(0_0%_100%/.15)_inset,0_6px_16px_-8px_hsl(var(--navy)/.6)] transition-all hover:-translate-y-px hover:shadow-[0_1px_0_hsl(0_0%_100%/.15)_inset,0_10px_22px_-10px_hsl(var(--navy)/.7)] active:translate-y-0 active:scale-[.98] disabled:pointer-events-none disabled:opacity-45";
export const btnTeal =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-ok px-4 py-2.5 text-sm font-semibold text-paper shadow-[0_6px_16px_-8px_hsl(var(--ok)/.7)] transition-all hover:-translate-y-px hover:brightness-105 active:translate-y-0 active:scale-[.98] disabled:pointer-events-none disabled:opacity-45";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-all hover:border-foreground/25 hover:-translate-y-px active:translate-y-0 active:scale-[.98] disabled:pointer-events-none disabled:opacity-45";
export const inputCls =
  "w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-ok focus:ring-4 focus:ring-ok/15";
