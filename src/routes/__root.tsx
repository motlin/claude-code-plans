import {
	Outlet,
	Link,
	createRootRouteWithContext,
	HeadContent,
	Scripts,
	useMatches,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import type {ErrorComponentProps, StaticDataRouteOption} from "@tanstack/react-router";
import {noop, QueryClientProvider, type QueryClient} from "@tanstack/react-query";
import {useEffect, type ReactNode} from "react";
import {ThemeProvider} from "../components/theme-provider";
import {SettingsProvider} from "../components/settings-provider";
import {ToastProvider} from "../components/toast";
import {DevOverlays} from "../components/dev-overlays";
import {AppFrame} from "../components/app-frame";
import {Spark} from "../components/spark";
import {AppShellFallback} from "../components/app-shell-fallback";
import {getShellChinLabels} from "../lib/shell-chin-store";
import {ChunkPrefetch} from "../components/chunk-prefetch";
import {DeferredCommandPalette} from "../components/command-palette-entry";
import {DeferredSettingsDialog} from "../components/settings/settings-dialog-entry";
import {DeferredKeyboardShortcutsDialog} from "../components/keyboard-shortcuts-dialog-entry";
import {RecentsSwitcher} from "../components/recents-switcher";
import {NewSessionShortcut} from "../components/new-session-shortcut";
import {ForkNavigator} from "../components/fork-navigator";
import {useCommandPalette} from "../hooks/use-command-palette";
import {useFocusRegionShortcuts} from "../hooks/use-focus-regions";
import {useRecentsRecorder} from "../hooks/use-recents-recorder";
import {useSidebarState, useSidebarToggleShortcut} from "../lib/sidebar-store";
import {IndexingBanner} from "../components/indexing-banner";
import {HookSchemaDriftBanner} from "../components/hook-schema-drift-banner";
import {ClaudeEventsProvider} from "../components/claude-events-provider";
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
import {startLaunchJourneys} from "../lib/perf/field-journeys";
import {installVisualViewportHeight} from "../lib/visual-viewport-height";

export const Route = createRootRouteWithContext<{queryClient: QueryClient}>()({
	ssr: false,
	// Fire-and-forget cache warming for the sidebar. Never await these: with
	// `ssr: false` nothing paints until every matched loader resolves, so a
	// blocking root loader holds the whole app on a blank white screen until
	// all nine payloads arrive. Every route's own loader ensures the data it
	// actually renders; the sidebar session groups use non-suspending `useQuery`.
	loader: ({context: {queryClient}}) => {
		void queryClient.query(projectsQueryOptions()).catch(noop);
		void queryClient.query(plansQueryOptions()).catch(noop);
		void queryClient.infiniteQuery(recentSessionsInfiniteQueryOptions()).catch(noop);
		void queryClient.query(groupedSessionsQueryOptions()).catch(noop);
		void queryClient.query(pluginsQueryOptions).catch(noop);
		void queryClient.query(userCommandsQueryOptions).catch(noop);
		void queryClient.query(activeSessionsQueryOptions(60_000)).catch(noop);
		void queryClient.query(approvalsQueryOptions()).catch(noop);
		void queryClient.query(notificationsQueryOptions()).catch(noop);
	},
	head: () => ({
		meta: [
			{charSet: "utf-8"},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
			},
		],
		links: [
			{rel: "stylesheet", href: appCss},
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='14.10' y='1.00' width='3.8' height='15.00' rx='1.9' fill='%238B5CF6' transform='rotate(0.0 16 16)'/%3E%3Crect x='14.10' y='3.40' width='3.8' height='12.60' rx='1.9' fill='%238B5CF6' transform='rotate(36.0 16 16)'/%3E%3Crect x='14.10' y='1.60' width='3.8' height='14.40' rx='1.9' fill='%238B5CF6' transform='rotate(72.0 16 16)'/%3E%3Crect x='14.10' y='4.00' width='3.8' height='12.00' rx='1.9' fill='%238B5CF6' transform='rotate(108.0 16 16)'/%3E%3Crect x='14.10' y='2.20' width='3.8' height='13.80' rx='1.9' fill='%238B5CF6' transform='rotate(144.0 16 16)'/%3E%3Crect x='14.10' y='1.00' width='3.8' height='15.00' rx='1.9' fill='%238B5CF6' transform='rotate(180.0 16 16)'/%3E%3Crect x='14.10' y='3.10' width='3.8' height='12.90' rx='1.9' fill='%238B5CF6' transform='rotate(216.0 16 16)'/%3E%3Crect x='14.10' y='1.90' width='3.8' height='14.10' rx='1.9' fill='%238B5CF6' transform='rotate(252.0 16 16)'/%3E%3Crect x='14.10' y='3.70' width='3.8' height='12.30' rx='1.9' fill='%238B5CF6' transform='rotate(288.0 16 16)'/%3E%3Crect x='14.10' y='2.50' width='3.8' height='13.50' rx='1.9' fill='%238B5CF6' transform='rotate(324.0 16 16)'/%3E%3C/svg%3E",
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
				{import.meta.env.DEV ? <DevOverlays /> : null}
			</QueryClientProvider>
		</>
	);
}

const PAGE_GUTTER_CLASS = {
	default: "px-4 sm:px-8",
	tight: "px-2",
	"phone-tight": "px-2 sm:px-8",
} as const satisfies Record<NonNullable<StaticDataRouteOption["pageGutter"]> | "default", string>;

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
	const pageGutter = useMatches({
		select: (matches) =>
			matches.findLast((match) => match.staticData.pageGutter !== undefined)?.staticData.pageGutter,
	});
	const tileShell = useMatches({
		select: (matches) =>
			matches.findLast((match) => match.staticData.tileShell !== undefined)?.staticData.tileShell,
	});
	// Field journeys J1/J2 (launch, deep link) run once, timed from navigation start on the route the tab opened.
	useEffect(() => {
		startLaunchJourneys(window.location.pathname);
	}, []);
	// Fit the app frame above the soft keyboard on touch devices.
	useEffect(() => installVisualViewportHeight(), []);

	return (
		<>
			<AppFrame
				collapsed={sidebarCollapsed}
				tileShell={tileShell !== undefined}
				className={fullBleed ? "flex flex-col" : ""}
			>
				<div className={tileShell === undefined ? undefined : "shrink-0"}>
					<IndexingBanner />
					<HookSchemaDriftBanner />
					{capabilities.showWorkingCopyReview && (
						<WorkingCopyReviewBanner capability={capabilities.states.workingCopyReview} />
					)}
				</div>
				<DesktopNotificationBridge />
				<AttentionBadgeBridge />
				{tileShell === undefined ? (
					<>
						<RootTopRow />
						{fullBleed ? (
							<div className="min-h-0 flex-1">{children}</div>
						) : (
							<div className={`${PAGE_GUTTER_CLASS[pageGutter ?? "default"]} pb-24 sm:pb-8`}>
								{children}
							</div>
						)}
					</>
				) : (
					<div data-route-tile-shell={tileShell}>
						<div className="min-h-0 flex-1">{children}</div>
					</div>
				)}
			</AppFrame>
			<DeferredCommandPalette {...commandPalette} />
			<DeferredKeyboardShortcutsDialog />
			<RecentsSwitcher />
			<NewSessionShortcut />
			<ForkNavigator />
			<DeferredSettingsDialog />
			<ChunkPrefetch />
		</>
	);
}

/**
 * The empty row above every non-tile page. Below sm it is 48px tall, like upstream's sticky crumb
 * band, so page titles start past the fixed Show-sidebar trigger (8..40) instead of under it.
 */
export function RootTopRow() {
	return <div className="min-h-9 px-4 pt-3 max-sm:h-12 sm:px-8" />;
}

function NotFound() {
	return <NotFoundContent />;
}

/** Upstream's 404, centred in the app shell: the spark and wordmark, "Page not found", its line and Go back home. */
function NotFoundContent({detail}: Readonly<{detail?: string}>) {
	return (
		<div
			data-not-found=""
			className="flex min-h-[calc(100dvh-8rem)] flex-col items-center justify-center gap-6 px-4 text-center"
		>
			<span
				aria-hidden="true"
				className="mb-6 flex items-center gap-1.5 font-voice text-[20px] leading-none font-medium whitespace-nowrap text-primary"
			>
				<Spark size={24} />
				Claude Code Browser
			</span>
			<div className="flex flex-col items-center gap-1">
				<h1 className="font-voice text-[20px]/[28px] font-normal text-primary">Page not found</h1>
				<p className="text-[15px]/[20px] text-secondary">
					Claude can help with many things, but finding this page isn’t one of them.
				</p>
			</div>
			{detail ? <pre className="max-w-2xl overflow-auto font-mono text-xs text-t6">{detail}</pre> : null}
			<Link
				to="/"
				className="inline-flex h-8 items-center rounded-r6 bg-fill-primary px-3 text-[14px]/[20px] font-medium text-on-primary no-underline transition-colors hover:bg-fill-primary-hover"
			>
				Go back home
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
	// The fallback paints the requested route's own loading layout.
	const pathname = useRouterState({select: (state) => state.location.pathname});
	return (
		// THEME_INIT_SCRIPT adds the resolved theme class and color-scheme to <html>
		// before React loads, which is by definition an attribute the server markup
		// did not carry; suppressHydrationWarning keeps that expected difference from
		// logging a hydration error.
		<html lang="en" data-density="comfortable" suppressHydrationWarning>
			<head>
				<HeadContent />
				{/* Static constant, no interpolation: this is the only way to run the
            theme resolver synchronously before the first paint. */}
				<script dangerouslySetInnerHTML={{__html: THEME_INIT_SCRIPT}} />
			</head>
			<body>
				<AppShellFallback pathname={pathname} chin={getShellChinLabels()} />
				{children}
				<Scripts />
			</body>
		</html>
	);
}
