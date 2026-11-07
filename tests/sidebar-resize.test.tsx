// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsProvider} from "../src/components/settings-provider";
import {DEFAULTS} from "../src/components/settings-context";
import {Sidebar} from "../src/components/sidebar/Sidebar";
import {readSidebarState, useSidebarState} from "../src/lib/sidebar-store";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {activeSessionsQueryOptions} from "../src/lib/api/sessions";
import {installLocalStorage} from "./fake-storage";
import {NAV_SECTIONS} from "../src/lib/nav-sections";
import {ToastProvider} from "../src/components/toast";
import {RESIZE_LINE_PILL, resizePillClass} from "../src/components/ui/resize-pill";
import {PanelsOff} from "./fizzy-lake-off";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

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

function StoreBackedSidebar() {
	const {collapsed} = useSidebarState();
	return <Sidebar collapsed={collapsed} />;
}

async function renderSidebar(panelsOff = false): Promise<HTMLElement> {
	const queryClient = seedQueryClient();
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SettingsProvider>
						{panelsOff ? (
							<PanelsOff>
								<StoreBackedSidebar />
							</PanelsOff>
						) : (
							<StoreBackedSidebar />
						)}
						<Outlet />
					</SettingsProvider>
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	const handle = await waitFor(() => screen.getByRole("separator", {name: "Resize sidebar"}));
	const capturedPointers = new Set<number>();
	Object.assign(handle, {
		setPointerCapture: vi.fn<HTMLElement["setPointerCapture"]>((pointerId) => {
			capturedPointers.add(pointerId);
		}),
		releasePointerCapture: vi.fn<HTMLElement["releasePointerCapture"]>((pointerId) => {
			capturedPointers.delete(pointerId);
		}),
		hasPointerCapture: vi.fn<HTMLElement["hasPointerCapture"]>((pointerId) => capturedPointers.has(pointerId)),
	});
	return handle;
}

describe("sidebar resize handle", () => {
	beforeEach(() => {
		installLocalStorage();
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("shows no tooltip and is upstream's cds ResizeHandle with the 2px accent line pill, half-clipped at rest", async () => {
		const handle = await renderSidebar();
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});

		fireEvent.pointerEnter(handle);
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		const pill = handle.querySelector<HTMLElement>("[data-cds-part=resize-pill]");

		expect({
			tooltip: screen.queryByRole("tooltip"),
			describedBy: handle.getAttribute("aria-describedby"),
			triggerDisabled: handle.getAttribute("data-trigger-disabled"),
			cds: handle.dataset["cds"],
			tabIndex: handle.tabIndex,
			classes: [...handle.classList].toSorted(),
			ring: handle.firstElementChild?.classList.contains("group-focus-visible/resize:shadow-focus"),
			pill: pill?.getAttribute("class"),
		}).toStrictEqual({
			tooltip: null,
			describedBy: null,
			triggerDisabled: "",
			cds: "ResizeHandle",
			tabIndex: 0,
			classes: [
				"cds-reset group/resize outline-none focus-visible:outline-hidden w-3 cursor-col-resize absolute z-10",
				"inset-y-0 end-[calc(-6px_-_(var(--cds-ring-outer,0px)_-_var(--cds-ring-inner,0px))_/_2)]",
				"[clip-path:inset(0_0_0_37.5%)] [&:where(:root[dir=rtl]_:dir(rtl))]:[clip-path:inset(0_37.5%_0_0)] focus-visible:[clip-path:none]",
			]
				.join(" ")
				.split(" ")
				.toSorted(),
			ring: true,
			pill: resizePillClass(RESIZE_LINE_PILL, "vertical", false),
		});
	});

	it("shows no tooltip with panels off either", async () => {
		const handle = await renderSidebar(true);
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
		fireEvent.pointerEnter(handle);
		fireEvent.focus(handle);
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect({
			tooltip: screen.queryByRole("tooltip"),
			describedBy: handle.getAttribute("aria-describedby"),
		}).toStrictEqual({tooltip: null, describedBy: null});
	});

	it("marks data-dragging while a drag runs", async () => {
		const handle = await renderSidebar();
		fireEvent.pointerDown(handle, {clientX: 288, pointerId: 1});
		const during = handle.dataset["dragging"];
		fireEvent.pointerUp(handle, {clientX: 288, pointerId: 1});
		expect(during).toBe("");
	});

	it("hides the sidebar on Enter, like a click", async () => {
		const handle = await renderSidebar();
		fireEvent.keyDown(handle, {key: "Enter"});
		expect(readSidebarState().collapsed).toBe(true);
	});

	it("collapses the sidebar on a click that stays within the drag threshold", async () => {
		const handle = await renderSidebar();

		fireEvent.pointerDown(handle, {clientX: 288, pointerId: 1});
		fireEvent.pointerMove(handle, {clientX: 290, pointerId: 1});
		fireEvent.pointerUp(handle, {clientX: 290, pointerId: 1});

		expect({
			state: readSidebarState(),
			separator: screen.queryByRole("separator", {name: "Resize sidebar"}),
		}).toStrictEqual({
			state: {collapsed: true, collapsedFamilies: [], collapsedGroups: [], width: 288},
			separator: null,
		});
	});

	it("resizes on a 40px drag without collapsing", async () => {
		const handle = await renderSidebar();

		fireEvent.pointerDown(handle, {clientX: 288, pointerId: 1});
		fireEvent.pointerMove(handle, {clientX: 328, pointerId: 1});
		fireEvent.pointerUp(handle, {clientX: 328, pointerId: 1});

		expect({
			collapsed: readSidebarState().collapsed,
			width: readSidebarState().width,
			now: handle.getAttribute("aria-valuenow"),
		}).toStrictEqual({collapsed: false, width: 328, now: "328"});
	});

	it("keeps the keyboard steps", async () => {
		const handle = await renderSidebar();

		fireEvent.keyDown(handle, {key: "ArrowLeft"});
		fireEvent.keyDown(handle, {key: "End"});

		expect({collapsed: readSidebarState().collapsed, width: readSidebarState().width}).toStrictEqual({
			collapsed: false,
			width: 420,
		});
	});

	function setInnerWidth(width: number): void {
		vi.spyOn(window, "innerWidth", "get").mockReturnValue(width);
	}

	it("caps End and drag at innerWidth - 330 on a 700px window, like upstream", async () => {
		setInnerWidth(700);
		const handle = await renderSidebar();

		fireEvent.keyDown(handle, {key: "End"});
		const afterEnd = readSidebarState().width;
		fireEvent.keyDown(handle, {key: "Home"});
		fireEvent.pointerDown(handle, {clientX: 232, pointerId: 1});
		fireEvent.pointerMove(handle, {clientX: 600, pointerId: 1});
		fireEvent.pointerUp(handle, {clientX: 600, pointerId: 1});

		expect({
			afterEnd,
			afterDrag: readSidebarState().width,
			max: handle.getAttribute("aria-valuemax"),
		}).toStrictEqual({afterEnd: 370, afterDrag: 370, max: "370"});
	});

	it("keeps the 420 ceiling on a 1400px window", async () => {
		setInnerWidth(1400);
		const handle = await renderSidebar();

		fireEvent.keyDown(handle, {key: "End"});

		expect({width: readSidebarState().width, max: handle.getAttribute("aria-valuemax")}).toStrictEqual({
			width: 420,
			max: "420",
		});
	});

	it("never caps below the 232 floor on a tiny window", async () => {
		setInnerWidth(500);
		const handle = await renderSidebar();

		fireEvent.keyDown(handle, {key: "End"});

		expect({width: readSidebarState().width, max: handle.getAttribute("aria-valuemax")}).toStrictEqual({
			width: 232,
			max: "232",
		});
	});

	it("recomputes the cap when the window resizes", async () => {
		setInnerWidth(1400);
		const handle = await renderSidebar();

		setInnerWidth(700);
		act(() => {
			window.dispatchEvent(new Event("resize"));
		});
		fireEvent.keyDown(handle, {key: "End"});

		expect({width: readSidebarState().width, max: handle.getAttribute("aria-valuemax")}).toStrictEqual({
			width: 370,
			max: "370",
		});
	});
});
