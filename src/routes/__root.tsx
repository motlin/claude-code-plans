import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useState, type ReactNode } from "react";
import { Agentation } from "agentation";
import { ThemeProvider } from "../components/theme-provider";
import { SettingsProvider } from "../components/settings-provider";
import { ModeToggle } from "../components/mode-toggle";
import { Sidebar } from "../components/sidebar/index";
import { CommandPalette } from "../components/command-palette";
import { useCommandPalette } from "../hooks/use-command-palette";
import { IndexingBanner } from "../components/indexing-banner";
import { HookSchemaDriftBanner } from "../components/hook-schema-drift-banner";
import { ClaudeEventsProvider } from "../hooks/use-claude-events";
import { DesktopNotificationBridge } from "../components/desktop-notification-bridge";
import { AttentionBadgeBridge } from "../components/attention-badge-bridge";
import { WorkingCopyReviewBanner } from "../components/working-copy-review-banner";
import { useCapabilities } from "../hooks/use-capabilities";
import { approvalsQueryOptions } from "../lib/api/approvals";
import { notificationsQueryOptions } from "../lib/api/notifications";
import { plansQueryOptions } from "../lib/api/plans";
import { projectsQueryOptions } from "../lib/api/projects";
import { pluginsQueryOptions, userCommandsQueryOptions } from "../lib/api/plugins";
import {
  activeSessionsQueryOptions,
  recentSessionsInfiniteQueryOptions,
  groupedSessionsQueryOptions,
} from "../lib/api/sessions";
import appCss from "../styles/globals.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  ssr: false,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(projectsQueryOptions()),
      queryClient.ensureQueryData(plansQueryOptions()),
      queryClient.ensureInfiniteQueryData(recentSessionsInfiniteQueryOptions()),
      queryClient.ensureQueryData(groupedSessionsQueryOptions()),
      queryClient.ensureQueryData(pluginsQueryOptions),
      queryClient.ensureQueryData(userCommandsQueryOptions),
      queryClient.ensureQueryData(activeSessionsQueryOptions(60_000)),
      queryClient.ensureQueryData(approvalsQueryOptions()),
      queryClient.ensureQueryData(notificationsQueryOptions()),
    ]),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23C87B3A'/%3E%3Cpath d='M16 5L17.5 13.5L26 16L17.5 18.5L16 27L14.5 18.5L6 16L14.5 13.5Z' fill='white' opacity='0.95'/%3E%3C/svg%3E",
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=JetBrains+Mono:wght@400;600&display=swap",
      },
    ],
  }),
  // `ssr: false` suppresses RootComponent on the server, so the document wrapper must stay here.
  // Nesting RootDocument inside RootComponent leaves the initial response without an HTML shell.
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: RootErrorComponent,
});

function HamburgerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path
        fillRule="evenodd"
        d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zm0 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();

  // Close on route change
  useEffect(() => {
    if (!open) return;
    return router.subscribe("onBeforeNavigate", onClose);
  }, [open, onClose, router]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <Sidebar collapsed={false} onToggle={onClose} mobile />
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SettingsProvider>
            <ClaudeEventsProvider>
              <RootLayout />
            </ClaudeEventsProvider>
          </SettingsProvider>
        </ThemeProvider>
        {import.meta.env.DEV ? <ReactQueryDevtools buttonPosition="bottom-left" /> : null}
      </QueryClientProvider>
      {import.meta.env.DEV && <Agentation endpoint="http://localhost:4747" />}
    </>
  );
}

function RootLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const commandPalette = useCommandPalette();
  const capabilities = useCapabilities();

  return (
    <>
      <div className="flex h-screen">
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((c) => !c)} />
        <main className="flex-1 overflow-y-auto bg-bg-000">
          <IndexingBanner />
          <HookSchemaDriftBanner />
          {capabilities.showWorkingCopyReview && (
            <WorkingCopyReviewBanner capability={capabilities.states.workingCopyReview} />
          )}
          <DesktopNotificationBridge />
          <AttentionBadgeBridge />
          <div className="flex min-h-9 items-center px-4 pt-3 sm:px-8">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-[6px] text-text-200 transition-colors hover:bg-bg-300/50 md:hidden"
              title="Open menu"
            >
              <HamburgerIcon />
            </button>
            <div className="ml-auto flex items-center gap-1">
              <ModeToggle />
            </div>
          </div>
          <div className="px-4 pb-8 sm:px-8">
            <Outlet />
          </div>
        </main>
      </div>
      <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <CommandPalette open={commandPalette.open} onOpenChange={commandPalette.setOpen} />
    </>
  );
}

function NotFound() {
  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">404 &mdash; Not Found</h1>
      <p className="mt-2 text-text-500">The requested page was not found.</p>
    </div>
  );
}

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "An unexpected error occurred";

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold text-red-600 dark:text-red-400">Something went wrong</h1>
      <pre className="mt-3 max-w-2xl overflow-auto rounded-md border border-border-300/15 bg-bg-200 p-3 font-mono text-sm text-text-500">
        {message}
      </pre>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-100/80"
      >
        Try again
      </button>
    </div>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
