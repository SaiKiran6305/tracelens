import { useMemo, useRef, useState, type RefObject } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowUpRight, Check, CirclePlay, Loader2, Package, RotateCw, ShieldAlert, Square, Truck, XOctagon } from "lucide-react";
import {
  getGetRunQueryKey,
  getGetSummaryQueryKey,
  getListJourneysQueryKey,
  getListRunsQueryKey,
  useCreateRun,
  useExecuteDemoStep,
  useFinishRun,
  useGetRun,
  useIngestEvent,
  useListJourneys,
  useListRuns,
  type EventInput,
  type RunInputVariant,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ErrorState, Eyebrow, KindIcon, Skel, StatusPill, btnGhost, btnPrimary, btnTeal, inputCls, toneText } from "@/components/bits";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { JourneyTimeline, ModeToggle, primaryEvent } from "@/components/presentation";
import { projectJourney, type JourneyStep } from "@/lib/journey";
import { usePresentation } from "@/hooks/use-presentation";
import { VARIANT_LABEL, displayPath, errMessage, errStatus, eventTone, fmtMs, newId } from "@/lib/trace";

type Step = "cart" | "shipping" | "inventory" | "checkout";
type StepState = { ok: boolean; message: string };
const MAX_CHECKOUT_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const VARIANTS: { v: Exclude<RunInputVariant, "external">; title: string; desc: string; tone: string }[] = [
  { v: "working", title: "Working path", desc: "Everything should succeed. Good baseline material.", tone: "bg-ok" },
  { v: "missing_address", title: "Missing address", desc: "Checkout is sent with an empty address and gets a 422.", tone: "bg-fail" },
  { v: "transient", title: "Transient 503", desc: "First checkout attempt fails; one bounded retry after ~500 ms.", tone: "bg-warn" },
];

const PRODUCT = { name: "TraceLens field notebook", sku: "TL-NOTEBOOK", price: 24, desc: "A notebook for your next good idea. One synthetic product, a real recorded checkout." };

export default function Demo() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const runId = new URLSearchParams(search).get("run") ?? "";
  const qc = useQueryClient();
  const { toast } = useToast();

  const journeys = useListJourneys();
  const runs = useListRuns({ query: { queryKey: getListRunsQueryKey(), refetchInterval: 4000 } });
  const detail = useGetRun(runId, {
    query: {
      enabled: !!runId,
      queryKey: getGetRunQueryKey(runId),
      refetchInterval: (q) => (q.state.data?.run.status === "recording" ? 1000 : false),
    },
  });
  const createRun = useCreateRun();
  const ingest = useIngestEvent();
  const exec = useExecuteDemoStep();
  const finish = useFinishRun();

  const [variant, setVariant] = useState<Exclude<RunInputVariant, "external">>("working");
  const [address, setAddress] = useState("14 Larkspur Row, Unit 3, Portland OR 97214");
  const [local, setLocal] = useState<{ runId: string; steps: Partial<Record<Step, StepState>>; recorder: string | null }>({ runId: "", steps: {}, recorder: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);

  const runIdRef = useRef(runId);
  runIdRef.current = runIdRef.current && !runId ? runIdRef.current : runId || runIdRef.current;
  const variantRef = useRef<string>(variant);
  const inflight = useRef<Promise<boolean> | null>(null);
  const attemptsRef = useRef<{ runId: string; n: number }>({ runId: "", n: 0 });
  const cartBtn = useRef<HTMLButtonElement>(null);
  const continueBtn = useRef<HTMLButtonElement>(null);
  const placeBtn = useRef<HTMLButtonElement>(null);

  const checkoutJourney = journeys.data?.find((j) => /checkout/i.test(j.name)) ?? journeys.data?.[0];
  const run = detail.data?.run;
  if (run && run.id === runIdRef.current) variantRef.current = run.variant;
  const events = useMemo(() => detail.data?.events ?? [], [detail.data]);
  const [mode, setMode] = usePresentation();
  const journeySteps = useMemo(() => (run ? projectJourney(events, run) : []), [events, run]);
  const [sel, setSel] = useState<{ runId: string; stepId: string | null; eventId: string | null; open: boolean }>({ runId: "", stepId: null, eventId: null, open: false });
  const selCur = sel.runId === runId ? sel : { runId, stepId: null, eventId: null, open: false };
  const selStep = journeySteps.find((s) => s.id === selCur.stepId) ?? null;
  const selEvent = events.find((e) => e.id === selCur.eventId) ?? primaryEvent(selStep);
  const pickStep = (s: JourneyStep) => setSel({ runId, stepId: s.id, eventId: primaryEvent(s)?.id ?? null, open: true });
  const pickEvent = (id: string) => {
    const e = events.find((x) => x.id === id);
    setSel({ runId, stepId: e?.stepId ?? null, eventId: id, open: true });
  };
  const steps = local.runId === runId ? local.steps : {};
  const recorderLocal = local.runId === runId ? local.recorder : null;

  const serverOk = (s: Step) => events.some((e) => e.kind === "api" && e.stepId === s && e.status != null && e.status < 400);
  const done = (s: Step) => serverOk(s) || !!steps[s]?.ok;
  const checkoutApi = events.filter((e) => e.kind === "api" && e.stepId === "checkout");
  const attempts = Math.max(checkoutApi.length, attemptsRef.current.runId === runId ? attemptsRef.current.n : 0);
  const lastCheckoutFail = !done("checkout") && (steps.checkout?.ok === false || checkoutApi.some((e) => (e.status ?? 0) >= 400));
  const view: "idle" | "cart" | "checkout" | "confirmation" = !runId ? "idle" : !done("cart") ? "cart" : !done("checkout") ? "checkout" : "confirmation";
  const otherActive = runs.data?.find((r) => r.status === "recording" && r.id !== runId && r.variant !== "external");
  const recording = run?.status === "recording";
  const blocked = !!otherActive || recording || replaying;

  const refresh = (id: string) => {
    qc.invalidateQueries({ queryKey: getGetRunQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListRunsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getListJourneysQueryKey() });
  };

  const patchStep = (id: string, s: Step, st: StepState) =>
    setLocal((p) => (p.runId === id ? { ...p, steps: { ...p.steps, [s]: st } } : { runId: id, steps: { [s]: st }, recorder: null }));

  const aid = (id: string, s: string) => `${id}:${s}`.slice(0, 100);

  /** Record a real browser click/navigation; on instrumentation failure, record a recorder event instead of hiding it. */
  const record = async (id: string, data: Omit<EventInput, "eventId">): Promise<string | null> => {
    const eventId = newId(data.kind === "click" ? "clk" : "nav");
    try {
      await ingest.mutateAsync({ id, data: { ...data, eventId } });
      return eventId;
    } catch (e) {
      const msg = errMessage(e);
      setLocal((p) => ({ runId: id, steps: p.runId === id ? p.steps : {}, recorder: msg }));
      try {
        await ingest.mutateAsync({ id, data: { eventId: newId("rec"), actionId: data.actionId, stepId: data.stepId, kind: "recorder", label: `Recorder could not capture ${data.kind}: ${msg}`.slice(0, 200) } });
      } catch {
        /* recorder itself unreachable; surfaced locally above */
      }
      return null;
    }
  };

  const callStep = async (id: string, s: Step, addr?: string): Promise<{ ok: boolean; status?: number }> => {
    try {
      const r = await exec.mutateAsync({ id, step: s, data: { actionId: aid(id, s), address: addr } });
      patchStep(id, s, { ok: r.ok, message: r.message });
      return { ok: r.ok };
    } catch (e) {
      patchStep(id, s, { ok: false, message: errMessage(e) });
      if (e && typeof e === "object" && "data" in e && (e.data as { recorderFailure?: boolean })?.recorderFailure) {
        setLocal(p => ({ ...p, runId: id, recorder: "Recorder persistence failed. The application operation was rolled back; retry safely." }));
      }
      return { ok: false, status: errStatus(e) };
    }
  };

  const finishSafe = async (id: string) => {
    try {
      await finish.mutateAsync({ id });
    } catch (e) {
      setLocal(p => ({ ...p, runId: id, recorder: `Could not persist the final run status: ${errMessage(e)}` }));
    }
    refresh(id);
  };

  const track = (fn: () => Promise<boolean>) => {
    const p = fn().finally(() => setBusy(null));
    inflight.current = p;
    return p;
  };

  const onAddToCart = () =>
    track(async () => {
      const id = runIdRef.current;
      setBusy("cart");
      await record(id, { actionId: aid(id, "cart"), traceId: aid(id, "cart"), stepId: "cart", kind: "click", label: 'Click "Add to cart"' });
      const r = await callStep(id, "cart");
      if (!r.ok) await finishSafe(id);
      else refresh(id);
      return r.ok;
    });

  const onContinue = () =>
    track(async () => {
      const id = runIdRef.current;
      setBusy("continue");
      const click = await record(id, { actionId: aid(id, "shipping"), traceId: aid(id, "shipping"), stepId: "shipping", kind: "click", label: 'Click "Continue to checkout"' });
      await record(id, { actionId: aid(id, "inventory"), traceId: aid(id, "inventory"), parentId: click, stepId: "inventory", kind: "navigation", label: "Navigate to checkout view", path: "/demo/checkout" });
      const [a, b] = await Promise.all([callStep(id, "shipping"), callStep(id, "inventory")]);
      const ok = a.ok && b.ok;
      if (!ok) await finishSafe(id);
      else refresh(id);
      return ok;
    });

  const onPlaceOrder = () =>
    track(async () => {
      const id = runIdRef.current;
      setBusy("checkout");
      const v = variantRef.current;
      const prior = Math.max(checkoutApi.length, attemptsRef.current.runId === id ? attemptsRef.current.n : 0);
      await record(id, { actionId: aid(id, "checkout"), traceId: aid(id, "checkout"), stepId: "checkout", kind: "click", label: prior > 0 ? 'Click "Retry checkout"' : 'Click "Place order"' });
      const addr = v === "missing_address" && prior === 0 ? "" : address;
      let n = prior;
      let res = { ok: false } as { ok: boolean; status?: number };
      for (let i = 0; i < 2 && n < MAX_CHECKOUT_ATTEMPTS; i++) {
        n += 1;
        attemptsRef.current = { runId: id, n };
        res = await callStep(id, "checkout", addr);
        if (res.ok || !(v === "transient" && res.status === 503)) break;
        await sleep(500);
      }
      if (res.ok) {
        await record(id, { actionId: aid(id, "confirmation"), traceId: aid(id, "checkout"), stepId: "confirmation", kind: "navigation", label: "Navigate to order confirmation", path: "/demo/confirmation" });
      }
      await finishSafe(id);
      return res.ok;
    });

  const startRun = async (name?: string): Promise<string | null> => {
    if (!checkoutJourney) return null;
    try {
      const r = await createRun.mutateAsync({ data: { journeyId: checkoutJourney.id, variant, name } });
      runIdRef.current = r.id;
      variantRef.current = variant;
      attemptsRef.current = { runId: r.id, n: 0 };
      setLocal({ runId: r.id, steps: {}, recorder: null });
      setLocation(`/demo?run=${r.id}`);
      refresh(r.id);
      return r.id;
    } catch (e) {
      toast({ title: "Could not start recording", description: errMessage(e), variant: "destructive" });
      return null;
    }
  };

  const waitForButton = async (ref: RefObject<HTMLButtonElement | null>) => {
    for (let i = 0; i < 200; i++) {
      if (ref.current && !ref.current.disabled) return ref.current;
      await sleep(50);
    }
    throw new Error("Button did not become available");
  };

  const replay = async () => {
    setReplaying(true);
    try {
      const id = await startRun(`Replay · ${VARIANT_LABEL[variant]}`);
      if (!id) return;
      for (const ref of [cartBtn, continueBtn, placeBtn]) {
        const btn = await waitForButton(ref);
        await sleep(450);
        btn.click();
        await sleep(0);
        const ok = await (inflight.current ?? Promise.resolve(true));
        if (!ok) break;
      }
    } catch (e) {
      toast({ title: "Replay stopped", description: errMessage(e), variant: "destructive" });
    } finally {
      setReplaying(false);
    }
  };

  const abandon = () => runId && finishSafe(runId);
  const recorderError = run?.recorderError ?? recorderLocal;
  const subtotal = PRODUCT.price;
  const shippingCost = 5;

  return (
    <div>
      <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between rise">
        <div>
          <Eyebrow>Built-in checkout demo</Eyebrow>
          <h1 className="mt-2 text-3xl font-bold md:text-[2.6rem] leading-[1.05]">Record a checkout journey</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">Record a successful checkout as your baseline, then try a failure to see exactly which step changed. No real payments.</p>
        </div>
        {runId && (
          <Link href={`/runs/${runId}`} className={btnGhost} data-testid="link-open-run">
            Open full flow <ArrowUpRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      <section className="mb-8 rounded-3xl border border-border bg-card p-6">
        <div className="grid gap-3 md:grid-cols-3">
          {VARIANTS.map((o) => (
            <button
              key={o.v}
              data-testid={`button-variant-${o.v}`}
              disabled={blocked}
              onClick={() => setVariant(o.v)}
              className={cn(
                "rounded-2xl border p-4 text-left transition-all hover:-translate-y-px disabled:opacity-60 disabled:hover:translate-y-0",
                variant === o.v ? "border-navy bg-navy/[0.04] shadow-[0_10px_24px_-18px_hsl(var(--navy)/.8)]" : "border-border",
              )}
            >
              <div className="flex items-center gap-2 font-semibold"><span className={cn("h-2 w-2 rounded-full", o.tone)} />{mode === "journey" && o.v === "transient" ? "Temporary failure" : o.title}{variant === o.v && <Check className="ml-auto h-4 w-4 text-navy" />}</div>
              <p className="mt-1 text-sm text-muted-foreground">{mode === "journey" && o.v === "missing_address" ? "Checkout stops until a shipping address is provided." : mode === "journey" && o.v === "transient" ? "Checkout fails once, then retries successfully." : o.desc}</p>
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button className={btnPrimary} disabled={blocked || !checkoutJourney || createRun.isPending} onClick={() => startRun(`Manual · ${VARIANT_LABEL[variant]}`)} data-testid="button-start-manual">
            <CirclePlay className="h-4 w-4" /> Start recording and shop manually
          </button>
          <button className={btnTeal} disabled={blocked || !checkoutJourney || createRun.isPending} onClick={replay} data-testid="button-replay">
            {replaying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />} {replaying ? "Replaying real clicks..." : "Automatic replay"}
          </button>
          {recording && !replaying && (
            <button className={btnGhost} onClick={abandon} data-testid="button-finish-run"><Square className="h-3.5 w-3.5" /> Finish this run now</button>
          )}
          {otherActive && (
            <span className="text-sm text-warn" data-testid="text-other-active">
              Another run is still recording. <Link href={`/demo?run=${otherActive.id}`} className="underline">Resume it</Link> before starting a new one.
            </span>
          )}
          {journeys.isError && <span className="text-sm text-fail">Could not load journeys.</span>}
        </div>
      </section>

      {recorderError && (
        <div className="mb-6 flex gap-3 rounded-2xl border border-warn/35 bg-warn/5 p-4" data-testid="status-recorder-error">
          <ShieldAlert className="h-5 w-5 shrink-0 text-warn" />
          <div className="text-sm"><span className="font-semibold text-warn">Recorder issue (not the app):</span> <span className="text-muted-foreground">{recorderError}</span></div>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr]">
        {/* Storefront */}
        <section className="overflow-hidden rounded-3xl border border-border bg-[hsl(36_40%_99%)] shadow-[0_30px_60px_-45px_hsl(var(--navy)/.5)]" data-testid="section-store">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="font-display text-lg font-bold tracking-tight">Larkspur Supply Co.</div>
            <div className="flex gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
              {(["cart", "checkout", "confirmation"] as const).map((v) => (
                <span key={v} className={cn("rounded-full px-2 py-1", view === v ? "bg-navy text-paper" : "text-muted-foreground")}>{v}</span>
              ))}
            </div>
          </div>
          <div className="p-6 md:p-8">
            {runId && detail.isLoading && <div className="space-y-4"><Skel className="h-40" /><Skel className="h-12" /></div>}
            {runId && detail.isError && <ErrorState message={errMessage(detail.error)} onRetry={() => detail.refetch()} />}

            {view === "idle" && (
              <div className="grid place-items-center py-16 text-center" data-testid="empty-demo">
                <Package className="h-10 w-10 text-navy/40" />
                <h2 className="mt-4 text-2xl font-bold">The shop is closed until you start recording</h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">Pick a variant above, then shop manually or let replay press the same buttons for you.</p>
              </div>
            )}

            {run && view === "cart" && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6 md:grid-cols-[180px_1fr]">
                <div className="grid aspect-square place-items-center rounded-2xl bg-[linear-gradient(135deg,hsl(36_60%_88%),hsl(172_30%_82%))]">
                  <svg viewBox="0 0 80 80" className="h-24 w-24"><path d="M18 30h44l-4 38H22z" fill="hsl(var(--navy))" /><path d="M30 30c0-12 20-12 20 0" stroke="hsl(var(--navy))" strokeWidth="4" fill="none" /><circle cx="28" cy="40" r="2" fill="hsl(36 80% 60%)" /><circle cx="52" cy="40" r="2" fill="hsl(36 80% 60%)" /></svg>
                </div>
                <div>
                  <div className="font-mono text-[11px] text-muted-foreground">{PRODUCT.sku}</div>
                  <h2 className="mt-1 text-2xl font-bold">{PRODUCT.name}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{PRODUCT.desc}</p>
                  <div className="mt-4 font-display text-3xl font-bold">${PRODUCT.price.toFixed(2)}</div>
                  <button ref={cartBtn} data-trace-step="cart" data-testid="button-add-to-cart" className={btnPrimary + " mt-6 w-full md:w-auto"} disabled={!!busy || run.status !== "recording"} onClick={onAddToCart}>
                    {busy === "cart" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add to cart
                  </button>
                  {steps.cart && !steps.cart.ok && <p className="mt-3 text-sm text-fail">{steps.cart.message}</p>}
                  {run.status !== "recording" && <p className="mt-3 text-sm text-muted-foreground">This run is finished; its evidence is still inspectable.</p>}
                </div>
              </motion.div>
            )}

            {run && view === "checkout" && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
                  <div><div className="font-medium">{PRODUCT.name}</div><div className="text-xs text-muted-foreground">Qty 1 · in cart</div></div>
                  <div className="font-mono">${subtotal.toFixed(2)}</div>
                </div>

                {!(done("shipping") && done("inventory")) ? (
                  <div className="mt-6">
                    <button ref={continueBtn} data-trace-step="shipping" data-testid="button-continue-checkout" className={btnPrimary + " w-full"} disabled={!!busy || run.status !== "recording"} onClick={onContinue}>
                      {busy === "continue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />} Continue to checkout
                    </button>
                    <p className="mt-2 text-xs text-muted-foreground">Quotes shipping and checks inventory at the same time.</p>
                    {(["shipping", "inventory"] as const).map((s) => steps[s] && !steps[s]!.ok && <p key={s} className="mt-2 text-sm text-fail">{s}: {steps[s]!.message}</p>)}
                  </div>
                ) : (
                  <div className="mt-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl bg-ok/10 px-3 py-2 text-ok"><Check className="mr-1 inline h-3.5 w-3.5" /> Shipping quoted ${shippingCost.toFixed(2)}</div>
                      <div className="rounded-xl bg-ok/10 px-3 py-2 text-ok"><Check className="mr-1 inline h-3.5 w-3.5" /> In stock</div>
                    </div>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium">Shipping address <span className="text-muted-foreground">(synthetic only)</span></span>
                      <input data-testid="input-address" className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} disabled={!!busy} />
                      {run.variant === "missing_address" && attempts === 0 && <span className="mt-1 block text-xs text-fail">This variant sends the first checkout with an empty address on purpose.</span>}
                    </label>
                    <div className="flex justify-between border-t border-border pt-4 font-display text-lg font-bold"><span>Total</span><span>${(subtotal + shippingCost).toFixed(2)}</span></div>
                    <button
                      ref={placeBtn}
                      data-trace-step="checkout"
                      data-testid="button-place-order"
                      className={(lastCheckoutFail ? btnGhost : btnTeal) + " w-full"}
                      disabled={!!busy || attempts >= MAX_CHECKOUT_ATTEMPTS || (!lastCheckoutFail && run.status !== "recording")}
                      onClick={onPlaceOrder}
                    >
                      {busy === "checkout" ? <Loader2 className="h-4 w-4 animate-spin" /> : lastCheckoutFail ? <RotateCw className="h-4 w-4" /> : null}
                      {lastCheckoutFail ? "Retry checkout" : "Place order"}
                    </button>
                    {lastCheckoutFail && (
                      <div className="flex gap-2 rounded-xl border border-fail/30 bg-fail/5 p-3 text-sm" data-testid="status-checkout-failed">
                        <XOctagon className="h-4 w-4 shrink-0 text-fail" />
                        <span><span className="font-semibold text-fail">Checkout failed.</span> {mode === "journey" ? journeySteps.find(s => s.id === "checkout")?.outcome ?? "Check your details and try again." : steps.checkout?.message ?? "See evidence."} Attempts used {attempts} of {MAX_CHECKOUT_ATTEMPTS}. Retry checkout without repeating the earlier steps.</span>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {run && view === "confirmation" && (
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="py-8 text-center" data-testid="section-confirmation">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ok text-paper"><Check className="h-7 w-7" /></div>
                <h2 className="mt-4 text-2xl font-bold">Order placed</h2>
                <p className="mt-1 text-sm text-muted-foreground">{steps.checkout?.message ?? "Checkout succeeded."}</p>
                <div className="mt-6 flex justify-center gap-2">
                  <Link href={`/runs/${run.id}`} className={btnPrimary} data-testid="link-inspect-run">Inspect the evidence</Link>
                </div>
              </motion.div>
            )}
          </div>
        </section>

        {/* Live evidence */}
        <aside className="rounded-3xl border border-border bg-card p-6" data-testid="section-live-evidence">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Eyebrow>Live evidence</Eyebrow>
            {run && <StatusPill status={run.status} />}
          </div>
          <ModeToggle mode={mode} setMode={setMode} size="sm" className="mb-4" />
          {!runId ? (
              <p className="text-sm text-muted-foreground">Your clicks and requests will appear here as you move through checkout.</p>
          ) : events.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><span className="h-2 w-2 rounded-full bg-ok live-dot" /> Waiting for the first event</div>
          ) : mode === "journey" ? (
            <JourneyTimeline steps={journeySteps} selectedStepId={selCur.stepId} onSelect={pickStep} compact />
          ) : (
            <ol className="relative space-y-1 border-l border-border pl-4">
              {events.map((e) => {
                const t = eventTone(e);
                return (
                  <motion.li key={e.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className={cn("relative -mx-2 cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-navy/[0.04]", selEvent?.id === e.id && "bg-navy/[0.06]")} data-testid={`row-live-event-${e.sequence}`} data-step-id={e.stepId} role="button" tabIndex={0} onClick={() => pickEvent(e.id)} onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && pickEvent(e.id)}>
                    <span className={cn("absolute -left-[13px] top-3 grid h-2.5 w-2.5 place-items-center rounded-full border-2 border-card", t === "ok" ? "bg-ok" : t === "fail" ? "bg-fail" : t === "warn" ? "bg-warn" : "bg-navy/40")} />
                    <div className="flex items-center gap-2 text-sm"><KindIcon kind={e.kind} className={toneText[t]} /><span className="truncate">{e.label}</span></div>
                    <div className="font-mono text-[10.5px] text-muted-foreground">
                      #{e.sequence} · {e.stepId}{e.method ? ` · ${e.method} ${displayPath(e.path)}` : ""}{e.status != null ? ` · ${e.status}` : ""}{e.durationMs != null ? ` · ${fmtMs(e.durationMs)}` : ""}{e.attempt && e.attempt > 1 ? ` · attempt ${e.attempt}` : ""}
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          )}
        </aside>
      </div>
      <EvidenceDrawer
        open={selCur.open && (mode === "journey" ? !!selStep : !!selEvent || !!selStep)}
        event={selEvent}
        step={selStep}
        events={events}
        mode={mode}
        onModeChange={setMode}
        onClose={() => setSel({ ...selCur, open: false })}
        onSelect={(e) => pickEvent(e.id)}
      />
    </div>
  );
}
