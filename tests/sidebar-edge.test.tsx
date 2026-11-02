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
import {PHONE_SHEET_QUERY} from "../src/lib/use-phone-sheet";
import {installLocalStorage} from "./fake-storage";
import {PanelsOff} from "./fizzy-lake-off";
import {RESIZE_LINE_PILL, resizePillClass} from "../src/components/ui/resize-pill";

function seedQueryClient(): QueryClient
{
	const queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
					staleTime: Infinity,
					gcTime: Infinity,
					refetchOnMount: false,
				},
			},
		},
	);
	queryClient.setQueryData(
		approvalsQueryOptions().queryKey,
		{
			approvals: [],
		},
	);
	queryClient.setQueryData(
		notificationsQueryOptions().queryKey,
		{
			notifications: [],
		},
	);
	queryClient.setQueryData(activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey, []);
	queryClient.setQueryData(
		applicationSettingsQueryOptions.queryKey,
		{
			terminalWritesEnabled: false,
			terminalHost: "auto",
			shellPaneEnabled: true,
			visibleNavSections: NAV_SECTIONS.filter((section) => section !== "herdr"),
			ignoredDirs: ["node_modules"],
		},
	);
	return queryClient;
}

/** Evaluates a `(max-width: Npx)` query against the mocked width, as the browser would. */
function matchesMaxWidth(query: string, width: number): boolean
{
	const match = /^\(max-width: (\d+)px\)$/.exec(query);
	return match !== null && width <= Number(match[1]);
}

function mockViewport(width: number)
{
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => (
		{
			matches: query === PHONE_SHEET_QUERY ? width < 640 : matchesMaxWidth(query, width),
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

function PersistedFrame()
{
	const {collapsed} = useSidebarState();
	return (
		<AppFrame collapsed={collapsed}>
			<p>content</p>
		</AppFrame>
	);
}

async function renderFrame({
	collapsed,
	width = 1440,
	panelsOff = false,
}: {
	collapsed: boolean;
	width?: number;
	panelsOff?: boolean;
})
{
	mockViewport(width);
	writeSidebarState(
		{
			...readSidebarState(),
			collapsed,
		},
	);
	const queryClient = seedQueryClient();
	const rootRoute = createRootRoute(
		{
			component: () => (
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<SettingsProvider>
							{panelsOff ? (
								<PanelsOff>
									<PersistedFrame />
								</PanelsOff>
							) : (
								<PersistedFrame />
							)}
						</SettingsProvider>
					</ToastProvider>
				</QueryClientProvider>
			),
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute,
			history: createMemoryHistory(
				{
					initialEntries: ["/"],
				},
			),
		},
	);
	await router.load();
	render(<RouterProvider router={router} />);
	await waitFor(() => screen.getByText("content"));
}

function edgeHandle(): HTMLElement | null
{
	return document.querySelector<HTMLElement>('[data-sidebar-edge][role="separator"]');
}

beforeEach(() =>
{
	installLocalStorage();
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("collapsed sidebar edge handle", () =>
{
	it("renders upstream's 8px Resize sidebar separator at the frame's left edge when collapsed", async () =>
	{
		await renderFrame(
			{
				collapsed: true,
			},
		);
		const edge = screen.getByRole(
			"separator",
			{
				name: "Resize sidebar",
			},
		);
		expect(edge).toBe(edgeHandle());
		expect(
			{
				orientation: edge.getAttribute("aria-orientation"),
				now: edge.getAttribute("aria-valuenow"),
				min: edge.getAttribute("aria-valuemin"),
				max: edge.getAttribute("aria-valuemax"),
				tabIndex: edge.tabIndex,
			},
		).toStrictEqual(
			{
				orientation: "vertical",
				now: "0",
				min: "0",
				max: "420",
				tabIndex: 0,
			},
		);
		expect(edge.className.split(/\s+/)).toEqual(
			expect.arrayContaining(["absolute", "inset-y-0", "left-0", "w-2", "z-[21]", "cursor-col-resize"]),
		);
		expect(screen.getByTestId("app-frame").firstElementChild).toBe(edge);
	});

	it("draws upstream's panels resize line: a full-height 2px accent line, 3px and rounded when focus-visible", async () =>
	{
		await renderFrame(
			{
				collapsed: true,
			},
		);
		const pill = edgeHandle()?.querySelector<HTMLElement>("[data-cds-part=resize-pill]");
		expect(
			{
				part: pill?.getAttribute("data-cds-part"),
				classes: pill?.className.split(/\s+/).toSorted(),
			},
		).toStrictEqual(
			{
				part: "resize-pill",
				classes: [
					"[--resize-line:2px]",
					"absolute",
					"bg-fill-accent",
					"delay-100",
					"duration-200",
					"group-focus-visible/resize:[--resize-line:3px]",
					"group-focus-visible/resize:delay-0",
					"group-focus-visible/resize:opacity-100",
					"group-focus-visible/resize:rounded-full",
					"group-hover/resize:opacity-100",
					"inset-y-0",
					"my-auto",
					"opacity-[var(--cds-resize-pill-force,0)]",
					"start-[calc(50%_-_var(--resize-line)_/_2)]",
					"transition-opacity",
					"w-[var(--resize-line)]",
				],
			},
		);
	});

	it("does not render when expanded", async () =>
	{
		await renderFrame(
			{
				collapsed: false,
			},
		);
		expect(edgeHandle()).toBeNull();
	});

	it("does not render in the narrow viewport band", async () =>
	{
		await renderFrame(
			{
				collapsed: false,
				width: 700,
			},
		);
		expect(edgeHandle()).toBeNull();
	});

	it.each([
		{
			panelsOff: false,
		},
		{
			panelsOff: true,
		},
	])(
		"renders no tooltip whatever fizzy-lake parts are on (panelsOff: $panelsOff): the separator sits directly in the frame, marked data-trigger-disabled",
		async ({panelsOff}) =>
		{
			await renderFrame(
				{
					collapsed: true,
					panelsOff,
				},
			);
			vi.useFakeTimers();
			const edge = edgeHandle();
			if (!edge) throw new Error("edge handle missing");
			fireEvent.pointerEnter(edge);
			act(() =>
			{
				vi.advanceTimersByTime(1000);
			});
			expect(
				{
					tooltip: screen.queryByRole("tooltip"),
					parent: edge.parentElement === screen.getByTestId("app-frame"),
					triggerDisabled: edge.getAttribute("data-trigger-disabled"),
				},
			).toStrictEqual(
				{
					tooltip: null,
					parent: true,
					triggerDisabled: "",
				},
			);
		},
	);
});

describe("collapsed sidebar edge click, drag-out and keyboard", () =>
{
	function requireEdge(): HTMLElement
	{
		const edge = edgeHandle();
		if (!edge) throw new Error("edge handle missing");
		return edge;
	}

	function press(clientX: number)
	{
		fireEvent.pointerDown(
			requireEdge(),
			{
				button: 0,
				clientX,
				pointerId: 1,
				pointerType: "mouse",
			},
		);
	}

	function move(clientX: number)
	{
		fireEvent.pointerMove(
			window,
			{
				clientX,
				pointerId: 1,
				pointerType: "mouse",
			},
		);
	}

	function release(clientX: number)
	{
		fireEvent.pointerUp(
			window,
			{
				clientX,
				pointerId: 1,
				pointerType: "mouse",
			},
		);
	}

	it("expands on a press that moves less than 3px, without moving focus", async () =>
	{
		await renderFrame(
			{
				collapsed: true,
			},
		);
		const focused = document.activeElement;
		press(3);
		release(4);
		expect(readSidebarState().collapsed).toBe(false);
		expect(document.activeElement).toBe(focused);
	});

	it("ignores non-primary buttons", async () =>
	{
		await renderFrame(
			{
				collapsed: true,
			},
		);
		fireEvent.pointerDown(
			requireEdge(),
			{
				button: 2,
				clientX: 3,
				pointerId: 1,
				pointerType: "mouse",
			},
		);
		release(3);
		expect(readSidebarState().collapsed).toBe(true);
	});

	it("stays collapsed after a drag shorter than half the sidebar floor", async () =>
	{
		await renderFrame(
			{
				collapsed: true,
			},
		);
		press(3);
		move(80);
		expect(screen.getByTestId("app-frame").hasAttribute("data-resizing")).toBe(true);
		release(80);
		expect(readSidebarState().collapsed).toBe(true);
		expect(screen.getByTestId("app-frame").hasAttribute("data-resizing")).toBe(false);
	});

	it("lights the pill in its dragging state and marks data-dragging while a short drag runs", async () =>
	{
		await renderFrame(
			{
				collapsed: true,
			},
		);
		press(3);
		const edge = requireEdge();
		const pill = edge.querySelector("[data-cds-part=resize-pill]");
		const during =
		{
			dragging: edge.dataset["dragging"],
			pill: pill?.getAttribute("class"),
		};
		release(3);
		expect(during).toStrictEqual(
			{
				dragging: "",
				pill: resizePillClass(RESIZE_LINE_PILL, "vertical", true),
			},
		);
	});

	it("expands live once the drag reaches half the floor and commits the dragged width", async () =>
	{
		await renderFrame(
			{
				collapsed: true,
			},
		);
		press(3);
		move(200);
		expect(readSidebarState().collapsed).toBe(false);
		expect(screen.getByTestId("app-frame").hasAttribute("data-resizing")).toBe(true);
		move(291);
		release(291);
		expect(
			{
				collapsed: readSidebarState().collapsed,
				width: readSidebarState().width,
			},
		).toStrictEqual(
			{
				collapsed: false,
				width: 288,
			},
		);
		expect(screen.getByTestId("app-frame").hasAttribute("data-resizing")).toBe(false);
	});

	it("clamps the dragged width to the floor and to min(420, innerWidth - 330)", async () =>
	{
		await renderFrame(
			{
				collapsed: true,
			},
		);
		press(3);
		move(150);
		expect(readSidebarState().width).toBe(232);
		move(1000);
		release(1000);
		expect(readSidebarState().width).toBe(Math.min(420, window.innerWidth - 330));
	});

	it("re-collapses live when the drag returns under the threshold", async () =>
	{
		await renderFrame(
			{
				collapsed: true,
			},
		);
		press(3);
		move(200);
		expect(readSidebarState().collapsed).toBe(false);
		move(50);
		expect(readSidebarState().collapsed).toBe(true);
		release(50);
		expect(readSidebarState().collapsed).toBe(true);
	});

	it("expands on ArrowRight and moves focus to Hide sidebar", async () =>
	{
		await renderFrame(
			{
				collapsed: true,
			},
		);
		const edge = requireEdge();
		edge.focus();
		fireEvent.keyDown(
			edge,
			{
				key: "ArrowRight",
			},
		);
		expect(readSidebarState().collapsed).toBe(false);
		await waitFor(() =>
		{
			expect(document.activeElement?.getAttribute("aria-label")).toBe("Hide sidebar");
		});
	});

	it("does nothing on ArrowLeft, Home or End", async () =>
	{
		await renderFrame(
			{
				collapsed: true,
			},
		);
		const edge = requireEdge();
		for (const key of ["ArrowLeft", "Home", "End"])
		{
			expect(
				fireEvent.keyDown(
					edge,
					{
						key,
					},
				),
			).toBe(true);
		}
		expect(readSidebarState().collapsed).toBe(true);
	});
});
