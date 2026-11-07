import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Anchor, GitCompareArrows, Plus, Route as RouteIcon } from "lucide-react";
import {
  getGetSummaryQueryKey,
  getListJourneysQueryKey,
  useCreateJourney,
  useListJourneys,
  useListRuns,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ErrorState, PageHeader, Skel, btnGhost, btnPrimary, inputCls } from "@/components/bits";
import { RunRow } from "@/components/run-row";
import { ago, errMessage } from "@/lib/trace";

export default function Journeys() {
  const journeys = useListJourneys();
  const runs = useListRuns();
  const create = useCreateJourney();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) return setErr("Give the journey a name.");
    if (name.length > 100) return setErr("Keep the name under 100 characters.");
    setErr(null);
    create.mutate(
      { data: { name: name.trim(), description: desc.trim() || undefined } },
      {
        onSuccess: (j) => {
          qc.invalidateQueries({ queryKey: getListJourneysQueryKey() });
          qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
          toast({ title: "Journey saved", description: j.name });
          setOpen(false);
          setName("");
          setDesc("");
        },
        onError: (e) => setErr(errMessage(e)),
      },
    );
  };

  return (
    <div>
      <PageHeader eyebrow="Saved journeys" title="Journeys you can replay and compare">
        <button className={btnPrimary} onClick={() => setOpen(true)} data-testid="button-create-journey">
          <Plus className="h-4 w-4" /> New journey
        </button>
      </PageHeader>

      {(journeys.isLoading || runs.isLoading) && <div className="space-y-4"><Skel className="h-40" /><Skel className="h-40" /></div>}
      {journeys.isError && <ErrorState message={errMessage(journeys.error)} onRetry={() => journeys.refetch()} />}

      <div className="space-y-8">
        {journeys.data?.map((j, i) => {
          const jr = (runs.data ?? []).filter((r) => r.journeyId === j.id);
          const baseline = jr.find((r) => r.id === j.baselineId);
          const latest = jr.find((r) => r.id !== j.baselineId && r.status !== "recording");
          return (
            <section key={j.id} className="rise rounded-3xl border border-border bg-card" style={{ animationDelay: `${i * 0.05}s` }} data-testid={`card-journey-${j.id}`}>
              <div className="flex flex-col gap-4 p-6 md:flex-row md:items-start md:justify-between md:p-8">
                <div className="flex gap-4">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-navy text-paper"><RouteIcon className="h-5 w-5" /></div>
                  <div>
                    <h2 className="text-xl font-bold">{j.name}</h2>
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">{j.description || "No description."}</p>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-muted-foreground">
                      <span>{j.runCount} runs</span>
                      <span>created {ago(j.createdAt)}</span>
                      <span className={baseline ? "text-ok" : ""}>{baseline ? `baseline: ${baseline.name}` : "no baseline yet"}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {/checkout/i.test(j.name) && <Link href="/demo" className={btnGhost} data-testid={`link-record-${j.id}`}>Record in sandbox</Link>}
                  {baseline && latest && (
                    <Link href={`/compare?baseline=${baseline.id}&run=${latest.id}`} className={btnPrimary} data-testid={`link-compare-${j.id}`}>
                      <GitCompareArrows className="h-4 w-4" /> Compare latest
                    </Link>
                  )}
                </div>
              </div>
              {jr.length === 0 ? (
                <div className="border-t border-border px-8 py-8 text-sm text-muted-foreground">
                  No runs yet. {/checkout/i.test(j.name) ? "Record one in the checkout sandbox." : <>Start one from your app with the SDK, see <Link href="/setup" className="text-navy underline">Setup</Link>.</>}
                </div>
              ) : (
                <div className="border-t border-border">{jr.map((r) => <RunRow key={r.id} run={r} />)}</div>
              )}
              {!baseline && jr.some((r) => r.status === "passed") && (
                <div className="flex items-center gap-2 border-t border-border bg-ok/5 px-8 py-3 text-xs text-ok">
                  <Anchor className="h-3.5 w-3.5" /> Open a passed run to mark it as the trusted baseline.
                </div>
              )}
            </section>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-background sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">New journey</DialogTitle>
            <DialogDescription>A named user path you will record from your own app, like "Invite teammate".</DialogDescription>
          </DialogHeader>
          <form className="mt-2 space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Name</span>
              <input data-testid="input-journey-name" className={inputCls} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Invite teammate" autoFocus />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">What it covers <span className="text-muted-foreground">(optional)</span></span>
              <textarea data-testid="input-journey-description" className={inputCls + " min-h-[90px] resize-none"} value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} placeholder="From the team page to the accepted invite email." />
            </label>
            {err && <p className="text-sm text-fail" data-testid="text-journey-error">{err}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className={btnGhost} onClick={() => setOpen(false)} data-testid="button-cancel-journey">Cancel</button>
              <button type="submit" className={btnPrimary} disabled={create.isPending} data-testid="button-save-journey">{create.isPending ? "Saving..." : "Save journey"}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
