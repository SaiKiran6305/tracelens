import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { Layout } from '@/components/layout';
import Dashboard from '@/pages/dashboard';
import Journeys from '@/pages/journeys';
import RunDetail from '@/pages/run-detail';
import Compare from '@/pages/compare';
import Demo from '@/pages/demo';
import Setup from '@/pages/setup';
import Landing from '@/pages/landing';
import Projects from '@/pages/projects';
import ConnectProject from '@/pages/connect';
import ProjectDetailPage from '@/pages/project-detail';
import ProjectRunPage from '@/pages/project-run';
import ProjectComparePage from '@/pages/project-compare';

// REQUIRED — copy verbatim.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(223 47% 14%)",
    colorForeground: "hsl(222 38% 15%)",
    colorMutedForeground: "hsl(222 12% 38%)",
    colorDanger: "hsl(6 72% 50%)",
    colorBackground: "hsl(40 45% 98.5%)",
    colorInput: "hsl(40 45% 99%)",
    colorInputForeground: "hsl(222 38% 15%)",
    colorNeutral: "hsl(222 38% 15%)",
    fontFamily: "'Instrument Sans', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card rounded-2xl w-[440px] max-w-full overflow-hidden border border-border shadow-[0_30px_60px_-30px_hsl(223_47%_14%/.35)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-display text-2xl font-bold text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground font-medium",
    footerActionLink: "text-ok font-semibold hover:text-navy",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-ok",
    formFieldSuccessText: "text-ok",
    alertText: "text-foreground",
    logoBox: "justify-center",
    logoImage: "h-10 w-10",
    socialButtonsBlockButton: "border border-border bg-paper hover:bg-muted",
    formButtonPrimary: "bg-navy text-paper hover:bg-navy/90 rounded-xl",
    formFieldInput: "bg-card border border-input rounded-xl text-foreground",
    footerAction: "bg-muted/60",
    dividerLine: "bg-border",
    alert: "border border-fail/30 bg-fail/5",
    otpCodeFieldInput: "border border-input text-foreground",
    formFieldRow: "gap-2",
    main: "gap-5",
  },
};

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid-paper flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      {children}
    </div>
  );
}

function SignInPage() {
  return (
    <AuthShell>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthShell>
  );
}

function SignUpPage() {
  return (
    <AuthShell>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthShell>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/projects" /></Show>
      <Show when="signed-out"><Landing /></Show>
    </>
  );
}

function Protected({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

let exampleBootstrap: Promise<void> | null = null;
function ExamplesWorkspace({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    exampleBootstrap ??= fetch(`${import.meta.env.BASE_URL}api/journeys`, { credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error('Example workspace unavailable'); })
      .catch(error => { exampleBootstrap = null; throw error; });
    exampleBootstrap.then(() => { if (mounted) setReady(true); }).catch(() => { if (mounted) setFailed(true); });
    return () => { mounted = false; };
  }, []);
  if (failed) return <p role="alert">Examples could not load. Refresh to try again.</p>;
  return ready ? children : <p role="status">Opening examples…</p>;
}
function AppRoutes() {
  return (
    <Layout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/projects"><Protected><Projects /></Protected></Route>
          <Route path="/projects/new"><Protected><ConnectProject /></Protected></Route>
          <Route path="/projects/:id/runs/:runId"><Protected><ProjectRunPage /></Protected></Route>
          <Route path="/projects/:id/compare"><Protected><ProjectComparePage /></Protected></Route>
          <Route path="/projects/:id"><Protected><ProjectDetailPage /></Protected></Route>
          <Route path="/examples"><ExamplesWorkspace><Dashboard /></ExamplesWorkspace></Route>
          <Route path="/journeys"><ExamplesWorkspace><Journeys /></ExamplesWorkspace></Route>
          <Route path="/runs/:id"><ExamplesWorkspace><RunDetail /></ExamplesWorkspace></Route>
          <Route path="/compare"><ExamplesWorkspace><Compare /></ExamplesWorkspace></Route>
          <Route path="/demo"><ExamplesWorkspace><Demo /></ExamplesWorkspace></Route>
          <Route path="/setup" component={Setup} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Layout>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "Back to your traces", subtitle: "Sign in to see your connected applications" } },
        signUp: { start: { title: "Connect your first app", subtitle: "Create an account to record real journeys" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={AppRoutes} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
