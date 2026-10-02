// @vitest-environment jsdom
import {QueryClient} from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	createRoute,
	createRouter,
	createMemoryHistory,
	RouterProvider,
} from "@tanstack/react-router";
import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vite-plus/test";
import {useRef, type ReactNode} from "react";
import {Route as RootRoute} from "../src/routes/__root";
import {Route as HomeRoute} from "../src/routes/index";
import {Route as SessionRoute} from "../src/routes/session.$id";
import {Route as SourceRoute} from "../src/routes/session.$id_.source.$uuid";
import {Route as SubagentsRoute} from "../src/routes/session.$id_.subagents";
import {HomePage} from "../src/components/home/home-page";
import {SessionTileFrame, type SessionTileScrollPosition} from "../src/components/session-tile-frame";
import {localAccountQueryOptions} from "../src/lib/api/local-account";

// Keep the actual root component, route metadata, AppFrame and home/chat frames.
// Background services and unrelated dialogs do not participate in ownership.
vi.mock("../src/components/sidebar/index", () => ({Sidebar: () => null}));
vi.mock("../src/components/theme-provider", () => ({ThemeProvider: ({children}: {children: ReactNode}) => children}));
vi.mock("../src/components/settings-provider", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/components/settings-provider")>()),
	SettingsProvider: ({children}: {children: ReactNode}) => children,
}));
vi.mock("../src/components/toast", () => ({ToastProvider: ({children}: {children: ReactNode}) => children}));
vi.mock("../src/hooks/use-claude-events", () => ({
	ClaudeEventsProvider: ({children}: {children: ReactNode}) => children,
}));
vi.mock("@tanstack/react-query-devtools", () => ({ReactQueryDevtools: () => null}));
vi.mock("agentation", () => ({Agentation: () => null}));
vi.mock("../src/components/indexing-banner", () => ({IndexingBanner: () => null}));
vi.mock("../src/components/hook-schema-drift-banner", () => ({HookSchemaDriftBanner: () => null}));
vi.mock("../src/components/working-copy-review-banner", () => ({WorkingCopyReviewBanner: () => null}));
vi.mock("../src/components/desktop-notification-bridge", () => ({DesktopNotificationBridge: () => null}));
vi.mock("../src/components/attention-badge-bridge", () => ({AttentionBadgeBridge: () => null}));
vi.mock("../src/components/command-palette", () => ({CommandPalette: () => null}));
vi.mock("../src/components/settings/settings-dialog", () => ({SettingsDialog: () => null}));
vi.mock("../src/components/keyboard-shortcuts-dialog", () => ({KeyboardShortcutsDialog: () => null}));
vi.mock("../src/components/recents-switcher", () => ({RecentsSwitcher: () => null}));
vi.mock("../src/components/new-session-shortcut", () => ({NewSessionShortcut: () => null}));
vi.mock("../src/components/fork-navigator", () => ({ForkNavigator: () => null}));
vi.mock("../src/hooks/use-command-palette", () => ({useCommandPalette: () => ({})}));
vi.mock("../src/hooks/use-focus-regions", () => ({useFocusRegionShortcuts: () => {}}));
vi.mock("../src/hooks/use-recents-recorder", () => ({useRecentsRecorder: () => {}}));
vi.mock("../src/hooks/use-capabilities", () => ({useCapabilities: () => ({showWorkingCopyReview: false})}));
vi.mock("../src/lib/sidebar-store", () => ({
	useSidebarState: () => ({collapsed: false}),
	useSidebarToggleShortcut: () => {},
}));
vi.mock("../src/lib/perf/field-journeys", () => ({startLaunchJourneys: () => {}}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrDispose: () => {},
	hmrPersist: <T,>(_key: string, initialize: () => T) => initialize(),
}));

const clients: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	vi.unstubAllGlobals();
});
function Chat() {
	const position = useRef<SessionTileScrollPosition | null>(null);
	const anchor = useRef<HTMLDivElement>(null);
	return (
		<SessionTileFrame
			sessionId="example-session"
			header={<p>Fabricated header</p>}
			footer={<p>Fabricated composer</p>}
			anchorRef={anchor}
			positionRef={position}
			visitKey="example-visit"
			restoredScrollY={undefined}
		>
			<p>Fabricated chat</p>
		</SessionTileFrame>
	);
}
function ownership() {
	return {
		shell: document.querySelector("[data-route-tile-shell]")?.getAttribute("data-route-tile-shell") ?? null,
		owners: [...document.querySelectorAll('[data-scroll-restoration-id="main"]')].map((node) => ({
			tag: node.tagName,
			home: node.hasAttribute("data-home-body"),
			chat: node.hasAttribute("data-session-scrollport"),
		})),
	};
}
it("actual root selects home/chat shells while source, subagents, and ordinary routes keep main", async () => {
	vi.stubGlobal("scrollTo", () => {});
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	clients.push(client);
	client.setQueryData(localAccountQueryOptions.queryKey, {name: "Alice", firstName: "Alice", initial: "A"});
	const root = createRootRouteWithContext<{queryClient: QueryClient}>()({component: RootRoute.options.component!});
	const home = createRoute({
		getParentRoute: () => root,
		path: "/",
		staticData: HomeRoute.options.staticData!,
		component: () => (
			<HomePage>
				<p>Fabricated home</p>
			</HomePage>
		),
	});
	const chat = createRoute({
		getParentRoute: () => root,
		path: "/session/$id",
		staticData: SessionRoute.options.staticData!,
		component: Chat,
	});
	const source = createRoute({
		getParentRoute: () => root,
		path: "/session/$id/source/$uuid",
		staticData: SourceRoute.options.staticData ?? {},
		component: () => <p>Fabricated source</p>,
	});
	const subagents = createRoute({
		getParentRoute: () => root,
		path: "/session/$id/subagents",
		staticData: SubagentsRoute.options.staticData ?? {},
		component: () => <p>Fabricated subagents</p>,
	});
	const plans = createRoute({getParentRoute: () => root, path: "/plans", component: () => <p>Fabricated plans</p>});
	const router = createRouter({
		routeTree: root.addChildren([home, chat, source, subagents, plans]),
		history: createMemoryHistory({initialEntries: ["/"]}),
		context: {queryClient: client},
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByText("Fabricated home");
	const states = [ownership()];
	for (const to of [
		"/session/alice",
		"/session/alice/source/example-message",
		"/session/alice/subagents",
		"/plans",
	]) {
		await act(() => router.navigate({to}));
		states.push(ownership());
	}
	expect(states).toStrictEqual([
		{shell: "home", owners: [{tag: "DIV", home: true, chat: false}]},
		{shell: "session", owners: [{tag: "DIV", home: false, chat: true}]},
		...Array.from({length: 3}, () => ({shell: null, owners: [{tag: "MAIN", home: false, chat: false}]})),
	]);
});
