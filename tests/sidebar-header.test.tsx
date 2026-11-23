// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsProvider} from "../src/components/settings-provider";
import {DEFAULTS} from "../src/components/settings-context";
import {NavScroll} from "../src/components/sidebar/nav-scroll";
import {Sidebar} from "../src/components/sidebar/Sidebar";
import {readSidebarState} from "../src/lib/sidebar-store";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {activeSessionsQueryOptions} from "../src/lib/api/sessions";
import {installLocalStorage} from "./fake-storage";
import {PanelsOff} from "./fizzy-lake-off";
import {NAV_SECTIONS} from "../src/lib/nav-sections";
import {ToastProvider} from "../src/components/toast";

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

async function renderSidebar({
	panelsOff = false,
}:
{
	panelsOff?: boolean;
} = {})
{
	const queryClient = seedQueryClient();
	const rootRoute = createRootRoute(
		{
			component: () => (
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<SettingsProvider>
							{panelsOff ? (
								<PanelsOff>
									<Sidebar collapsed={false} />
								</PanelsOff>
							) : (
								<Sidebar collapsed={false} />
							)}
							<Outlet />
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
}

afterEach(cleanup);

beforeEach(() =>
{
	installLocalStorage();
});

describe("sidebar header", () =>
{
	it("puts the Hide sidebar toggle first, followed by the wordmark linking home", async () =>
	{
		await renderSidebar();

		const toggle = await waitFor(() =>
			screen.getByRole(
				"button",
				{
					name: "Hide sidebar",
				},
			),
		);
		const header = screen.getByTestId("sidebar-titlebar");
		const wordmark = screen.getByRole(
			"link",
			{
				name: "Claude Code Browser",
			},
		);

		const newRow = screen.getByRole(
			"link",
			{
				name: "New",
			},
		);
		expect(
			{
				titlebarH: header.classList.contains("h-[45px]") && header.classList.contains("touch:h-12"),
				titlebarMb: header.classList.contains("-mb-1"),
				spacer: header.nextElementSibling?.outerHTML,
				newRowMt: newRow.classList.contains("mt-1"),
				newIcon: [
					newRow.querySelector(":scope > .df-leading-slot > svg")?.getAttribute("data-cds"),
					newRow.querySelector<SVGElement>(":scope > .df-leading-slot > svg")?.style.fontSize,
					newRow.querySelector(":scope > .df-leading-slot > svg")?.getAttribute("stroke-width"),
				],
				newCircle: newRow.querySelector(".df-new-icon-circle"),
			},
		).toStrictEqual(
			{
				titlebarH: true,
				titlebarMb: true,
				spacer: '<div aria-hidden="true" class="h-1 shrink-0"></div>',
				newRowMt: true,
				// Upstream: a bare Add Icon in .df-leading-slot at auto (20px in the comfortable sidebar), no circle.
				newIcon: ["Icon", "calc(1.25rem * var(--cds-rem-scale, 1))", "1.5"],
				newCircle: null,
			},
		);
		expect(header.firstElementChild?.contains(toggle)).toBe(true);
		expect(header.children[1]?.contains(wordmark)).toBe(true);
		expect(
			{
				text: wordmark.textContent,
				href: wordmark.getAttribute("href"),
			},
		).toEqual(
			{
				text: "Claude Code Browser",
				href: "/",
			},
		);
	});
});

describe("sidebar resize handle", () =>
{
	it.each([
		{
			panelsOff: false,
		},
		{
			panelsOff: true,
		},
	])(
		"renders no tooltip on hover whatever fizzy-lake parts are on (panelsOff: $panelsOff), marked data-trigger-disabled",
		async ({panelsOff}) =>
		{
			await renderSidebar(
				{
					panelsOff,
				},
			);
			const handle = await waitFor(() =>
				screen.getByRole(
					"separator",
					{
						name: "Resize sidebar",
					},
				),
			);
			vi.useFakeTimers();
			try
			{
				fireEvent.pointerEnter(handle);
				act(() =>
				{
					vi.advanceTimersByTime(1000);
				});
				expect(
					{
						tooltip: screen.queryByRole("tooltip"),
						triggerDisabled: handle.getAttribute("data-trigger-disabled"),
					},
				).toStrictEqual(
					{
						tooltip: null,
						triggerDisabled: "",
					},
				);
			}
			finally
			{
				vi.useRealTimers();
			}
		},
	);

	it("persists the width to the sidebar store and exposes it as --sidebar-width", async () =>
	{
		await renderSidebar();
		const handle = await waitFor(() =>
			screen.getByRole(
				"separator",
				{
					name: "Resize sidebar",
				},
			),
		);
		const nav = screen.getByRole(
			"navigation",
			{
				name: "Sidebar",
			},
		);

		expect(
			{
				now: handle.getAttribute("aria-valuenow"),
				cssVar: nav.style.getPropertyValue("--sidebar-width"),
				insideNav: nav.contains(handle),
			},
		).toStrictEqual(
			{
				now: "288",
				cssVar: "288px",
				insideNav: true,
			},
		);

		fireEvent.keyDown(
			handle,
			{
				key: "ArrowRight",
			},
		);

		expect(
			{
				now: handle.getAttribute("aria-valuenow"),
				cssVar: nav.style.getPropertyValue("--sidebar-width"),
				stored: readSidebarState().width,
			},
		).toStrictEqual(
			{
				now: "296",
				cssVar: "296px",
				stored: 296,
			},
		);
	});
});

describe("nav scroll", () =>
{
	it("keeps a stable thin scrollbar gutter like upstream", () =>
	{
		render(
			<NavScroll>
				<div>content</div>
			</NavScroll>,
		);

		const classes = screen.getByTestId("nav-scroll").className.split(" ");
		expect(classes.filter((token) => token.startsWith("[scrollbar-"))).toStrictEqual([
			"[scrollbar-gutter:stable]",
			"[scrollbar-width:thin]",
		]);
	});

	it("writes upstream's --df-nav-scrollbar-lane (offsetWidth - clientWidth) on mount and on each resize", () =>
	{
		let clientWidth = 283;
		const callbacks: ResizeObserverCallback[] = [];
		Object.defineProperty(
			HTMLElement.prototype,
			"offsetWidth",
			{
				configurable: true,
				get: () => 283,
			},
		);
		Object.defineProperty(
			HTMLElement.prototype,
			"clientWidth",
			{
				configurable: true,
				get: () => clientWidth,
			},
		);
		Reflect.set(
			globalThis,
			"ResizeObserver",
			class
			{
				constructor(callback: ResizeObserverCallback)
				{
					callbacks.push(callback);
				}

				observe(): void
				{
				}

				disconnect(): void
				{
				}
			},
		);
		const {unmount} = render(
			<NavScroll>
				<div>content</div>
			</NavScroll>,
		);
		const scroller = screen.getByTestId("nav-scroll");
		const lanes = [scroller.style.getPropertyValue("--df-nav-scrollbar-lane")];
		clientWidth = 272;
		for (const callback of callbacks) callback([], {} as ResizeObserver);
		lanes.push(scroller.style.getPropertyValue("--df-nav-scrollbar-lane"));
		unmount();
		expect(lanes).toStrictEqual(["0px", "11px"]);
	});

	it("sets data-scrolled on the parent df-nav-scroll-box only once scrolled more than 2px, like upstream's L$", () =>
	{
		render(
			<div className="df-nav-scroll-box">
				<NavScroll>
					<div>content</div>
				</NavScroll>
			</div>,
		);
		const scroller = screen.getByTestId("nav-scroll");
		const box = scroller.parentElement!;
		const states:
		{
			box: boolean;
			scroller: boolean;
		}[] = [];
		const record = (): void =>
		{
			states.push(
				{
					box: box.hasAttribute("data-scrolled"),
					scroller: scroller.hasAttribute("data-scrolled"),
				},
			);
		};
		record();
		for (const top of [2, 3, 40, 0])
		{
			act(() =>
			{
				scroller.scrollTop = top;
				fireEvent.scroll(scroller);
			});
			record();
		}
		expect(
			{
				states,
				maskTokens: scroller.className.split(" ").filter((token) => token.includes("mask-image")),
			},
		).toStrictEqual(
			{
				states: [
					{
						box: false,
						scroller: false,
					},
					{
						box: false,
						scroller: false,
					},
					{
						box: true,
						scroller: false,
					},
					{
						box: true,
						scroller: false,
					},
					{
						box: false,
						scroller: false,
					},
				],
				maskTokens: [],
			},
		);
	});
});
