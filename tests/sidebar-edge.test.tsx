// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {AppFrame} from "../src/components/app-frame";
import {SettingsProvider} from "../src/components/settings-provider";
import {DEFAULTS} from "../src/components/settings-context";
import {ToastProvider} from "../src/components/toast";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {activeSessionsQueryOptions} from "../src/lib/api/sessions";
import {NAV_SECTIONS} from "../src/lib/nav-sections";
import {readSidebarState, useSidebarState, writeSidebarState} from "../src/lib/sidebar-store";
import {NARROW_VIEWPORT_QUERY, PHONE_SHEET_QUERY} from "../src/lib/use-phone-sheet";
import {installLocalStorage} from "./fake-storage";

function seedQueryClient(): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(approvalsQueryOptions().queryKey, {approvals: []});
	queryClient.setQueryData(notificationsQueryOptions().queryKey, {notifications: []});
	queryClient.setQueryData(activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey, []);
	queryClient.setQueryData(applicationSettingsQueryOptions.queryKey, {
		terminalWritesEnabled: false,
		terminalHost: "auto",
		shellPaneEnabled: true,
		visibleNavSections: NAV_SECTIONS.filter((section) => section !== "herdr"),
		ignoredDirs: ["node_modules"],
	});
	return queryClient;
}

function mockViewport(width: number) {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: query === PHONE_SHEET_QUERY ? width < 640 : query === NARROW_VIEWPORT_QUERY ? width < 768 : false,
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
}

function PersistedFrame() {
	const {collapsed} = useSidebarState();
	return (
		<AppFrame collapsed={collapsed}>
			<p>content</p>
		</AppFrame>
	);
}

async function renderFrame({collapsed, width = 1440}: {collapsed: boolean; width?: number}) {
	mockViewport(width);
	writeSidebarState({...readSidebarState(), collapsed});
	const queryClient = seedQueryClient();
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SettingsProvider>
						<PersistedFrame />
					</SettingsProvider>
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({routeTree: rootRoute, history: createMemoryHistory({initialEntries: ["/"]})});
	await router.load();
	render(<RouterProvider router={router} />);
	await waitFor(() => screen.getByText("content"));
}

function edgeHandle(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-sidebar-edge][role="separator"]');
}

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("collapsed sidebar edge handle", () => {
	it("renders upstream's 8px Resize sidebar separator at the frame's left edge when collapsed", async () => {
		await renderFrame({collapsed: true});
		const edge = screen.getByRole("separator", {name: "Resize sidebar"});
		expect(edge).toBe(edgeHandle());
		expect({
			orientation: edge.getAttribute("aria-orientation"),
			now: edge.getAttribute("aria-valuenow"),
			min: edge.getAttribute("aria-valuemin"),
			max: edge.getAttribute("aria-valuemax"),
			tabIndex: edge.tabIndex,
		}).toStrictEqual({orientation: "vertical", now: "0", min: "0", max: "420", tabIndex: 0});
		expect(edge.className.split(/\s+/)).toEqual(
			expect.arrayContaining(["absolute", "inset-y-0", "left-0", "w-2", "z-[21]", "cursor-col-resize"]),
		);
		expect(screen.getByTestId("app-frame").firstElementChild?.contains(edge)).toBe(true);
	});

	it("gives the grip pill upstream's 200ms hover delay and 48px cap", async () => {
		await renderFrame({collapsed: true});
		const pill = edgeHandle()?.querySelector<HTMLElement>("[data-resize-pill]");
		expect(pill?.className.split(/\s+/)).toEqual(
			expect.arrayContaining([
				"delay-200",
				"max-h-12",
				"w-[3px]",
				"text-ink-muted",
				"opacity-0",
				"group-hover/resize:opacity-100",
				"group-focus-visible/resize:max-h-none",
				"group-focus-visible/resize:bg-accent-100",
				"group-focus-visible/resize:delay-0",
			]),
		);
	});

	it("does not render when expanded", async () => {
		await renderFrame({collapsed: false});
		expect(edgeHandle()).toBeNull();
	});

	it("does not render in the narrow viewport band", async () => {
		await renderFrame({collapsed: false, width: 700});
		expect(edgeHandle()).toBeNull();
	});

	it("shows Show sidebar ⌘B / Drag to resize on hover", async () => {
		await renderFrame({collapsed: true});
		vi.useFakeTimers();
		const edge = edgeHandle();
		if (!edge) throw new Error("edge handle missing");
		fireEvent.pointerEnter(edge);
		act(() => {
			vi.advanceTimersByTime(300);
		});
		const tooltip = screen.getByRole("tooltip");
		expect(tooltip.textContent).toContain("Show sidebar");
		expect(tooltip.textContent).toContain("Drag to resize");
	});
});
