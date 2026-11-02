// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import
{
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {createElement} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {herdrWorkspacesQueryOptions} from "../src/lib/api/herdr-workspaces";
import {sessionQueryKeys} from "../src/lib/api/sessions";
import {terminalPlacementsQueryOptions} from "../src/lib/api/terminal-placements";
import {updateSessionViewedState} from "../src/lib/api/viewed-state";
import {legacyTerminalPageRedirect} from "../src/lib/legacy-terminals-redirect";
import {redirectLegacyHerdr} from "../src/routes/herdr";
import {redirectLegacyTmux} from "../src/routes/tmux";
import {Route as HerdrLayoutRoute} from "../src/routes/terminals";
import {Route as HerdrRoute} from "../src/routes/terminals.index";
import {Route as HerdrTerminalRoute} from "../src/routes/terminals.$sessionId";
import {Route as HerdrPaneTerminalRoute} from "../src/routes/terminals.pane.$paneId";
import {herdrTerminalsQueryOptions, type HerdrTerminalWorkspaceData} from "../src/lib/api/herdr-terminals";

vi.mock("../src/components/herdr-terminal", () => (
{
	HerdrTerminal: ({sessionId, paneId, interactive}: {sessionId?: string; paneId?: string; interactive?: boolean}) => (
		<section
			aria-label="Live read-only terminal"
			data-interactive={String(interactive ?? false)}
			data-pane-id={paneId}
		>
			{sessionId ?? paneId}
		</section>
	),
}));

vi.mock("../src/lib/api/viewed-state", async (importOriginal) => (
{
	...(await importOriginal<typeof import("../src/lib/api/viewed-state")>()),
	updateSessionViewedState: vi.fn<typeof import("../src/lib/api/viewed-state").updateSessionViewedState>(),
}));

class FakeResizeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
}

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.mocked(updateSessionViewedState).mockReset();
	vi.restoreAllMocks();
});

const HERDR_ROW_COLUMNS =
	"grid grid-cols-[2.75rem_minmax(0,1fr)_5rem_8.5rem_2rem_9rem] items-center rounded-md border border-border max-sm:flex max-sm:flex-wrap max-sm:gap-x-2 max-sm:pb-2";
const HERDR_TERMINAL_COLUMNS =
	"grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1.5 rounded-md p-3 no-underline transition-colors hover:bg-surface-0 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus max-sm:order-first max-sm:basis-full max-sm:pb-1";
const HERDR_TRANSCRIPT_CELL =
	"flex size-8 items-center justify-center justify-self-center rounded-md text-t6 transition-colors hover:bg-surface-0 hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";
const HERDR_ACTION_CELL = "justify-self-end max-sm:ms-auto";

function placement({
	active,
	agentStatus,
	displayName,
	newMessageCount = 0,
	number,
	viewedAnywhere = true,
}: {
	active: boolean;
	agentStatus: string;
	displayName?: string;
	newMessageCount?: number;
	number: number;
	viewedAnywhere?: boolean;
})
{
	return {
		provider: "herdr" as const,
		sessionId: `session-test-${number}`,
		displayName: displayName ?? `Terminal ${number}`,
		active,
		paneHandle: `pane-test-${number}`,
		scopeHandle: `workspace-test-${number}`,
		capabilities:
		{
			supportsWrite: true,
			supportsEvents: true,
			supportsObserve: true,
		},
		herdrPane:
		{
			host: "herdr" as const,
			paneId: `pane-test-${number}`,
			terminalId: `terminal-test-${number}`,
			workspaceId: `workspace-test-${number}`,
			tabId: `tab-test-${number}`,
			focused: active,
			cwd: `/tmp/test/project-${number}`,
			foregroundCwd: `/tmp/test/project-${number}`,
			agentStatus,
			agent: "claude",
			terminalTitle: `Terminal ${number}`,
			agentSessionId: `session-test-${number}`,
			revision: number,
			sessionId: `session-test-${number}`,
			via: "both" as const,
			viewedState:
			{
				currentMessageIndex: number,
				lastViewedMessageIndex: number,
				reviewTargetMessageIndex: number,
				newMessageCount,
				viewedInCcp: viewedAnywhere,
				viewedInHerdr: viewedAnywhere,
				viewedAnywhere,
			},
		},
	};
}

async function renderHerdrPage(placements: ReturnType<typeof placement>[])
{
	const HerdrPage = HerdrRoute.options.component;
	if (!HerdrPage) throw new Error("Expected the Herdr route component");

	const queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	queryClient.setQueryData(
		terminalPlacementsQueryOptions.queryKey,
		{
			placements,
			writesEnabled: true,
		},
	);
	const rootRoute = createRootRoute(
		{
			component: () => <QueryClientProvider client={queryClient}>{createElement(HerdrPage)}</QueryClientProvider>,
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute,
			history: createMemoryHistory(
				{
					initialEntries: ["/terminals"],
				},
			),
		},
	);
	await router.load();
	render(<RouterProvider router={router} />);

	return queryClient;
}

/** Seeds what the pop-out reads to pick its tabs: herdr's panes and the Shell tabs setting. */
function seedTerminalQueries(
	queryClient: QueryClient,
	{
		livePane,
		writesEnabled,
	}:
	{
		livePane: boolean;
		writesEnabled: boolean;
	},
)
{
	queryClient.setQueryData(
		herdrPanesQueryOptions.queryKey,
		{
			panes: livePane
				? [
						placement(
							{
								active: true,
								agentStatus: "idle",
								number: 100,
							},
						).herdrPane,
					]
				: [],
			writesEnabled,
		},
	);
	queryClient.setQueryData(
		applicationSettingsQueryOptions.queryKey,
		{
			terminalWritesEnabled: writesEnabled,
			terminalHost: "auto",
			shellPaneEnabled: false,
			visibleNavSections: [],
			ignoredDirs: ["node_modules"],
		},
	);
}

async function renderTerminalPage({
	livePane = true,
	writesEnabled = false,
	paneId,
	host,
	workspaceId,
}:
{
	livePane?: boolean;
	writesEnabled?: boolean;
	paneId?: string;
	host?: "herdr" | "tmux";
	workspaceId?: string;
} = {})
{
	const HerdrTerminalPage = HerdrTerminalRoute.options.component;
	if (!HerdrTerminalPage) throw new Error("Expected the Herdr terminal route component");
	vi.spyOn(HerdrTerminalRoute, "useParams").mockReturnValue(
		{
			sessionId: "session-test-100",
		},
	);

	const queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	seedTerminalQueries(
		queryClient,
		{
			livePane,
			writesEnabled,
		},
	);
	if (paneId !== undefined || host !== undefined || workspaceId !== undefined)
	{
		const pane = placement(
			{
				active: true,
				agentStatus: "idle",
				number: 100,
			},
		).herdrPane;
		queryClient.setQueryData(
			herdrPanesQueryOptions.queryKey,
			{
				panes: [
					{
						...pane,
						paneId: paneId ?? pane.paneId,
						host: host ?? pane.host,
						workspaceId: workspaceId ?? pane.workspaceId,
					},
				],
				writesEnabled,
			},
		);
	}
	const rootRoute = createRootRoute(
		{
			component: () => (
				<QueryClientProvider client={queryClient}>{createElement(HerdrTerminalPage)}</QueryClientProvider>
			),
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute,
			history: createMemoryHistory(
				{
					initialEntries: ["/terminals/session-test-100"],
				},
			),
		},
	);
	await router.load();
	render(<RouterProvider router={router} />);
}

function routeMeta(route: typeof HerdrRoute | typeof HerdrTerminalRoute)
{
	const head = route.options.head as () =>
	{
		meta: Array<
		{
			title: string;
		}>;
	};
	return head().meta;
}

describe("HerdrPage", () =>
{
	it("shows contextual review actions without zero-count or reviewed-row chrome", async () =>
	{
		await renderHerdrPage([
			placement(
				{
					active: false,
					agentStatus: "done",
					newMessageCount: 3,
					number: 100,
					viewedAnywhere: false,
				},
			),
			placement(
				{
					active: false,
					agentStatus: "done",
					newMessageCount: 0,
					number: 200,
					viewedAnywhere: false,
				},
			),
			placement(
				{
					active: false,
					agentStatus: "idle",
					number: 300,
					viewedAnywhere: true,
				},
			),
		]);

		const positiveCountRow = screen.getByRole(
			"link",
			{
				name: "Open session transcript for Terminal 100",
			},
		).parentElement;
		const zeroCountRow = screen.getByRole(
			"link",
			{
				name: "Open session transcript for Terminal 200",
			},
		).parentElement;
		const reviewedRow = screen.getByRole(
			"link",
			{
				name: "Open session transcript for Terminal 300",
			},
		).parentElement;
		if (!positiveCountRow || !zeroCountRow || !reviewedRow)
		{
			throw new Error("Expected every Herdr transcript link to have a fleet row");
		}

		expect(
			{
				positiveCount:
				{
					marker: within(positiveCountRow).getByText("Needs review · 3 new").textContent,
					action: within(positiveCountRow).getByRole(
						"button",
						{
							name: "Mark reviewed",
						},
					).textContent,
				},
				zeroCount:
				{
					marker: within(zeroCountRow).getByText("Needs review").textContent,
					action: within(zeroCountRow).getByRole(
						"button",
						{
							name: "Mark reviewed",
						},
					).textContent,
				},
				reviewed:
				{
					marker: within(reviewedRow).queryByText(/Needs review/),
					markReviewedAction: within(reviewedRow).queryByRole(
						"button",
						{
							name: "Mark reviewed",
						},
					),
					markUnreviewedAction: within(reviewedRow).queryByRole(
						"button",
						{
							name: "Mark unreviewed",
						},
					),
				},
				zeroNewCopy: screen.queryByText(/0 new/),
				markUnreviewedActions: screen.queryAllByRole(
					"button",
					{
						name: "Mark unreviewed",
					},
				),
			},
		).toStrictEqual(
			{
				positiveCount:
				{
					marker: "Needs review · 3 new",
					action: "Mark reviewed",
				},
				zeroCount:
				{
					marker: "Needs review",
					action: "Mark reviewed",
				},
				reviewed:
				{
					marker: null,
					markReviewedAction: null,
					markUnreviewedAction: null,
				},
				zeroNewCopy: null,
				markUnreviewedActions: [],
			},
		);
	});

	it("gives every row the same fixed columns so only the title is variable-width", async () =>
	{
		await renderHerdrPage([
			placement(
				{
					active: true,
					agentStatus: "working",
					displayName: "✳ Teammate availability notification",
					newMessageCount: 2,
					number: 100,
					viewedAnywhere: false,
				},
			),
			placement(
				{
					active: false,
					agentStatus: "idle",
					displayName: "✓ kalshi",
					number: 200,
				},
			),
			placement(
				{
					active: false,
					agentStatus: "done",
					displayName: "claude-code-plans",
					number: 300,
				},
			),
		]);

		const rows = ["✳ Teammate availability notification", "✓ kalshi", "claude-code-plans"].map((displayName) =>
		{
			const row = screen.getByRole(
				"link",
				{
					name: `Open live read-only terminal for ${displayName}`,
				},
			).parentElement;
			if (!row) throw new Error(`Expected a fleet row for ${displayName}`);
			return row;
		});

		expect(
			rows.map((row) =>
			{
				const [host, terminal, status, review, transcript, action] = Array.from(row.children);
				const [, glyph, title] = Array.from(terminal?.children ?? []);
				return {
					host: host?.textContent,
					rowColumns: row.className,
					cells: row.children.length,
					terminalColumns: terminal?.className,
					glyph: glyph?.textContent,
					title: title?.textContent,
					status: status?.getAttribute("aria-label"),
					review: review?.textContent,
					transcript: transcript?.getAttribute("aria-label"),
					actionCell: action?.className,
				};
			}),
		).toStrictEqual([
			{
				host: "herdr",
				rowColumns: HERDR_ROW_COLUMNS,
				cells: 6,
				terminalColumns: HERDR_TERMINAL_COLUMNS,
				glyph: "✳",
				title: "Teammate availability notification",
				status: "Herdr agent status: working",
				review: "Needs review · 2 new",
				transcript: "Open session transcript for ✳ Teammate availability notification",
				actionCell: HERDR_ACTION_CELL,
			},
			{
				host: "herdr",
				rowColumns: HERDR_ROW_COLUMNS,
				cells: 6,
				terminalColumns: HERDR_TERMINAL_COLUMNS,
				glyph: "✓",
				title: "kalshi",
				status: "Herdr agent status: idle",
				review: "",
				transcript: "Open session transcript for ✓ kalshi",
				actionCell: HERDR_ACTION_CELL,
			},
			{
				host: "herdr",
				rowColumns: HERDR_ROW_COLUMNS,
				cells: 6,
				terminalColumns: HERDR_TERMINAL_COLUMNS,
				glyph: "",
				title: "claude-code-plans",
				status: "Herdr agent status: done",
				review: "",
				transcript: "Open session transcript for claude-code-plans",
				actionCell: HERDR_ACTION_CELL,
			},
		]);
	});

	it("marks an unseen session reviewed and invalidates its fleet and detail queries", async () =>
	{
		vi.mocked(updateSessionViewedState).mockResolvedValue(
			{
				currentMessageIndex: 100,
				lastViewedMessageIndex: 100,
				reviewTargetMessageIndex: 100,
				newMessageCount: 0,
				viewedInCcp: true,
				viewedInHerdr: true,
				viewedAnywhere: true,
			},
		);
		const queryClient = await renderHerdrPage([
			placement(
				{
					active: false,
					agentStatus: "done",
					newMessageCount: 3,
					number: 100,
					viewedAnywhere: false,
				},
			),
		]);
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Mark reviewed",
				},
			),
		);

		await waitFor(() =>
		{
			expect(
				{
					marker: screen.queryByText(/Needs review/),
					action: screen.queryByRole(
						"button",
						{
							name: "Mark reviewed",
						},
					),
					updateCalls: vi.mocked(updateSessionViewedState).mock.calls,
					invalidationCalls: invalidateQueries.mock.calls,
				},
			).toStrictEqual(
				{
					marker: null,
					action: null,
					updateCalls: [["session-test-100", "reviewed", 100]],
					invalidationCalls: [
						[
							{
								queryKey: ["terminal", "placements"],
							},
						],
						[
							{
								queryKey: sessionQueryKeys.detail("session-test-100"),
							},
						],
					],
				},
			);
		});
	});

	it("shows a retryable error when marking an unseen session reviewed fails", async () =>
	{
		vi.mocked(updateSessionViewedState)
			.mockRejectedValueOnce(new Error("fabricated review failure"))
			.mockResolvedValueOnce(
				{
					currentMessageIndex: 100,
					lastViewedMessageIndex: 100,
					reviewTargetMessageIndex: 100,
					newMessageCount: 0,
					viewedInCcp: true,
					viewedInHerdr: true,
					viewedAnywhere: true,
				},
			);
		const queryClient = await renderHerdrPage([
			placement(
				{
					active: false,
					agentStatus: "done",
					number: 100,
					viewedAnywhere: false,
				},
			),
		]);
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Mark reviewed",
				},
			),
		);
		expect((await screen.findByRole("alert")).textContent).toBe("Failed to mark reviewed");
		expect(
			{
				retryAction: screen.getByRole(
					"button",
					{
						name: "Retry mark reviewed",
					},
				).textContent,
				invalidationCalls: invalidateQueries.mock.calls,
			},
		).toStrictEqual(
			{
				retryAction: "Retry mark reviewed",
				invalidationCalls: [],
			},
		);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Retry mark reviewed",
				},
			),
		);

		await waitFor(() =>
		{
			expect(
				{
					error: screen.queryByRole("alert"),
					action: screen.queryByRole(
						"button",
						{
							name: /mark reviewed/i,
						},
					),
					updateCalls: vi.mocked(updateSessionViewedState).mock.calls,
					invalidationCalls: invalidateQueries.mock.calls,
				},
			).toStrictEqual(
				{
					error: null,
					action: null,
					updateCalls: [
						["session-test-100", "reviewed", 100],
						["session-test-100", "reviewed", 100],
					],
					invalidationCalls: [
						[
							{
								queryKey: ["terminal", "placements"],
							},
						],
						[
							{
								queryKey: sessionQueryKeys.detail("session-test-100"),
							},
						],
					],
				},
			);
		});
	});

	it("uses Herdr agent state rather than pane focus for each row's status color", async () =>
	{
		const HerdrPage = HerdrRoute.options.component;
		if (!HerdrPage) throw new Error("Expected the Herdr route component");

		const queryClient = new QueryClient(
			{
				defaultOptions:
				{
					queries:
					{
						retry: false,
					},
				},
			},
		);
		queryClient.setQueryData(
			terminalPlacementsQueryOptions.queryKey,
			{
				placements: [
					placement(
						{
							active: true,
							agentStatus: "blocked",
							number: 100,
						},
					),
					placement(
						{
							active: false,
							agentStatus: "working",
							number: 200,
						},
					),
				],
				writesEnabled: true,
			},
		);
		const rootRoute = createRootRoute(
			{
				component: () => (
					<QueryClientProvider client={queryClient}>{createElement(HerdrPage)}</QueryClientProvider>
				),
			},
		);
		const router = createRouter(
			{
				routeTree: rootRoute,
				history: createMemoryHistory(
					{
						initialEntries: ["/terminals"],
					},
				),
			},
		);
		await router.load();

		render(<RouterProvider router={router} />);

		expect(
			screen.getAllByLabelText(/^Herdr agent status:/).map((indicator) => (
			{
				colorClassName: indicator.firstElementChild?.className,
				focusLabel: indicator.parentElement?.querySelector(".sr-only")?.textContent,
				label: indicator.textContent,
			})),
		).toStrictEqual([
			{
				colorClassName: "h-2.5 w-2.5 rounded-full bg-red-500",
				focusLabel: "Herdr pane focused",
				label: "blocked",
			},
			{
				colorClassName: "h-2.5 w-2.5 rounded-full bg-yellow-500",
				focusLabel: "Herdr pane not focused",
				label: "working",
			},
		]);
	});

	it("names the page and explains why its tracked Claude session count excludes panes", async () =>
	{
		const HerdrPage = HerdrRoute.options.component;
		if (!HerdrPage) throw new Error("Expected the Herdr route component");

		const queryClient = new QueryClient(
			{
				defaultOptions:
				{
					queries:
					{
						retry: false,
					},
				},
			},
		);
		queryClient.setQueryData(
			terminalPlacementsQueryOptions.queryKey,
			{
				placements: [
					placement(
						{
							active: true,
							agentStatus: "working",
							number: 100,
						},
					),
					placement(
						{
							active: false,
							agentStatus: "idle",
							number: 200,
						},
					),
				],
				writesEnabled: true,
			},
		);
		const rootRoute = createRootRoute(
			{
				component: () => (
					<QueryClientProvider client={queryClient}>{createElement(HerdrPage)}</QueryClientProvider>
				),
			},
		);
		const router = createRouter(
			{
				routeTree: rootRoute,
				history: createMemoryHistory(
					{
						initialEntries: ["/terminals"],
					},
				),
			},
		);
		await router.load();

		render(<RouterProvider router={router} />);

		const scopeExplanation =
			"This page lists herdr and tmux panes linked to indexed Claude transcripts. It intentionally excludes Codex sessions and shell panes that are not linked to a Claude transcript.";
		expect(
			{
				heading: screen.getByRole(
					"heading",
					{
						level: 1,
					},
				).textContent,
				count: screen.getByText("2 tracked Claude sessions").textContent,
				scopeExplanation: screen
					.getByRole(
						"img",
						{
							name: scopeExplanation,
						},
					)
					.getAttribute("title"),
				routeMeta: routeMeta(HerdrRoute),
				terminalRouteMeta: routeMeta(HerdrTerminalRoute),
			},
		).toStrictEqual(
			{
				heading: "Terminals",
				count: "2 tracked Claude sessions",
				scopeExplanation,
				routeMeta: [
					{
						name: "ccb-page-title",
						content: "Terminals",
					},
				],
				terminalRouteMeta: [
					{
						name: "ccb-page-title",
						content: "Live terminal",
					},
				],
			},
		);
		expect(document.body.textContent.includes("Terminal Fleet")).toBe(false);
	});

	it("labels a pane from a named herdr session with that session", async () =>
	{
		const named = placement(
			{
				active: false,
				agentStatus: "blocked",
				number: 100,
			},
		);
		await renderHerdrPage([
			{
				...named,
				herdrPane:
				{
					...named.herdrPane,
					paneId: "pane-test-100@later",
				},
			},
			placement(
				{
					active: false,
					agentStatus: "idle",
					number: 200,
				},
			),
		]);

		expect(screen.getAllByText(/^herdr session/u).map((label) => label.textContent)).toStrictEqual([
			"herdr session later",
		]);
	});

	it("makes transcript and live terminal navigation distinct without visible technical metadata", async () =>
	{
		const HerdrPage = HerdrRoute.options.component;
		if (!HerdrPage) throw new Error("Expected the Herdr route component");

		const displayName = "* ✓ $ Alice terminal";
		const queryClient = new QueryClient(
			{
				defaultOptions:
				{
					queries:
					{
						retry: false,
					},
				},
			},
		);
		queryClient.setQueryData(
			terminalPlacementsQueryOptions.queryKey,
			{
				placements: [
					placement(
						{
							active: true,
							agentStatus: "working",
							displayName,
							number: 100,
						},
					),
				],
				writesEnabled: true,
			},
		);
		const rootRoute = createRootRoute(
			{
				component: () => (
					<QueryClientProvider client={queryClient}>{createElement(HerdrPage)}</QueryClientProvider>
				),
			},
		);
		const router = createRouter(
			{
				routeTree: rootRoute,
				history: createMemoryHistory(
					{
						initialEntries: ["/terminals"],
					},
				),
			},
		);
		await router.load();

		render(<RouterProvider router={router} />);

		const transcriptLink = screen.getByRole(
			"link",
			{
				name: `Open session transcript for ${displayName}`,
			},
		);
		const terminalLink = screen.getByRole(
			"link",
			{
				name: `Open live read-only terminal for ${displayName}`,
			},
		);
		const row = transcriptLink.parentElement;
		expect(
			{
				transcript:
				{
					href: transcriptLink.getAttribute("href"),
					title: transcriptLink.getAttribute("title"),
					className: transcriptLink.className,
				},
				terminal:
				{
					href: terminalLink.getAttribute("href"),
					title: terminalLink.getAttribute("title"),
					className: terminalLink.className,
				},
				displayName: Array.from(terminalLink.children).map((cell) => cell.textContent),
				visibleTechnicalMetadata:
				{
					provider: row?.textContent.includes("herdr"),
					workspaceId: row?.textContent.includes("workspace-test-100"),
					host: "herdr" as const,
					paneId: row?.textContent.includes("pane-test-100"),
					terminalId: row?.textContent.includes("terminal-test-100"),
					capabilityBadges: ["write", "events", "observe"].filter((label) =>
						Array.from(row?.querySelectorAll("span") ?? []).some(
							(element) => element.textContent === label,
						),
					),
				},
			},
		).toStrictEqual(
			{
				transcript:
				{
					href: "/session/session-test-100",
					title: `Open session transcript for ${displayName}`,
					className: HERDR_TRANSCRIPT_CELL,
				},
				terminal:
				{
					href: "/terminals/session-test-100",
					title: `Open live read-only terminal for ${displayName}. Workspace workspace-test-100 · Pane pane-test-100 · Terminal terminal-test-100 · Capabilities: write, events, observe`,
					className: HERDR_TERMINAL_COLUMNS,
				},
				displayName: ["Herdr pane focused", "*", "✓ $ Alice terminal"],
				visibleTechnicalMetadata:
				{
					provider: true,
					workspaceId: false,
					host: "herdr" as const,
					paneId: false,
					terminalId: false,
					capabilityBadges: [],
				},
			},
		);
	});

	it("uses Herdr for the live terminal breadcrumb and route metadata", async () =>
	{
		await renderTerminalPage();

		const breadcrumb = screen.getByRole(
			"link",
			{
				name: "Terminals",
			},
		);
		expect(
			{
				breadcrumb: breadcrumb.textContent,
				breadcrumbHref: breadcrumb.getAttribute("href"),
				heading: screen.getByRole(
					"heading",
					{
						level: 1,
					},
				).textContent,
				routeMeta: routeMeta(HerdrTerminalRoute),
				terminal: screen.getByRole(
					"region",
					{
						name: "Live read-only terminal",
					},
				).textContent,
			},
		).toStrictEqual(
			{
				breadcrumb: "Terminals",
				breadcrumbHref: "/terminals",
				heading: "Live terminal",
				routeMeta: [
					{
						name: "ccb-page-title",
						content: "Live terminal",
					},
				],
				terminal: "session-test-100",
			},
		);
		expect(document.body.textContent.includes("Terminal Fleet")).toBe(false);
	});

	it("names the host the session's pane runs in beside the heading", async () =>
	{
		const labels: Array<string | null> = [];
		for (const pane of [
			{
				paneId: "pane-test-100@later",
				host: "herdr" as const,
			},
			{
				paneId: "pane-test-100",
				host: "herdr" as const,
			},
			{
				paneId: "%9",
				host: "tmux" as const,
				workspaceId: "alice-tmux",
			},
		])
		{
			await renderTerminalPage(pane);
			labels.push(screen.getByTestId("terminal-host-label").textContent);
			cleanup();
		}
		await renderTerminalPage(
			{
				livePane: false,
			},
		);
		expect(
			{
				labels,
				ended: screen.queryByTestId("terminal-host-label"),
			},
		).toStrictEqual(
			{
				labels: ["herdr · later", "herdr", "tmux · alice-tmux"],
				ended: null,
			},
		);
	});
});

/**
 * The live terminal and the transcript are two views of the same Claude
 * session, so each one links to the other. The transcript side is conditional:
 * `/api/herdr/observe` throws when no live pane is linked to the session, so a
 * finished session must not offer a terminal link that lands on an error page.
 */
describe("session and live terminal two-way navigation", () =>
{
	it("links the live terminal page back to the same session's transcript", async () =>
	{
		await renderTerminalPage();

		const transcriptLink = screen.getByRole(
			"link",
			{
				name: "Open session transcript for session-test-100",
			},
		);
		expect(
			{
				href: transcriptLink.getAttribute("href"),
				title: transcriptLink.getAttribute("title"),
			},
		).toStrictEqual(
			{
				href: "/session/session-test-100",
				title: "Open session transcript for session-test-100",
			},
		);
	});
});

/**
 * The route is a pop-out of the session's Terminal pane (upstream's "Open in
 * new window"): one `TerminalPane`, placed full-bleed without the tile host's
 * Move, Expand, Close or header menu.
 */
describe("Herdr terminal pop-out", () =>
{
	it("renders the Terminal pane standalone with its Claude tab", async () =>
	{
		await renderTerminalPage(
			{
				writesEnabled: true,
			},
		);

		const pane = document.querySelector<HTMLElement>('[data-pane-kind="terminal"]');
		expect(
			{
				standalone: pane?.getAttribute("data-terminal-standalone"),
				label: pane?.getAttribute("aria-label"),
				tabs: screen.getAllByRole("tab").map((tab) => (
				{
					name: tab.textContent,
					selected: tab.getAttribute("aria-selected"),
				})),
				terminal:
				{
					text: screen.getByRole(
						"region",
						{
							name: "Live read-only terminal",
						},
					).textContent,
					interactive: screen
						.getByRole(
							"region",
							{
								name: "Live read-only terminal",
							},
						)
						.getAttribute("data-interactive"),
				},
				hostChrome: ["Move", "Expand", "Close", "More options"].filter(
					(name) =>
						screen.queryByRole(
							"button",
							{
								name,
							},
						) !== null,
				),
			},
		).toStrictEqual(
			{
				standalone: "",
				label: "Terminal",
				tabs: [
					{
						name: "Claude",
						selected: "true",
					},
				],
				terminal:
				{
					text: "session-test-100",
					interactive: "true",
				},
				hostChrome: [],
			},
		);
	});

	it("shows Session ended when herdr no longer has the session's pane", async () =>
	{
		await renderTerminalPage(
			{
				livePane: false,
			},
		);

		expect(
			{
				text: screen.getByRole(
					"tabpanel",
					{
						name: "Claude terminal",
					},
				).textContent,
				link: screen
					.getByRole(
						"link",
						{
							name: "View transcript",
						},
					)
					.getAttribute("href"),
				terminal: screen.queryByRole(
					"region",
					{
						name: "Live read-only terminal",
					},
				),
			},
		).toStrictEqual(
			{
				text: "Session endedView transcript",
				link: "/session/session-test-100",
				terminal: null,
			},
		);
	});
});

/**
 * Flat file routing nests `herdr.index` and `herdr.terminal.$sessionId` under
 * `herdr`, so the layout has to hand rendering down through `<Outlet />`. This
 * exact regression shipped once: the URL and title changed while the child
 * never mounted and the parent rendered in its place.
 */
describe("Herdr master-detail layout", () =>
{
	function renderLayoutAt(path: string)
	{
		const HerdrLayout = HerdrLayoutRoute.options.component;
		const HerdrIndex = HerdrRoute.options.component;
		const HerdrTerminal = HerdrTerminalRoute.options.component;
		if (!HerdrLayout || !HerdrIndex || !HerdrTerminal)
		{
			throw new Error("Expected every Herdr route to declare a component");
		}

		const queryClient = new QueryClient(
			{
				defaultOptions:
				{
					queries:
					{
						retry: false,
					},
				},
			},
		);
		queryClient.setQueryData(
			terminalPlacementsQueryOptions.queryKey,
			{
				placements: [
					placement(
						{
							active: false,
							agentStatus: "idle",
							number: 100,
						},
					),
				],
				writesEnabled: true,
			},
		);
		seedTerminalQueries(
			queryClient,
			{
				livePane: true,
				writesEnabled: false,
			},
		);
		queryClient.setQueryData(
			herdrWorkspacesQueryOptions.queryKey,
			{
				workspaces: [
					{
						workspaceId: "workspace-test-100",
						number: 1,
						label: "kalshi",
						agentStatus: "idle",
						worktreeName: null,
						agentPanes: [
							{
								paneId: "pane-test-100",
								title: "Terminal 100",
								agent: "claude",
								agentStatus: "idle",
								sessionId: "session-test-100",
							},
						],
						shellPanes: [],
					},
				],
			},
		);

		const rootRoute = createRootRoute(
			{
				component: () => (
					<QueryClientProvider client={queryClient}>
						<Outlet />
					</QueryClientProvider>
				),
			},
		);
		const layoutRoute = createRoute(
			{
				getParentRoute: () => rootRoute,
				path: "/terminals",
				component: HerdrLayout,
			},
		);
		const indexRoute = createRoute(
			{
				getParentRoute: () => layoutRoute,
				path: "/",
				component: HerdrIndex,
			},
		);
		const terminalRoute = createRoute(
			{
				getParentRoute: () => layoutRoute,
				path: "/$sessionId",
				component: HerdrTerminal,
			},
		);
		const router = createRouter(
			{
				routeTree: rootRoute.addChildren([layoutRoute.addChildren([indexRoute, terminalRoute])]),
				history: createMemoryHistory(
					{
						initialEntries: [path],
					},
				),
			},
		);
		return {
			router,
		};
	}

	it("shows the flat list beside the rail at the index", async () =>
	{
		const {router} = renderLayoutAt("/terminals");
		await router.load();
		render(<RouterProvider router={router} />);

		expect(
			{
				rail: screen.getByRole(
					"navigation",
					{
						name: "Herdr workspaces",
					},
				).textContent,
				list: screen.getByRole(
					"heading",
					{
						level: 1,
					},
				).textContent,
				terminal: screen.queryByRole(
					"region",
					{
						name: "Live read-only terminal",
					},
				),
			},
		).toStrictEqual(
			{
				rail: "1kalshiidleTerminal 100idle",
				list: "Terminals",
				terminal: null,
			},
		);
	});

	/**
	 * The rail and the flat list show the same panes, so clicking a pane in one
	 * has to land where clicking it in the other does. They disagreed once: the
	 * rail opened the live terminal while the list row opened the transcript.
	 */
	it("sends the rail and the flat list to the same view for one pane", async () =>
	{
		const {router} = renderLayoutAt("/terminals");
		await router.load();
		render(<RouterProvider router={router} />);

		const transcriptLink = screen.getByRole(
			"link",
			{
				name: "Open session transcript for Terminal 100",
			},
		);
		const [, rowPrimary] = Array.from(transcriptLink.parentElement?.children ?? []);
		expect(
			{
				rail: screen
					.getByRole(
						"link",
						{
							name: "Open live terminal for Terminal 100 in workspace kalshi",
						},
					)
					.getAttribute("href"),
				rowPrimary: rowPrimary?.getAttribute("href"),
				rowPrimaryLabel: rowPrimary?.getAttribute("aria-label"),
				rowSecondary: transcriptLink.getAttribute("href"),
			},
		).toStrictEqual(
			{
				rail: "/terminals/session-test-100",
				rowPrimary: "/terminals/session-test-100",
				rowPrimaryLabel: "Open live read-only terminal for Terminal 100",
				rowSecondary: "/session/session-test-100",
			},
		);
	});

	/**
	 * `<main>` is the scroll container but is not positioned, so an absolutely positioned
	 * descendant with no positioned ancestor (each row's `sr-only` status label) takes the
	 * initial containing block and escapes main's overflow: at 390px the document grew to
	 * 1716px and scrolled, which lets iOS slide the titlebar away. The layout wrapper is the
	 * containing block that keeps those labels inside main's scroller.
	 */
	it("contains its absolutely positioned descendants so only main scrolls", async () =>
	{
		const {router} = renderLayoutAt("/terminals");
		await router.load();
		render(<RouterProvider router={router} />);

		const rail = screen.getByRole(
			"navigation",
			{
				name: "Herdr workspaces",
			},
		);
		expect(rail.parentElement?.className).toBe("relative -mx-4 flex sm:-mx-8");
	});

	it("renders the pane detail through the outlet on a deep link, keeping the rail", async () =>
	{
		const {router} = renderLayoutAt("/terminals/session-test-100");
		await router.load();
		render(<RouterProvider router={router} />);

		expect(
			{
				rail: screen
					.getByRole(
						"navigation",
						{
							name: "Herdr workspaces",
						},
					)
					.getAttribute("aria-label"),
				selectedRailLink: screen
					.getByRole(
						"link",
						{
							name: "Open live terminal for Terminal 100 in workspace kalshi",
						},
					)
					.getAttribute("aria-current"),
				heading: screen.getByRole(
					"heading",
					{
						level: 1,
					},
				).textContent,
				standalonePane: document
					.querySelector('[data-pane-kind="terminal"]')
					?.getAttribute("data-terminal-standalone"),
				terminal: screen.getByRole(
					"region",
					{
						name: "Live read-only terminal",
					},
				).textContent,
				flatList: screen.queryByText("1 tracked Claude sessions"),
			},
		).toStrictEqual(
			{
				rail: "Herdr workspaces",
				selectedRailLink: "page",
				heading: "Live terminal",
				standalonePane: "",
				terminal: "session-test-100",
				flatList: null,
			},
		);
	});
});

describe("Terminals page tmux rows", () =>
{
	it("labels each row with its host and shows a tmux session's unread mark", async () =>
	{
		const tmuxPlacement =
		{
			provider: "tmux" as const,
			sessionId: "session-test-900",
			displayName: "claude",
			active: false,
			paneHandle: "%9",
			scopeHandle: "/private/tmp/tmux-501/default",
			capabilities:
			{
				supportsWrite: false,
				supportsEvents: true,
				supportsObserve: false,
			},
			tmuxWindow:
			{
				sessionId: "session-test-900",
				projectName: "alice-project",
				windowIndex: 3,
				windowName: "claude",
				windowActive: false,
				tmuxPane: "%9",
				socket: "/private/tmp/tmux-501/default",
			},
			viewedState:
			{
				currentMessageIndex: 4,
				lastViewedMessageIndex: 2,
				reviewTargetMessageIndex: 4,
				newMessageCount: 2,
				viewedInCcp: false,
				viewedInHerdr: false,
				viewedAnywhere: false,
			},
		};
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the page renders both providers; the helper is typed for herdr rows
		await renderHerdrPage([
			tmuxPlacement as unknown as ReturnType<typeof placement>,
			placement(
				{
					active: false,
					agentStatus: "idle",
					number: 100,
				},
			),
		]);

		const tmuxRow = screen.getByRole(
			"link",
			{
				name: /claude/u,
			},
		);
		const herdrRow = screen.getByRole(
			"link",
			{
				name: "Open session transcript for Terminal 100",
			},
		).parentElement;
		expect(
			{
				tmuxRowColumns: tmuxRow.className,
				tmuxTitleCell: tmuxRow.children[4]?.className,
				tmuxHost: tmuxRow.children[2]?.textContent,
				tmuxReview: tmuxRow.children[6]?.textContent,
				herdrHost: herdrRow?.children[0]?.textContent,
			},
		).toStrictEqual(
			{
				tmuxRowColumns:
					"grid grid-cols-[0.625rem_2.75rem_2.5rem_minmax(0,1fr)_minmax(0,8rem)_8.5rem_auto] items-center gap-2 rounded-md border border-border p-3 no-underline transition-colors hover:bg-surface-0 max-sm:flex max-sm:flex-wrap",
				tmuxTitleCell: "truncate text-sm font-medium text-primary max-sm:order-first max-sm:basis-full",
				tmuxHost: "tmux",
				tmuxReview: "Needs review · 2 new",
				herdrHost: "herdr",
			},
		);
	});

	it("shows everything the retired Tmux Windows page did: window index, window name and project", async () =>
	{
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the page renders both providers; the helper is typed for herdr rows
		await renderHerdrPage([tmuxPlacementFixture() as unknown as ReturnType<typeof placement>]);

		const tmuxRow = screen.getByRole(
			"link",
			{
				name: /claude-window/u,
			},
		);
		expect(
			{
				href: tmuxRow.getAttribute("href"),
				windowIndex: tmuxRow.children[3]?.textContent,
				windowName: tmuxRow.children[4]?.textContent,
				projectName: tmuxRow.children[5]?.textContent,
			},
		).toStrictEqual(
			{
				href: "/session/session-test-900",
				windowIndex: "#3",
				windowName: "claude-window",
				projectName: "alice-project",
			},
		);
	});
});

function tmuxPlacementFixture()
{
	return {
		provider: "tmux" as const,
		sessionId: "session-test-900",
		displayName: "claude-window",
		active: true,
		paneHandle: "%9",
		scopeHandle: "/private/tmp/tmux-501/default",
		capabilities:
		{
			supportsWrite: true,
			supportsEvents: true,
			supportsObserve: false,
		},
		tmuxWindow:
		{
			sessionId: "session-test-900",
			projectName: "alice-project",
			windowIndex: 3,
			windowName: "claude-window",
			windowActive: true,
			tmuxPane: "%9",
			socket: "/private/tmp/tmux-501/default",
		},
		viewedState:
		{
			currentMessageIndex: 4,
			lastViewedMessageIndex: 4,
			reviewTargetMessageIndex: 4,
			newMessageCount: 0,
			viewedInCcp: true,
			viewedInHerdr: false,
			viewedAnywhere: true,
		},
	};
}

describe("Terminals page empty state", () =>
{
	it("carries over the retired Tmux Windows page's TMUX and TMUX_PANE setup hint", async () =>
	{
		await renderHerdrPage([]);

		expect(screen.getByText(/TMUX_PANE/u).closest("li")?.textContent).toBe(
			"Run Claude Code inside tmux so TMUX and TMUX_PANE are set, or inside herdr.",
		);
	});
});

describe("legacy /herdr and /tmux redirects", () =>
{
	async function landingHref(path: string): Promise<string>
	{
		const rootRoute = createRootRoute(
			{
				component: Outlet,
			},
		);
		const legacyRoute = createRoute(
			{
				getParentRoute: () => rootRoute,
				path: "/herdr",
				beforeLoad: redirectLegacyHerdr,
			},
		);
		const legacySplatRoute = createRoute(
			{
				getParentRoute: () => legacyRoute,
				path: "$",
			},
		);
		const legacyTmuxRoute = createRoute(
			{
				getParentRoute: () => rootRoute,
				path: "/tmux",
				beforeLoad: redirectLegacyTmux,
			},
		);
		const legacyTmuxSplatRoute = createRoute(
			{
				getParentRoute: () => legacyTmuxRoute,
				path: "$",
			},
		);
		const terminalsRoute = createRoute(
			{
				getParentRoute: () => rootRoute,
				path: "/terminals",
				component: Outlet,
			},
		);
		const terminalsIndexRoute = createRoute(
			{
				getParentRoute: () => terminalsRoute,
				path: "/",
				component: () => null,
			},
		);
		const legacyTerminalRoute = createRoute(
			{
				getParentRoute: () => terminalsRoute,
				path: "/terminal/$sessionId",
				beforeLoad: legacyTerminalPageRedirect,
			},
		);
		const terminalRoute = createRoute(
			{
				getParentRoute: () => terminalsRoute,
				path: "/$sessionId",
				component: () => null,
			},
		);
		const router = createRouter(
			{
				routeTree: rootRoute.addChildren([
					legacyRoute.addChildren([legacySplatRoute]),
					legacyTmuxRoute.addChildren([legacyTmuxSplatRoute]),
					terminalsRoute.addChildren([terminalsIndexRoute, legacyTerminalRoute, terminalRoute]),
				]),
				history: createMemoryHistory(
					{
						initialEntries: [path],
					},
				),
			},
		);
		await router.load();
		return router.state.location.href;
	}

	it.each([
		["/herdr", "/terminals"],
		["/herdr/", "/terminals"],
		["/herdr/terminal/session-test-100", "/terminals/session-test-100"],
		["/herdr/terminal/session-test-100?tab=shell#bottom", "/terminals/session-test-100?tab=shell#bottom"],
		["/terminals/terminal/session-test-100", "/terminals/session-test-100"],
		["/terminals/terminal/session-test-100?tab=shell#bottom", "/terminals/session-test-100?tab=shell#bottom"],
		["/tmux", "/terminals"],
		["/tmux/", "/terminals"],
		["/tmux?filter=alice#top", "/terminals?filter=alice#top"],
		["/tmux/terminal/session-test-100?tab=shell#bottom", "/terminals/session-test-100?tab=shell#bottom"],
	])("sends %s to %s", async (from, to) =>
	{
		await expect(landingHref(from)).resolves.toBe(to);
	});
});

/** One herdr workspace with a Claude tab and a tab of two plain shells, one idle and one running a command. */
function terminalWorkspaces(): HerdrTerminalWorkspaceData[]
{
	const pane =
	{
		focused: false,
		agent: null,
		agentStatus: "unknown",
		claudeSessionId: null,
		process: "idle" as const,
	};
	return [
		{
			workspaceId: "w1",
			number: 1,
			label: "kalshi",
			focused: true,
			tabs: [
				{
					tabId: "w1:t1",
					number: 1,
					label: "claude",
					focused: true,
					panes: [
						{
							...pane,
							paneId: "w1:p1",
							terminalId: "term_1",
							title: "Alice session",
							cwd: "/tmp/test/kalshi",
							agent: "claude",
							agentStatus: "working",
							claudeSessionId: "session-test-100",
							command: "claude",
							process: "running",
						},
					],
				},
				{
					tabId: "w1:t2",
					number: 2,
					label: "shells",
					focused: false,
					panes: [
						{
							...pane,
							paneId: "w1:p2",
							terminalId: "term_2",
							title: "zsh",
							cwd: "/tmp/test/home",
							command: "-zsh",
						},
						{
							...pane,
							paneId: "w1:p3@later",
							terminalId: "term_3",
							title: "tests",
							cwd: "/tmp/test/kalshi",
							command: "pnpm test",
							process: "running",
						},
					],
				},
			],
		},
	];
}

function renderTerminalsAt(
	path: string,
	{
		writesEnabled = true,
		workspaces = terminalWorkspaces(),
	}:
	{
		writesEnabled?: boolean;
		workspaces?: HerdrTerminalWorkspaceData[];
	} = {},
)
{
	const HerdrLayout = HerdrLayoutRoute.options.component;
	const HerdrIndex = HerdrRoute.options.component;
	const PaneTerminal = HerdrPaneTerminalRoute.options.component;
	if (!HerdrLayout || !HerdrIndex || !PaneTerminal) throw new Error("Expected every Terminals route component");

	const queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	queryClient.setQueryData(
		terminalPlacementsQueryOptions.queryKey,
		{
			placements: [],
			writesEnabled,
		},
	);
	seedTerminalQueries(
		queryClient,
		{
			livePane: false,
			writesEnabled,
		},
	);
	queryClient.setQueryData(
		herdrWorkspacesQueryOptions.queryKey,
		{
			workspaces: [],
		},
	);
	queryClient.setQueryData(
		herdrTerminalsQueryOptions.queryKey,
		{
			workspaces,
		},
	);

	const rootRoute = createRootRoute(
		{
			component: () => (
				<QueryClientProvider client={queryClient}>
					<Outlet />
				</QueryClientProvider>
			),
		},
	);
	const layoutRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "/terminals",
			component: HerdrLayout,
		},
	);
	const indexRoute = createRoute(
		{
			getParentRoute: () => layoutRoute,
			path: "/",
			component: HerdrIndex,
		},
	);
	const paneRoute = createRoute(
		{
			getParentRoute: () => layoutRoute,
			path: "/pane/$paneId",
			component: PaneTerminal,
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute.addChildren([layoutRoute.addChildren([indexRoute, paneRoute])]),
			history: createMemoryHistory(
				{
					initialEntries: [path],
				},
			),
		},
	);
	return {
		router,
		queryClient,
	};
}

describe("Terminals page: every herdr terminal", () =>
{
	it("lists each workspace's tabs and panes, Claude and plain shells, each opening its live terminal", async () =>
	{
		const {router} = renderTerminalsAt("/terminals");
		await router.load();
		render(<RouterProvider router={router} />);

		const section = screen.getByRole(
			"region",
			{
				name: "All herdr terminals",
			},
		);
		expect(
			{
				workspaces: within(section)
					.getAllByRole(
						"heading",
						{
							level: 3,
						},
					)
					.map((heading) => heading.textContent),
				tabs: within(section)
					.getAllByRole("list")
					.map((list) => list.getAttribute("aria-label")),
				rows: within(section)
					.getAllByRole("link")
					.map((link) => (
					{
						name: link.getAttribute("aria-label"),
						href: link.getAttribute("href"),
						cells: Array.from(link.children).map((cell) => cell.textContent),
					})),
			},
		).toStrictEqual(
			{
				workspaces: ["1kalshi"],
				tabs: ["Tab 1 claude", "Tab 2 shells"],
				rows: [
					{
						name: "Open live terminal for Alice session",
						href: "/terminals/session-test-100",
						cells: ["claude", "Alice session", "/tmp/test/kalshi", "working"],
					},
					{
						name: "Open live terminal for zsh",
						href: "/terminals/pane/w1%3Ap2",
						cells: ["shell", "zsh-zsh", "/tmp/test/home", "idle"],
					},
					{
						name: "Open live terminal for tests",
						href: "/terminals/pane/w1%3Ap3%40later",
						cells: ["shell", "testspnpm test", "/tmp/test/kalshi", "running"],
					},
				],
			},
		);
	});

	it("says so when herdr has no terminals open", async () =>
	{
		const {router} = renderTerminalsAt(
			"/terminals",
			{
				workspaces: [],
			},
		);
		await router.load();
		render(<RouterProvider router={router} />);

		expect(
			screen.getByRole(
				"region",
				{
					name: "All herdr terminals",
				},
			).textContent,
		).toBe("All herdr terminalsNo herdr terminals are open.");
	});

	it("starts a shell in the home directory by default, or in the chosen directory, and opens it", async () =>
	{
		const bodies: unknown[] = [];
		const paneIds = ["w1:p7", "w1:p8@later"];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
		{
			if (init?.method !== "POST")
			{
				// The refetch after a create lists the new tab's pane.
				const [workspace] = terminalWorkspaces();
				const [tab] = workspace?.tabs ?? [];
				const [pane] = tab?.panes ?? [];
				if (workspace === undefined || tab === undefined || pane === undefined) throw new Error("fixture");
				const created = paneIds.slice(0, bodies.length).map((paneId) => (
				{
					...pane,
					paneId,
					claudeSessionId: null,
				}));
				return Promise.resolve(
					Response.json(
						{
							workspaces: [
								{
									...workspace,
									tabs: [
										...workspace.tabs,
										{
											...tab,
											tabId: "w1:t9",
											panes: created,
										},
									],
								},
							],
						},
					),
				);
			}
			bodies.push(JSON.parse(String(init.body)));
			const paneId = paneIds[bodies.length - 1] ?? "";
			return Promise.resolve(
				Response.json(
					{
						ok: true,
						tabId: "w1:t9",
						paneId,
					},
				),
			);
		});
		const {router} = renderTerminalsAt("/terminals");
		await router.load();
		render(<RouterProvider router={router} />);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "New terminal",
				},
			),
		);
		const directory = screen.getByRole(
			"textbox",
			{
				name: "Directory",
			},
		);
		const placeholder = directory.getAttribute("placeholder");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Start terminal",
				},
			),
		);
		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/terminals/pane/w1%3Ap7");
		});
		const opened = screen.getByRole(
			"region",
			{
				name: "Live read-only terminal",
			},
		);
		const firstPane =
		{
			paneId: opened.getAttribute("data-pane-id"),
			interactive: opened.getAttribute("data-interactive"),
		};

		await router.navigate(
			{
				to: "/terminals",
			},
		);
		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: "New terminal",
				},
			),
		);
		fireEvent.change(
			screen.getByRole(
				"textbox",
				{
					name: "Directory",
				},
			),
			{
				target:
				{
					value: "/tmp/test/kalshi",
				},
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Start terminal",
				},
			),
		);
		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/terminals/pane/w1%3Ap8%40later");
		});

		expect(
			{
				placeholder,
				bodies,
				firstPane,
			},
		).toStrictEqual(
			{
				placeholder: "Home directory",
				bodies: [
					{
						action: "create-tab",
					},
					{
						action: "create-tab",
						cwd: "/tmp/test/kalshi",
					},
				],
				firstPane:
				{
					paneId: "w1:p7",
					interactive: "true",
				},
			},
		);
	});

	it("shows why a new terminal failed to start, and offers none while Live terminal input is off", async () =>
	{
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json(
				{
					error: "herdr is not running",
					code: "herdr_unavailable",
				},
				{
					status: 502,
				},
			),
		);
		const {router} = renderTerminalsAt("/terminals");
		await router.load();
		const view = render(<RouterProvider router={router} />);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "New terminal",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Start terminal",
				},
			),
		);
		const alert = await screen.findByRole("alert");
		const failure =
		{
			text: alert.textContent,
			path: router.state.location.pathname,
		};
		view.unmount();

		const disabled = renderTerminalsAt(
			"/terminals",
			{
				writesEnabled: false,
			},
		);
		await disabled.router.load();
		render(<RouterProvider router={disabled.router} />);

		expect(
			{
				failure,
				offered: screen.queryByRole(
					"button",
					{
						name: "New terminal",
					},
				),
			},
		).toStrictEqual(
			{
				failure:
				{
					text: "herdr is not running",
					path: "/terminals",
				},
				offered: null,
			},
		);
	});
});

describe("Herdr pane terminal page", () =>
{
	it("opens a plain shell pane in the standalone terminal, typing enabled with Live terminal input", async () =>
	{
		const {router} = renderTerminalsAt("/terminals/pane/w1:p3@later");
		await router.load();
		render(<RouterProvider router={router} />);

		const terminal = screen.getByRole(
			"region",
			{
				name: "Live read-only terminal",
			},
		);
		expect(
			{
				breadcrumb: screen
					.getByRole(
						"link",
						{
							name: "Terminals",
						},
					)
					.getAttribute("href"),
				heading: screen.getByRole(
					"heading",
					{
						level: 1,
					},
				).textContent,
				cwd: screen.getByTestId("terminal-cwd").textContent,
				standalone: document
					.querySelector('[data-pane-kind="terminal"]')
					?.getAttribute("data-terminal-standalone"),
				terminal:
				{
					paneId: terminal.getAttribute("data-pane-id"),
					interactive: terminal.getAttribute("data-interactive"),
				},
				routeMeta: routeMeta(HerdrPaneTerminalRoute as unknown as typeof HerdrRoute),
			},
		).toStrictEqual(
			{
				breadcrumb: "/terminals",
				heading: "tests",
				cwd: "/tmp/test/kalshi",
				standalone: "",
				terminal:
				{
					paneId: "w1:p3@later",
					interactive: "true",
				},
				routeMeta: [
					{
						name: "ccb-page-title",
						content: "Live terminal",
					},
				],
			},
		);
	});

	it("streams read-only while Live terminal input is off", async () =>
	{
		const {router} = renderTerminalsAt(
			"/terminals/pane/w1:p2",
			{
				writesEnabled: false,
			},
		);
		await router.load();
		render(<RouterProvider router={router} />);

		expect(
			screen
				.getByRole(
					"region",
					{
						name: "Live read-only terminal",
					},
				)
				.getAttribute("data-interactive"),
		).toBe("false");
	});

	it("shows Terminal closed once herdr's refetched list no longer has the pane", async () =>
	{
		vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
			Promise.resolve(
				Response.json(
					{
						workspaces: terminalWorkspaces(),
					},
				),
			),
		);
		const {router} = renderTerminalsAt("/terminals/pane/w1:p9");
		await router.load();
		render(<RouterProvider router={router} />);
		const whileRefetching = screen
			.queryByRole(
				"region",
				{
					name: "Live read-only terminal",
				},
			)
			?.getAttribute("data-pane-id");

		expect(
			{
				whileRefetching,
				heading: screen.getByRole(
					"heading",
					{
						level: 1,
					},
				).textContent,
				closed: (await screen.findByText("Terminal closed")).textContent,
				terminal: screen.queryByRole(
					"region",
					{
						name: "Live read-only terminal",
					},
				),
			},
		).toStrictEqual(
			{
				whileRefetching: "w1:p9",
				heading: "Live terminal",
				closed: "Terminal closed",
				terminal: null,
			},
		);
	});
});

/**
 * herdr's terminal API for the management tests: each POST is recorded and
 * succeeds (a split answers with `w1:p5`, which later lists join the shells
 * tab), and each GET lists the fixture.
 */
function mockTerminalActions(): unknown[]
{
	const bodies: unknown[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
	{
		if (init?.method === "POST")
		{
			const body = JSON.parse(String(init.body)) as
			{
				action: string;
			};
			bodies.push(body);
			return Promise.resolve(
				Response.json(
					{
						ok: true,
						...(body.action === "split-pane"
							?
								{
									paneId: "w1:p5",
								}
							: {}),
					},
				),
			);
		}
		const workspaces = terminalWorkspaces();
		const shells = workspaces[0]?.tabs[1];
		const [first] = shells?.panes ?? [];
		if (
			bodies.some(
				(body) =>
					(
						body as
						{
							action: string;
						}
					).action === "split-pane",
			) &&
			first !== undefined
		)
		{
			shells?.panes.push(
				{
					...first,
					paneId: "w1:p5",
					terminalId: "term_5",
					title: "new shell",
				},
			);
		}
		return Promise.resolve(
			Response.json(
				{
					workspaces,
				},
			),
		);
	});
	return bodies;
}

async function openMenu(name: string): Promise<HTMLElement[]>
{
	fireEvent.click(
		screen.getByRole(
			"button",
			{
				name,
			},
		),
	);
	const menu = await waitFor(() => screen.getByRole("menu"));
	return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

function clickItem(items: HTMLElement[], label: string): void
{
	const item = items.find((node) => node.textContent === label);
	if (item === undefined) throw new Error(`No menu item ${label}`);
	fireEvent.click(item);
}

/** The non-mac chord (jsdom's user agent is not a Mac) for a herdr terminal shortcut. */
function pressTerminalKey(init: {key: string; code: string; shiftKey?: boolean}): void
{
	fireEvent.keyDown(
		document.body,
		{
			ctrlKey: true,
			altKey: true,
			...init,
		},
	);
}

describe("Terminals page: managing herdr tabs and panes", () =>
{
	it("offers split and close on each pane and rename and close on each tab", async () =>
	{
		const {router} = renderTerminalsAt("/terminals");
		await router.load();
		render(<RouterProvider router={router} />);

		const paneItems = (await openMenu("Pane actions for zsh")).map((node) => node.textContent);
		fireEvent.keyDown(
			screen.getByRole("menu"),
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		const tabItems = (await openMenu("Tab actions for Tab 2 shells")).map((node) => node.textContent);

		expect(
			{
				paneItems,
				tabItems,
			},
		).toStrictEqual(
			{
				paneItems: ["Split right", "Split down", "Close pane"],
				tabItems: ["Rename tab", "Close tab"],
			},
		);
	});

	it("splits a pane and opens the new one", async () =>
	{
		const bodies = mockTerminalActions();
		const {router} = renderTerminalsAt("/terminals");
		await router.load();
		render(<RouterProvider router={router} />);

		clickItem(await openMenu("Pane actions for zsh"), "Split down");
		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/terminals/pane/w1%3Ap5");
		});

		expect(bodies).toStrictEqual([
			{
				action: "split-pane",
				paneId: "w1:p2",
				direction: "down",
			},
		]);
	});

	it("closes an idle shell at once but asks before closing a pane whose command is still running", async () =>
	{
		const bodies = mockTerminalActions();
		const {router} = renderTerminalsAt("/terminals");
		await router.load();
		render(<RouterProvider router={router} />);

		clickItem(await openMenu("Pane actions for zsh"), "Close pane");
		await waitFor(() =>
		{
			expect(bodies).toHaveLength(1);
		});
		const idleAsked = screen.queryByRole("alertdialog");

		clickItem(await openMenu("Pane actions for tests"), "Close pane");
		const confirm = await screen.findByRole("alertdialog");
		const asked =
		{
			text: confirm.textContent,
			sentBeforeConfirm: bodies.length,
		};
		fireEvent.click(
			within(confirm).getByRole(
				"button",
				{
					name: "Close pane",
				},
			),
		);
		await waitFor(() =>
		{
			expect(bodies).toHaveLength(2);
		});

		expect(
			{
				idleAsked,
				asked,
				bodies,
			},
		).toStrictEqual(
			{
				idleAsked: null,
				asked:
				{
					text: "Close pane?tests is still running pnpm test. Closing the pane stops it.CancelClose pane",
					sentBeforeConfirm: 1,
				},
				bodies: [
					{
						action: "close-pane",
						paneId: "w1:p2",
					},
					{
						action: "close-pane",
						paneId: "w1:p3@later",
					},
				],
			},
		);
	});

	it("renames a tab and closes it after confirming its running pane", async () =>
	{
		const bodies = mockTerminalActions();
		const {router} = renderTerminalsAt("/terminals");
		await router.load();
		render(<RouterProvider router={router} />);

		clickItem(await openMenu("Tab actions for Tab 2 shells"), "Rename tab");
		const dialog = await screen.findByRole(
			"dialog",
			{
				name: "Rename tab",
			},
		);
		const field = within(dialog).getByRole(
			"textbox",
			{
				name: "Tab name",
			},
		);
		const initial = (field as HTMLInputElement).value;
		fireEvent.change(
			field,
			{
				target:
				{
					value: "  servers  ",
				},
			},
		);
		fireEvent.click(
			within(dialog).getByRole(
				"button",
				{
					name: "Save",
				},
			),
		);
		await waitFor(() =>
		{
			expect(bodies).toHaveLength(1);
		});

		clickItem(await openMenu("Tab actions for Tab 2 shells"), "Close tab");
		const confirm = await screen.findByRole("alertdialog");
		const asked = confirm.textContent;
		fireEvent.click(
			within(confirm).getByRole(
				"button",
				{
					name: "Close tab",
				},
			),
		);
		await waitFor(() =>
		{
			expect(bodies).toHaveLength(2);
		});

		expect(
			{
				initial,
				asked,
				bodies,
			},
		).toStrictEqual(
			{
				initial: "shells",
				asked: "Close tab?tests is still running pnpm test. Closing the tab stops it.CancelClose tab",
				bodies: [
					{
						action: "rename-tab",
						tabId: "w1:t2",
						label: "servers",
					},
					{
						action: "close-tab",
						tabId: "w1:t2",
					},
				],
			},
		);
	});

	it("offers no tab or pane actions while Live terminal input is off", async () =>
	{
		const {router} = renderTerminalsAt(
			"/terminals",
			{
				writesEnabled: false,
			},
		);
		await router.load();
		render(<RouterProvider router={router} />);

		expect(
			screen.queryAllByRole(
				"button",
				{
					name: /actions for/,
				},
			),
		).toStrictEqual([]);
	});
});

describe("Herdr pane terminal page: managing its tab", () =>
{
	it("switches between the panes of its tab", async () =>
	{
		const {router} = renderTerminalsAt("/terminals/pane/w1:p2");
		await router.load();
		render(<RouterProvider router={router} />);

		const switcher = screen.getByRole(
			"navigation",
			{
				name: "Panes in Tab 2 shells",
			},
		);
		const panes = within(switcher)
			.getAllByRole("link")
			.map((link) => (
			{
				name: link.textContent,
				href: link.getAttribute("href"),
				current: link.getAttribute("aria-current"),
			}));
		pressTerminalKey(
			{
				key: "]",
				code: "BracketRight",
			},
		);
		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/terminals/pane/w1%3Ap3%40later");
		});
		const afterNext = router.state.location.pathname;
		pressTerminalKey(
			{
				key: "]",
				code: "BracketRight",
			},
		);
		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/terminals/pane/w1%3Ap2");
		});
		pressTerminalKey(
			{
				key: "[",
				code: "BracketLeft",
			},
		);
		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/terminals/pane/w1%3Ap3%40later");
		});

		expect(
			{
				panes,
				afterNext,
			},
		).toStrictEqual(
			{
				panes: [
					{
						name: "zsh",
						href: "/terminals/pane/w1%3Ap2",
						current: "page",
					},
					{
						name: "tests",
						href: "/terminals/pane/w1%3Ap3%40later",
						current: null,
					},
				],
				afterNext: "/terminals/pane/w1%3Ap3%40later",
			},
		);
	});

	it("shows no pane switcher for a one-pane tab", async () =>
	{
		const {router} = renderTerminalsAt("/terminals/pane/w1:p1");
		await router.load();
		render(<RouterProvider router={router} />);

		expect(
			screen.queryByRole(
				"navigation",
				{
					name: /Panes in/,
				},
			),
		).toBeNull();
	});

	it("splits right from its toolbar and down from its shortcut, opening each new pane", async () =>
	{
		const bodies = mockTerminalActions();
		const {router} = renderTerminalsAt("/terminals/pane/w1:p2");
		await router.load();
		render(<RouterProvider router={router} />);

		const toolbar = screen.getByRole(
			"toolbar",
			{
				name: "Terminal actions",
			},
		);
		const buttons = within(toolbar)
			.getAllByRole("button")
			.map((button) => (
			{
				name: button.getAttribute("aria-label"),
				keys: button.getAttribute("aria-keyshortcuts"),
			}));
		fireEvent.click(
			within(toolbar).getByRole(
				"button",
				{
					name: "Split right",
				},
			),
		);
		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/terminals/pane/w1%3Ap5");
		});
		// The new pane is manageable once the refreshed list has it.
		await screen.findByRole(
			"heading",
			{
				level: 1,
				name: "new shell",
			},
		);
		pressTerminalKey(
			{
				key: "D",
				code: "KeyD",
				shiftKey: true,
			},
		);
		await waitFor(() =>
		{
			expect(bodies).toHaveLength(2);
		});

		expect(
			{
				buttons,
				bodies,
			},
		).toStrictEqual(
			{
				buttons: [
					{
						name: "Split right",
						keys: "Control+Alt+d",
					},
					{
						name: "Split down",
						keys: "Control+Alt+Shift+d",
					},
					{
						name: "Rename tab",
						keys: "Control+Alt+e",
					},
					{
						name: "Close pane",
						keys: "Control+Alt+\\",
					},
				],
				bodies: [
					{
						action: "split-pane",
						paneId: "w1:p2",
						direction: "right",
					},
					{
						action: "split-pane",
						paneId: "w1:p5",
						direction: "down",
					},
				],
			},
		);
	});

	it("closes its running pane from the shortcut after confirming, then shows the tab's other pane", async () =>
	{
		const bodies = mockTerminalActions();
		const {router} = renderTerminalsAt("/terminals/pane/w1:p3@later");
		await router.load();
		render(<RouterProvider router={router} />);

		pressTerminalKey(
			{
				key: "\\",
				code: "Backslash",
			},
		);
		const confirm = await screen.findByRole("alertdialog");
		fireEvent.click(
			within(confirm).getByRole(
				"button",
				{
					name: "Close pane",
				},
			),
		);
		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/terminals/pane/w1%3Ap2");
		});

		expect(bodies).toStrictEqual([
			{
				action: "close-pane",
				paneId: "w1:p3@later",
			},
		]);
	});

	it("returns to the Terminals list after closing a tab's only pane", async () =>
	{
		const bodies = mockTerminalActions();
		const {router} = renderTerminalsAt(
			"/terminals/pane/w1:p2",
			{
				workspaces: terminalWorkspaces().map((workspace) => (
				{
					...workspace,
					tabs: workspace.tabs.map((tab) => (
					{
						...tab,
						panes: tab.panes.slice(0, 1),
					})),
				})),
			},
		);
		await router.load();
		render(<RouterProvider router={router} />);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Close pane",
				},
			),
		);
		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/terminals");
		});

		expect(bodies).toStrictEqual([
			{
				action: "close-pane",
				paneId: "w1:p2",
			},
		]);
	});

	it("renames its tab from the shortcut", async () =>
	{
		const bodies = mockTerminalActions();
		const {router} = renderTerminalsAt("/terminals/pane/w1:p2");
		await router.load();
		render(<RouterProvider router={router} />);

		pressTerminalKey(
			{
				key: "e",
				code: "KeyE",
			},
		);
		const dialog = await screen.findByRole(
			"dialog",
			{
				name: "Rename tab",
			},
		);
		fireEvent.change(
			within(dialog).getByRole(
				"textbox",
				{
					name: "Tab name",
				},
			),
			{
				target:
				{
					value: "logs",
				},
			},
		);
		fireEvent.click(
			within(dialog).getByRole(
				"button",
				{
					name: "Save",
				},
			),
		);
		await waitFor(() =>
		{
			expect(bodies).toHaveLength(1);
		});

		expect(bodies).toStrictEqual([
			{
				action: "rename-tab",
				tabId: "w1:t2",
				label: "logs",
			},
		]);
	});

	it("offers no management toolbar or shortcuts while Live terminal input is off", async () =>
	{
		const bodies = mockTerminalActions();
		const {router} = renderTerminalsAt(
			"/terminals/pane/w1:p2",
			{
				writesEnabled: false,
			},
		);
		await router.load();
		render(<RouterProvider router={router} />);

		pressTerminalKey(
			{
				key: "d",
				code: "KeyD",
			},
		);
		pressTerminalKey(
			{
				key: "e",
				code: "KeyE",
			},
		);

		expect(
			{
				toolbar: screen.queryByRole(
					"toolbar",
					{
						name: "Terminal actions",
					},
				),
				dialog: screen.queryByRole("dialog"),
				bodies,
			},
		).toStrictEqual(
			{
				toolbar: null,
				dialog: null,
				bodies: [],
			},
		);
	});
});
