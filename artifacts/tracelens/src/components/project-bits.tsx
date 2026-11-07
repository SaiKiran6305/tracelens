import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RealRunStatus } from "@/lib/project-api";

const RUN_TONE: Record<RealRunStatus, string> = {
  passed: "bg-ok/10 border-ok/25 text-ok",
  failed: "bg-fail/10 border-fail/30 text-fail",
  recording: "bg-navy/5 border-navy/15 text-navy",
  unknown: "bg-muted border-border text-muted-foreground",
  incomplete: "bg-warn/10 border-warn/30 text-warn",
};
const RUN_DOT: Record<RealRunStatus, string> = { passed: "bg-ok", failed: "bg-fail", recording: "bg-navy live-dot", unknown: "bg-muted-foreground/50", incomplete: "bg-warn" };
const RUN_HINT: Record<RealRunStatus, string> = {
  passed: "Every expected step reported its expected outcome.",
  failed: "At least one expected step reported a different outcome or failed.",
  recording: "Session is open; events are still arriving.",
  unknown: "Requests were seen, but the app did not report the expected outcome keys. A 2xx alone is not proof.",
  incomplete: "Recording was interrupted before the SDK finished conclusively.",
};

export function RunStatusPill({ status, className }: { status: string; className?: string }) {
  const s = (status in RUN_TONE ? status : "unknown") as RealRunStatus;
  return (
    <span title={RUN_HINT[s]} data-testid={`status-run-${s}`} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em]", RUN_TONE[s], className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", RUN_DOT[s])} />{s}
    </span>
  );
}
export const runStatusHint = (s: string) => RUN_HINT[(s in RUN_HINT ? s : "unknown") as RealRunStatus];

export function CodeBlock({ code, id, label }: { code: string; id: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative min-w-0">
      {label && <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>}
      <pre className="max-w-full overflow-x-auto rounded-2xl bg-navy p-5 pr-20 font-mono text-[12.5px] leading-relaxed text-paper/90" data-testid={`code-${id}`}>{code}</pre>
      <button
        type="button"
        aria-label="Copy to clipboard"
        data-testid={`button-copy-${id}`}
        onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
        className={cn("absolute right-3 inline-flex items-center gap-1 rounded-lg bg-paper/10 px-2 py-1 text-[11px] text-paper/80 transition hover:bg-paper/20", label ? "top-9" : "top-3")}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-xs text-fail" role="alert">{error}</span> : hint ? <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
