import type { ReactNode } from "react";
import type { TraceEvent } from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { eventTone, fmtMs } from "@/lib/trace";
import type { JourneyStep } from "@/lib/journey";
import type { PresentationMode } from "@/hooks/use-presentation";
import { Eyebrow, KindIcon, toneBg, toneText } from "@/components/bits";
import { JourneyStepDetail, ModeToggle, StepBadge } from "@/components/presentation";

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 border-b border-border/70 py-2 text-sm last:border-0 sm:grid-cols-[110px_minmax(0,1fr)]">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground pt-0.5">{k}</span>
      <span className="min-w-0 break-all font-mono text-[12.5px] text-foreground">{children}</span>
    </div>
  );
}

function Json({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="mt-6 min-w-0">
      <Eyebrow>{title}</Eyebrow>
      {value == null || (typeof value === "object" && Object.keys(value as object).length === 0) ? (
        <p className="mt-2 text-sm text-muted-foreground">Not captured for this event.</p>
      ) : (
        <pre className="mt-2 max-h-72 max-w-full overflow-auto whitespace-pre-wrap rounded-xl bg-navy p-4 font-mono text-[12px] leading-relaxed text-paper/90 [overflow-wrap:anywhere]">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

function DeveloperBody({ event, events, onSelect }: { event: TraceEvent; events: TraceEvent[]; onSelect: (e: TraceEvent) => void }) {
  const parent = event.parentId ? events.find((e) => e.eventId === event.parentId) : undefined;
  const children = events.filter((e) => e.parentId === event.eventId);
  const tone = eventTone(event);
  return (
    <div data-step-id={event.stepId} data-testid={`detail-developer-${event.stepId}`}>
      <SheetHeader className="text-left">
        <div className={cn("inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.1em]", toneBg[tone], toneText[tone])}>
          <KindIcon kind={event.kind} /> {event.kind} · {event.source}
        </div>
        <SheetTitle className="font-display text-2xl leading-tight [overflow-wrap:anywhere]">{event.label}</SheetTitle>
        <SheetDescription>
          Event #{event.sequence} on step <span className="font-mono">{event.stepId}</span>. Inspect the request, response, and related events below.
        </SheetDescription>
      </SheetHeader>
      <div className="mt-6 rounded-xl border border-border bg-card px-4 py-1">
        {event.method && <Row k="request">{event.method} {event.path}</Row>}
        {event.status != null && <Row k="status"><span className={toneText[tone]}>{event.status}</span></Row>}
        <Row k="duration">{fmtMs(event.durationMs)}</Row>
        {event.attempt != null && <Row k="attempt">{event.attempt}</Row>}
        <Row k="action">{event.actionId}</Row>
        {event.traceId && <Row k="trace">{event.traceId}</Row>}
        <Row k="event id">{event.eventId}</Row>
        <Row k="recorded">{new Date(event.createdAt).toLocaleTimeString(undefined, { hour12: false })}.{String(new Date(event.createdAt).getMilliseconds()).padStart(3, "0")}</Row>
      </div>
      <div className="mt-6">
        <Eyebrow>Relationships</Eyebrow>
        <div className="mt-2 space-y-2">
          {parent ? (
            <button data-testid="button-parent-event" onClick={() => onSelect(parent)} className="w-full rounded-xl border border-border bg-card px-3 py-2 text-left text-sm transition hover:border-navy/40">
              <span className="font-mono text-[11px] text-muted-foreground">parent #{parent.sequence}</span>
              <div className="font-medium [overflow-wrap:anywhere]">{parent.label}</div>
            </button>
          ) : (
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{event.parentId ? `Parent ${event.parentId} was not persisted in this run.` : "Root event, no parent."}</p>
          )}
          {children.map((c) => (
            <button key={c.id} data-testid={`button-child-event-${c.sequence}`} onClick={() => onSelect(c)} className="w-full rounded-xl border border-dashed border-border bg-card/60 px-3 py-2 text-left text-sm transition hover:border-navy/40">
              <span className="font-mono text-[11px] text-muted-foreground">child #{c.sequence}{children.length > 1 ? " · sibling of " + (children.length - 1) : ""}</span>
              <div className="font-medium [overflow-wrap:anywhere]">{c.label}</div>
            </button>
          ))}
        </div>
      </div>
      <Json title="Request" value={event.request} />
      <Json title="Response" value={event.response} />
      <p className="mt-6 text-xs text-muted-foreground">Secret-looking fields are redacted by the recorder on a best-effort basis.</p>
    </div>
  );
}

/**
 * One drawer, two presentations of the same recording. Journey shows the logical step in plain
 * English; Developer shows the raw event. The toggle stays reachable inside the drawer.
 */
export function EvidenceDrawer({
  open,
  event,
  step,
  events,
  mode = "developer",
  onModeChange,
  onClose,
  onSelect,
}: {
  open?: boolean;
  event: TraceEvent | null;
  step?: JourneyStep | null;
  events: TraceEvent[];
  mode?: PresentationMode;
  onModeChange?: (m: PresentationMode) => void;
  onClose: () => void;
  onSelect: (e: TraceEvent) => void;
}) {
  const isOpen = open ?? !!event;
  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="!left-auto !right-0 box-border h-[100dvh] w-full max-w-[100vw] sm:w-[520px] overflow-y-auto overflow-x-hidden overscroll-contain border-l border-border bg-background sm:max-w-[520px]"
        data-testid="drawer-evidence"
        data-mode={mode}
        data-step-id={step?.id ?? event?.stepId ?? ""}
      >
        {onModeChange && (
          <div className="mb-5 pr-8">
            <ModeToggle mode={mode} setMode={onModeChange} size="sm" />
          </div>
        )}
        {mode === "journey" && step ? (
          <>
            <SheetHeader className="text-left">
              <StepBadge status={step.status} />
              <SheetTitle className="font-display text-2xl leading-tight" data-testid="text-drawer-step-label">{step.label}</SheetTitle>
              <SheetDescription>What the customer experienced at this step of the journey.</SheetDescription>
            </SheetHeader>
            <div className="mt-6"><JourneyStepDetail step={step} /></div>
          </>
        ) : event ? (
          <DeveloperBody event={event} events={events} onSelect={onSelect} />
        ) : step ? (
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-2xl">{step.label}</SheetTitle>
            <SheetDescription>No raw evidence was recorded for this step in this run.</SheetDescription>
          </SheetHeader>
        ) : (
          <SheetTitle className="sr-only">Evidence</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}
