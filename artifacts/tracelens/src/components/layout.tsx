import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { BookOpen, FlaskConical, FolderKanban, LogIn, LogOut, Plug } from "lucide-react";
import { Show, useClerk, useUser } from "@clerk/react";
import { useHealthCheck } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const EXAMPLE_PATHS = ["/examples", "/journeys", "/runs", "/compare", "/demo"];
const NAV = [
  { href: "/projects", label: "Projects", icon: FolderKanban, test: (l: string) => l === "/projects" || (l.startsWith("/projects/") && l !== "/projects/new") },
  { href: "/projects/new", label: "Connect application", icon: Plug, test: (l: string) => l === "/projects/new" },
  { href: "/examples", label: "Examples", icon: FlaskConical, test: (l: string) => EXAMPLE_PATHS.some((p) => l === p || l.startsWith(p + "/")) },
  { href: "/setup", label: "Setup & limits", icon: BookOpen, test: (l: string) => l.startsWith("/setup") },
];
const EXAMPLE_NAV = [
  { href: "/examples", label: "Overview" },
  { href: "/journeys", label: "Journeys" },
  { href: "/compare", label: "Compare" },
  { href: "/demo", label: "Checkout demo" },
];

export function Mark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="hsl(var(--sidebar-accent))" />
      <circle cx="9" cy="16" r="2.6" fill="hsl(var(--ok))" />
      <circle cx="16" cy="10" r="2.6" fill="hsl(var(--paper))" />
      <circle cx="16" cy="22" r="2.6" fill="hsl(var(--paper))" />
      <circle cx="24" cy="16" r="2.6" fill="hsl(var(--fail))" />
      <path d="M9 16 16 10M9 16l7 6M16 10l8 6M16 22l8-6" stroke="hsl(var(--paper)/.45)" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function UserMenu({ compact }: { compact?: boolean }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Account";
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  return (
    <>
      <Show when="signed-in">
        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-sidebar-accent/60 focus-visible:outline-2 focus-visible:outline-ok"
            data-testid="button-user-menu"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ok/90 font-mono text-[11px] font-semibold text-paper">{initials || "U"}</span>
            {!compact && <span className="min-w-0 flex-1 truncate text-sm text-paper">{name}</span>}
          </button>
          {open && (
            <div role="menu" className={cn("absolute z-50 w-56 rounded-xl border border-sidebar-border bg-sidebar p-1.5 shadow-xl", compact ? "right-0 top-11" : "bottom-12 left-0")}>
              <div className="px-3 py-2 text-[11px] text-sidebar-foreground/60 [overflow-wrap:anywhere]">{user?.primaryEmailAddress?.emailAddress}</div>
              <button role="menuitem" type="button" autoFocus onClick={() => signOut({ redirectUrl: basePath || "/" })} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-paper hover:bg-sidebar-accent focus-visible:bg-sidebar-accent" data-testid="button-sign-out">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </Show>
      <Show when="signed-out">
        <Link href="/sign-in" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-paper hover:bg-sidebar-accent" data-testid="link-sign-in">
          <LogIn className="h-4 w-4" /> Sign in
        </Link>
      </Show>
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const health = useHealthCheck();
  const up = health.data?.status === "ok" || (!!health.data && !health.isError);
  const inExamples = EXAMPLE_PATHS.some((p) => loc === p || loc.startsWith(p + "/"));

  const healthBadge = (
    <div className="flex items-center gap-2 font-mono text-[11px] text-sidebar-foreground/70" data-testid="status-health">
      <span className={cn("h-2 w-2 rounded-full", health.isLoading ? "bg-warn" : up ? "bg-ok live-dot" : "bg-fail")} />
      {health.isLoading ? "checking collector" : up ? "collector online" : "collector unreachable"}
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-background md:pl-[252px]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col bg-sidebar text-sidebar-foreground md:flex">
        <Link href="/" className="flex items-center gap-3 px-6 pb-8 pt-7" data-testid="link-home">
          <Mark />
          <div>
            <div className="font-display text-lg font-bold leading-none text-paper">TraceLens</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/55">journey recorder</div>
          </div>
        </Link>
        <nav className="flex flex-col gap-1 px-3" aria-label="Primary">
          {NAV.map((n) => {
            const on = n.test(loc);
            return (
              <div key={n.href}>
                <Link
                  href={n.href}
                  aria-current={on ? "page" : undefined}
                  data-testid={`link-nav-${n.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                  className={cn("group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                    on ? "bg-sidebar-accent text-paper" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-paper")}
                >
                  <span className={cn("absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-ok transition-all", on ? "opacity-100" : "opacity-0 group-hover:opacity-40")} />
                  <n.icon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  {n.label}
                  {n.href === "/examples" && <span className="ml-auto rounded-full border border-warn/40 px-1.5 font-mono text-[9px] uppercase tracking-wider text-warn">sample</span>}
                </Link>
                {n.href === "/examples" && inExamples && (
                  <div className="ml-6 mt-1 flex flex-col border-l border-sidebar-border pl-3">
                    {EXAMPLE_NAV.map((e) => (
                      <Link key={e.href} href={e.href} className={cn("rounded-lg px-2 py-1.5 text-[13px]", (loc === e.href || (e.href === "/journeys" && loc.startsWith("/runs"))) ? "text-paper" : "text-sidebar-foreground/60 hover:text-paper")}>{e.label}</Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="mt-auto space-y-4 border-t border-sidebar-border px-4 py-5">
          <div className="px-2">{healthBadge}</div>
          <UserMenu />
        </div>
      </aside>

      <header className="sticky top-0 z-40 bg-sidebar text-sidebar-foreground md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2" data-testid="link-home-mobile">
            <Mark />
            <span className="font-display font-bold text-paper">TraceLens</span>
          </Link>
          <UserMenu compact />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3" aria-label="Primary">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium", n.test(loc) ? "bg-sidebar-accent text-paper" : "text-sidebar-foreground/70")}>{n.label}</Link>
          ))}
        </nav>
      </header>

      {inExamples && (
        <div className="border-b border-warn/30 bg-warn/[0.07] px-5 py-2.5 text-center text-xs text-foreground/80 md:px-12" data-testid="banner-examples">
          <span className="font-semibold text-warn">Examples workspace.</span> Sample checkout recordings saved anonymously in this browser. Nothing here comes from your connected applications.
        </div>
      )}
      <main className="mx-auto w-full max-w-[1240px] px-5 py-10 md:px-12 md:py-14">{children}</main>
    </div>
  );
}
