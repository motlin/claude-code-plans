import {
	Outlet,
	Link,
	createRootRouteWithContext,
	HeadContent,
	Scripts,
	useMatches,
	useRouter,
} from "@tanstack/react-router";
import type {ErrorComponentProps} from "@tanstack/react-router";
import {QueryClientProvider, type QueryClient} from "@tanstack/react-query";
import {ReactQueryDevtools} from "@tanstack/react-query-devtools";
import {type ReactNode} from "react";
import {Agentation} from "agentation";
import {AGENTATION_ENDPOINT} from "../lib/agentation-endpoint";
import {ThemeProvider} from "../components/theme-provider";
import {SettingsProvider} from "../components/settings-provider";
import {ToastProvider} from "../components/toast";
import {AppFrame} from "../components/app-frame";
import {AppShellFallback} from "../components/app-shell-fallback";
import {CommandPalette} from "../components/command-palette";
import {SettingsDialog} from "../components/settings/settings-dialog";
import {KeyboardShortcutsDialog} from "../components/keyboard-shortcuts-dialog";
import {RecentsSwitcher} from "../components/recents-switcher";
import {NewSessionShortcut} from "../components/new-session-shortcut";
import {ForkNavigator} from "../components/fork-navigator";
import {useCommandPalette} from "../hooks/use-command-palette";
import {useFocusRegionShortcuts} from "../hooks/use-focus-regions";
import {useRecentsRecorder} from "../hooks/use-recents-recorder";
import {useSidebarState, useSidebarToggleShortcut} from "../lib/sidebar-store";
import {IndexingBanner} from "../components/indexing-banner";
import {HookSchemaDriftBanner} from "../components/hook-schema-drift-banner";
import {ClaudeEventsProvider} from "../hooks/use-claude-events";
import {DesktopNotificationBridge} from "../components/desktop-notification-bridge";
import {AttentionBadgeBridge} from "../components/attention-badge-bridge";
import {WorkingCopyReviewBanner} from "../components/working-copy-review-banner";
import {useCapabilities} from "../hooks/use-capabilities";
import {approvalsQueryOptions} from "../lib/api/approvals";
import {notificationsQueryOptions} from "../lib/api/notifications";
import {plansQueryOptions} from "../lib/api/plans";
import {projectsQueryOptions} from "../lib/api/projects";
import {ApiResponseError} from "../lib/api/client";
import {pluginsQueryOptions, userCommandsQueryOptions} from "../lib/api/plugins";
import {
	activeSessionsQueryOptions,
	recentSessionsInfiniteQueryOptions,
	groupedSessionsQueryOptions,
} from "../lib/api/sessions";
import appCss from "../styles/globals.css?url";
import {THEME_INIT_SCRIPT} from "../lib/theme-init";

export const Route = createRootRouteWithContext<{queryClient: QueryClient}>()({
	ssr: false,
	// Fire-and-forget cache warming for the sidebar. Never await these: with
	// `ssr: false` nothing paints until every matched loader resolves, so a
	// blocking root loader holds the whole app on a blank white screen until
	// all nine payloads arrive. Every route's own loader ensures the data it
	// actually renders; the sidebar sublists use non-suspending `useQuery`.
	loader: ({context: {queryClient}}) => {
		void queryClient.prefetchQuery(projectsQueryOptions());
		void queryClient.prefetchQuery(plansQueryOptions());
		void queryClient.prefetchInfiniteQuery(recentSessionsInfiniteQueryOptions());
		void queryClient.prefetchQuery(groupedSessionsQueryOptions());
		void queryClient.prefetchQuery(pluginsQueryOptions);
		void queryClient.prefetchQuery(userCommandsQueryOptions);
		void queryClient.prefetchQuery(activeSessionsQueryOptions(60_000));
		void queryClient.prefetchQuery(approvalsQueryOptions());
		void queryClient.prefetchQuery(notificationsQueryOptions());
	},
	head: () => ({
		meta: [
			{charSet: "utf-8"},
			{name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover"},
		],
		links: [
			{rel: "stylesheet", href: appCss},
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23C87B3A'/%3E%3Cpath d='M16 5L17.5 13.5L26 16L17.5 18.5L16 27L14.5 18.5L6 16L14.5 13.5Z' fill='white' opacity='0.95'/%3E%3C/svg%3E",
			},
			{rel: "preconnect", href: "https://fonts.googleapis.com"},
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

function RootComponent() {
	return (
		<RootApplication>
			<Outlet />
		</RootApplication>
	);
}

function RootApplication({children}: Readonly<{children: ReactNode}>) {
	const {queryClient} = Route.useRouteContext();
	return (
		<>
			<QueryClientProvider client={queryClient}>
				<ThemeProvider>
					<SettingsProvider>
						<ClaudeEventsProvider>
							<ToastProvider>
								<RootLayout>{children}</RootLayout>
							</ToastProvider>
						</ClaudeEventsProvider>
					</SettingsProvider>
				</ThemeProvider>
				{import.meta.env.DEV ? <ReactQueryDevtools buttonPosition="bottom-left" /> : null}
			</QueryClientProvider>
			{import.meta.env.DEV && <Agentation endpoint={AGENTATION_ENDPOINT} />}
		</>
	);
}

function RootLayout({children}: Readonly<{children: ReactNode}>) {
	const {collapsed: sidebarCollapsed} = useSidebarState();
	useSidebarToggleShortcut();
	useFocusRegionShortcuts();
	useRecentsRecorder();
	const commandPalette = useCommandPalette();
	const capabilities = useCapabilities();
	const fullBleed = useMatches({
		select: (matches) => matches.some((match) => match.staticData.fullBleed === true),
	});

	return (
		<>
			<AppFrame collapsed={sidebarCollapsed} className={fullBleed ? "flex flex-col" : ""}>
				<IndexingBanner />
				<HookSchemaDriftBanner />
				{capabilities.showWorkingCopyReview && (
					<WorkingCopyReviewBanner capability={capabilities.states.workingCopyReview} />
				)}
				<DesktopNotificationBridge />
				<AttentionBadgeBridge />
				<div className="min-h-9 px-4 pt-3 sm:px-8" />
				{fullBleed ? (
					<div className="min-h-0 flex-1">{children}</div>
				) : (
					<div className="px-4 pb-24 sm:px-8 sm:pb-8">{children}</div>
				)}
			</AppFrame>
			<CommandPalette {...commandPalette} />
			<KeyboardShortcutsDialog />
			<RecentsSwitcher />
			<NewSessionShortcut />
			<ForkNavigator />
			<SettingsDialog />
		</>
	);
}

function NotFound() {
	return <NotFoundContent />;
}

function NotFoundContent({detail}: Readonly<{detail?: string}>) {
	return (
		<div>
			<h1 className="text-lg font-semibold">404 &mdash; Not Found</h1>
			<p className="mt-2 text-t6">The requested page was not found.</p>
			{detail ? <pre className="mt-3 max-w-2xl overflow-auto font-mono text-xs text-t6">{detail}</pre> : null}
			<Link to="/" className="mt-4 inline-block text-sm text-accent-100 hover:underline">
				Back to home
			</Link>
		</div>
	);
}

function RootErrorComponent({error, reset}: ErrorComponentProps) {
	return (
		<RootApplication>
			<DefaultErrorComponent error={error} reset={reset} />
		</RootApplication>
	);
}

export function DefaultErrorComponent({error}: ErrorComponentProps) {
	const router = useRouter();

	if (error instanceof ApiResponseError && error.status === 404) {
		return <NotFoundContent detail={error.message} />;
	}

	const message = error instanceof Error ? error.message : "An unexpected error occurred";

	return (
		<div className="p-8">
			<h1 className="text-lg font-semibold text-red-600 dark:text-red-400">Something went wrong</h1>
			<p className="mt-2 text-sm text-t6">We couldn&apos;t load this page.</p>
			<pre className="mt-3 max-w-2xl overflow-auto rounded-md border border-border bg-surface-0 p-3 font-mono text-xs text-t6">
				{message}
			</pre>
			<div className="mt-4 flex items-center gap-3">
				<button
					type="button"
					onClick={() => void router.invalidate()}
					className="rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-100/80"
				>
					Try again
				</button>
				<Link to="/" className="text-sm text-accent-100 hover:underline">
					Back to home
				</Link>
			</div>
		</div>
	);
}

function RootDocument({children}: Readonly<{children: ReactNode}>) {
	return (
		// THEME_INIT_SCRIPT adds the resolved theme class and color-scheme to <html>
		// before React loads, which is by definition an attribute the server markup
		// did not carry; suppressHydrationWarning keeps that expected difference from
		// logging a hydration error.
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
				{/* Static constant, no interpolation: this is the only way to run the
            theme resolver synchronously before the first paint. */}
				<script dangerouslySetInnerHTML={{__html: THEME_INIT_SCRIPT}} />
			</head>
			<body>
				<AppShellFallback />
				{children}
				<Scripts />
			</body>
		</html>
	);
}
