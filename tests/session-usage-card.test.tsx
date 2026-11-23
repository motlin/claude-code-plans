// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionUsageCard, type SessionUsageCardProps} from "../src/components/session-usage-card";
import {formatResetLabel} from "../src/lib/composer-state";
import {EMPTY_SESSION_USAGE_STATS, type SessionUsageStats} from "../src/lib/session-usage-stats";
import type {UsageSummary} from "../src/lib/usage";

const NOW = new Date("2026-11-06T12:00:00.000Z");
const NOW_S = NOW.getTime() / 1000;
const OPUS = "claude-opus-5-5";
const HAIKU = "claude-haiku-4-5";

const USAGE: UsageSummary =
{
	fiveHour:
	{
		usedPct: 80,
		resetsAt: NOW_S + 7500,
	},
	sevenDay:
	{
		usedPct: 0,
		resetsAt: NOW_S + 3 * 86_400,
	},
	updatedAt: null,
	scoped: null,
};

let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

beforeEach(() =>
{
	vi.useFakeTimers(
		{
			toFake: ["Date", "setTimeout", "clearTimeout"],
		},
	);
	vi.setSystemTime(NOW);
	writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
	Object.defineProperty(
		navigator,
		"clipboard",
		{
			value:
			{
				writeText,
			},
			configurable: true,
		},
	);
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function renderCard(props: Partial<SessionUsageCardProps> = {})
{
	const handlers =
	{
		onRetry: vi.fn<() => void>(),
		onOpenMcpServers: vi.fn<() => void>(),
	};
	render(
		<SessionUsageCard
			usage={USAGE}
			usageLoading={false}
			usageError={false}
			retrying={false}
			stats={undefined}
			onRetry={handlers.onRetry}
			onOpenMcpServers={handlers.onOpenMcpServers}
			{...props}
		/>,
	);
	return handlers;
}

function card(): HTMLElement
{
	return screen.getByRole(
		"group",
		{
			name: "Usage",
		},
	);
}

function stats(overrides: Partial<SessionUsageStats>): SessionUsageStats
{
	return {
		...EMPTY_SESSION_USAGE_STATS,
		...overrides,
	};
}

describe("SessionUsageCard plan section", () =>
{
	it("renders upstream's root and a row per window with severity ink and a labelled meter", () =>
	{
		renderCard();
		const root = card();
		const meters = screen.getAllByRole("meter");
		const fiveHourReset = formatResetLabel(NOW_S + 7500, NOW.getTime());
		const weekReset = formatResetLabel(NOW_S + 3 * 86_400, NOW.getTime());
		const header = root.firstElementChild?.firstElementChild;
		const row = meters[0]?.parentElement?.parentElement;

		expect(
			{
				root:
				{
					className: root.className,
					tabIndex: root.getAttribute("tabindex"),
				},
				header:
				{
					className: header?.className,
					text: header?.textContent,
					copy: (() =>
					{
						const button = screen.getByRole(
							"button",
							{
								name: "Copy report",
							},
						);
						return {
							label: button.getAttribute("aria-label"),
							className: button.className,
							iconSize: button.querySelector("svg")?.style.fontSize,
						};
					})(),
				},
				row:
				{
					className: row?.className,
					top: row?.firstElementChild?.className,
					label: row?.firstElementChild?.firstElementChild?.className,
					readout: row?.firstElementChild?.lastElementChild?.className,
				},
				percents: meters.map((meter) =>
				{
					const percent =
						meter.parentElement?.parentElement?.firstElementChild?.lastElementChild?.lastElementChild;
					return {
						text: percent?.textContent,
						className: percent?.className,
						color: (percent as HTMLElement | null | undefined)?.style.color,
					};
				}),
				meters: meters.map((meter) => (
				{
					label: document.getElementById(meter.getAttribute("aria-labelledby") ?? "")?.textContent,
					valueText: meter.getAttribute("aria-valuetext"),
					variant: meter.dataset["variant"],
					wrapper: [meter.parentElement?.className, meter.parentElement?.dataset["variant"]],
					className: meter.className,
					boxShadow: meter.style.boxShadow,
					fill: [
						meter.firstElementChild?.className,
						(meter.firstElementChild as HTMLElement | null)?.style.transform,
					],
				})),
			},
		).toStrictEqual(
			{
				root:
				{
					className:
						"flex flex-col gap-[24px] p-[16px] pt-lg rounded-lg w-[360px] max-w-full card-ring forced-colors:not-focus-visible:outline-1 forced-colors:not-focus-visible:outline-solid forced-colors:not-focus-visible:outline-[CanvasText] outline-none",
					tabIndex: "-1",
				},
				header:
				{
					className: "flex items-center justify-between text-footnote text-primary pb-xs",
					text: "Usage",
					copy:
					{
						label: "Copy report",
						className:
							"inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus",
						iconSize: "calc(1.25rem * var(--cds-rem-scale, 1))",
					},
				},
				row:
				{
					className: "flex flex-col gap-0.75",
					top: "flex flex-wrap items-baseline justify-between gap-x-sm",
					label: "min-w-0 text-footnote text-secondary wrap-anywhere",
					readout: "ms-auto flex items-baseline gap-xs text-footnote text-secondary tabular-nums shrink-0",
				},
				percents: [
					{
						text: "80%",
						className: "text-primary",
						color: "var(--color-warning)",
					},
					{
						text: "0%",
						className: "text-muted-as-secondary",
						color: "",
					},
				],
				meters: [
					{
						label: "5-hour limit",
						valueText: `80% · ${fiveHourReset}`,
						variant: "warning",
						wrapper: ["w-full", "warning"],
						className:
							"w-full overflow-hidden rounded-full forced-color-adjust-none forced-colors:bg-[color:Canvas] forced-colors:outline forced-colors:outline-[color:CanvasText] h-2 bg-usage-track-warning",
						boxShadow: "inset 0 0 0 1px var(--color-alpha-1)",
						fill: [
							"h-full w-full rounded-full bg-usage-warning transition-transform duration-200 ease-[cubic-bezier(.165,.84,.44,1)] motion-reduce:transition-none rtl:[--_meter-dir:1]",
							"translateX(calc(var(--_meter-dir, -1) * (100% - min(100%, max(80.0%, 8px)))))",
						],
					},
					{
						label: "Weekly · all models",
						valueText: `0% · ${weekReset}`,
						variant: "accent",
						wrapper: ["w-full", "accent"],
						className:
							"w-full overflow-hidden rounded-full forced-color-adjust-none forced-colors:bg-[color:Canvas] forced-colors:outline forced-colors:outline-[color:CanvasText] h-2 bg-neutral",
						boxShadow: "inset 0 0 0 1px var(--color-alpha-1)",
						fill: [undefined, undefined],
					},
				],
			},
		);
	});

	it("tints 95% with the danger ink", () =>
	{
		renderCard(
			{
				usage:
				{
					...USAGE,
					fiveHour:
					{
						usedPct: 95,
						resetsAt: NOW_S + 60,
					},
					sevenDay: null,
				},
			},
		);
		const meter = screen.getByRole("meter");
		const percent = meter.parentElement?.parentElement?.firstElementChild?.lastElementChild
			?.lastElementChild as HTMLElement;

		expect([
			percent.style.color,
			meter.dataset["variant"],
			meter.className.split(" ").at(-1),
			meter.firstElementChild?.className.includes("bg-usage-danger"),
		]).toStrictEqual(["var(--color-danger)", "danger", "bg-usage-track-danger", true]);
	});

	it("shows Loading usage… with no Copy button while the first fetch runs", () =>
	{
		renderCard(
			{
				usage: undefined,
				usageLoading: true,
			},
		);
		const loading = screen.getByText("Loading usage…");

		expect(
			{
				className: loading.className,
				copy: screen.queryAllByRole("button").length,
			},
		).toStrictEqual(
			{
				className: "text-footnote text-muted-as-secondary",
				copy: 0,
			},
		);
	});

	it("shows the error with a Retry button that is busy while retrying", () =>
	{
		const handlers = renderCard(
			{
				usage: undefined,
				usageError: true,
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Retry",
				},
			),
		);
		cleanup();
		renderCard(
			{
				usage: undefined,
				usageError: true,
				retrying: true,
			},
		);
		const retry = screen.getByRole(
			"button",
			{
				name: "Retry",
			},
		);

		expect(
			{
				message: screen.getByText("Couldn’t load usage limits").className,
				retried: handlers.onRetry.mock.calls.length,
				busy: [retry.getAttribute("aria-busy"), (retry as HTMLButtonElement).disabled],
			},
		).toStrictEqual(
			{
				message: "text-footnote text-muted-as-secondary",
				retried: 1,
				busy: ["true", true],
			},
		);
	});

	it("copies the report, then shows Copied with a check for 1200ms", async () =>
	{
		renderCard(
			{
				usage:
				{
					...USAGE,
					sevenDay: null,
				},
				stats: stats(
					{
						usage:
						{
							[OPUS]:
							{
								input: 1200,
								output: 3000,
								cacheRead: 12_345,
								cacheWrite: 0,
							},
						},
						result:
						{
							costUSD: 3.456,
							apiMs: 600_000,
							wallMs: 1_800_000,
							perModel: {},
						},
					},
				),
			},
		);
		const button = screen.getByRole(
			"button",
			{
				name: "Copy report",
			},
		);
		await act(async () =>
		{
			fireEvent.click(button);
			await Promise.resolve();
		});
		const copied = button.getAttribute("aria-label");
		act(() =>
		{
			vi.advanceTimersByTime(1200);
		});

		expect(
			{
				copied,
				after: button.getAttribute("aria-label"),
				text: writeText.mock.calls,
			},
		).toStrictEqual(
			{
				copied: "Copied",
				after: "Copy report",
				text: [
					[
						[
							"Claude Code usage report (2026-11-06T12:00:00.000Z)",
							`Client: ${navigator.userAgent}`,
							"",
							"Plan limits:",
							`- five_hour: 80% (resets ${new Date((NOW_S + 7500) * 1000).toISOString()})`,
							"",
							"Session:",
							"- Opus 5.5: 1.2K in / 3K out / 12.3K cache read / 0 cache write",
							"- Cost: $3.46 | API 10m | Wall 30m",
						].join("\n"),
					],
				],
			},
		);
	});

	it("says there is no usage data yet with no limits and no stats", () =>
	{
		renderCard(
			{
				usage:
				{
					fiveHour: null,
					sevenDay: null,
					updatedAt: null,
					scoped: null,
				},
			},
		);

		expect(card().textContent).toBe(
			"No usage data yet — plan usage appears once limits load, and session usage after Claude’s first reply",
		);
	});
});

const NO_PLAN: UsageSummary =
{
	fiveHour: null,
	sevenDay: null,
	updatedAt: null,
	scoped: null,
};

function chipRows(): string[][]
{
	const title = screen.getByText("This session");
	const rows = title.nextElementSibling?.children ?? [];
	return [...rows].map((row) => [...row.children].map((chip) => chip.textContent));
}

/** The grid's tabindex, role and label: upstream makes it a labelled tab stop only while it overflows sideways. */
function scrollStop(grid: HTMLElement): (string | null)[]
{
	return [grid.getAttribute("tabindex"), grid.getAttribute("role"), grid.getAttribute("aria-label")];
}

function breakdown():
{
	columns: string;
	cells: string[];
}
{
	const grid = screen.getByText("Breakdown").parentElement!;
	return {
		columns: grid.style.gridTemplateColumns,
		cells: [...grid.children]
			.filter((cell) => cell.getAttribute("aria-hidden") === null)
			.map((cell) => cell.textContent),
	};
}

describe("SessionUsageCard session section", () =>
{
	it("chips Cost, API, Active, Lines, Web searches, family shares and Cache hit in rows of three", () =>
	{
		renderCard(
			{
				usage: NO_PLAN,
				stats: stats(
					{
						usage:
						{
							[OPUS]:
							{
								input: 100,
								output: 50,
								cacheRead: 300,
								cacheWrite: 100,
							},
						},
						result:
						{
							costUSD: 4,
							apiMs: 65_000,
							wallMs: 3_900_000,
							perModel:
							{
								[OPUS]:
								{
									costUSD: 3,
									webSearch: 2,
								},
								[HAIKU]:
								{
									costUSD: 1,
									webSearch: 0,
								},
							},
						},
						lineChanges:
						{
							added: 12,
							removed: 3,
						},
					},
				),
			},
		);
		const firstRow = screen.getByText("This session").nextElementSibling?.firstElementChild;
		const chip = firstRow?.firstElementChild;

		expect(
			{
				rowClass: firstRow?.className,
				chip: [
					chip?.className,
					chip?.firstElementChild?.className,
					chip?.firstElementChild?.firstElementChild?.className,
					chip?.lastElementChild?.className,
				],
				rows: chipRows(),
				lines: [screen.getByText("+12").className, screen.getByText("−3").className],
			},
		).toStrictEqual(
			{
				rowClass:
					"grid grid-cols-3 max-sm:grid-cols-1 gap-x-2.5 py-0.75 text-footnote first:pt-0 border-b-[0.5px] border-alpha-3",
				chip: [
					"inline-flex min-w-0 items-center gap-0.75 whitespace-nowrap",
					"min-w-0 text-secondary",
					"block min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap",
					"shrink-0 tabular-nums text-muted-as-secondary",
				],
				rows: [
					["Cost$4.00", "API1m 5s", "Active1h 5m"],
					["Lines+12 −3", "Web searches2", "Opus75%"],
					["Haiku25%", "Cache hit60%"],
				],
				lines: ["text-git-added", "text-git-removed"],
			},
		);
	});

	it("gives one model a single Breakdown column with no Total or Cost row", () =>
	{
		renderCard(
			{
				usage: NO_PLAN,
				stats: stats(
					{
						usage:
						{
							[OPUS]:
							{
								input: 1200,
								output: 3000,
								cacheRead: 12_345,
								cacheWrite: 999_999,
							},
						},
					},
				),
			},
		);

		const grid = screen.getByText("Breakdown").parentElement!;
		const modelHeader = screen.getByText("Opus 5.5").parentElement!;

		expect(
			{
				wrapper: grid.parentElement?.className,
				grid: grid.className,
				scrollStop: scrollStop(grid),
				modelHeader: [modelHeader.className, modelHeader.firstElementChild?.className],
			},
		).toStrictEqual(
			{
				wrapper: "rounded has-[>:focus-visible]:shadow-focus has-[>:focus-visible]:outline-hidden",
				grid: "grid items-center overflow-x-auto scroll-fade-x whitespace-nowrap tabular-nums focus-visible:outline-hidden gap-x-xs gap-y-0.75 text-footnote",
				scrollStop: [null, null, null],
				modelHeader: [
					"min-w-11 pb-0.5 text-end text-muted-as-secondary",
					"block min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap",
				],
			},
		);
		expect(breakdown()).toStrictEqual(
			{
				columns: "max-content repeat(1, 1fr)",
				cells: [
					"Breakdown",
					"Opus 5.5",
					"Input",
					"1.2K",
					"Output",
					"3K",
					"Cache read",
					"12.3K",
					"Cache write",
					"1M",
				],
			},
		);
	});

	it("adds a Total column for two models sorted by tokens, and a Cost row with – for a model without cost", () =>
	{
		// Wider than its box by more than upstream's 3px slack, so the grid becomes a labelled tab stop.
		vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(404);
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
		renderCard(
			{
				usage: NO_PLAN,
				stats: stats(
					{
						usage:
						{
							[HAIKU]:
							{
								input: 1,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
							},
							[OPUS]:
							{
								input: 2000,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
							},
						},
						result:
						{
							costUSD: 1.5,
							apiMs: 0,
							wallMs: 0,
							perModel:
							{
								[OPUS]:
								{
									costUSD: 1.5,
									webSearch: 0,
								},
							},
						},
					},
				),
			},
		);

		expect(breakdown()).toStrictEqual(
			{
				columns: "max-content repeat(3, 1fr)",
				cells: [
					"Breakdown",
					"Opus 5.5",
					"Haiku 4.5",
					"Total",
					"Input",
					"2K",
					"1",
					"2K",
					"Output",
					"0",
					"0",
					"0",
					"Cache read",
					"0",
					"0",
					"0",
					"Cache write",
					"0",
					"0",
					"0",
					"Cost",
					"$1.50",
					"–",
					"$1.50",
				],
			},
		);
		expect(scrollStop(screen.getByText("Breakdown").parentElement!)).toStrictEqual([
			"0",
			"group",
			"Table, scrolls sideways",
		]);
	});

	it("notes inaccurate costs when the cost-state saw an unknown model", () =>
	{
		renderCard(
			{
				usage: NO_PLAN,
				stats: stats(
					{
						result:
						{
							costUSD: 0,
							apiMs: 0,
							wallMs: 0,
							perModel: {},
						},
						hasUnknownModelCost: true,
					},
				),
			},
		);

		expect(screen.getByText("Costs may be inaccurate due to usage of unknown models.").className).toBe(
			"text-footnote text-muted-as-secondary",
		);
	});
});

describe("SessionUsageCard attribution", () =>
{
	const tokens =
	{
		[OPUS]:
		{
			input: 1,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
	};
	const seven = stats(
		{
			usage: tokens,
			attribution:
			{
				skills: [
					{
						name: "review",
						pct: 20,
					},
					{
						name: "plan",
						pct: 3,
					},
				],
				subagents: [
					{
						name: "Explore",
						pct: 15,
					},
					{
						name: "general-purpose",
						pct: 4,
					},
				],
				mcpServers: [
					{
						name: "github",
						pct: 30,
					},
					{
						name: "linear",
						pct: 2,
					},
					{
						name: "slack",
						pct: 1,
					},
				],
			},
		},
	);

	function rows(): string[]
	{
		const header = screen.getByText("What’s contributing (this session)");
		const list = header.nextElementSibling as HTMLElement;
		return [...list.children].map((row) => row.textContent);
	}

	it("lists the first five rows by share, then Show 2 more toggles to Show less", () =>
	{
		renderCard(
			{
				usage: NO_PLAN,
				stats: seven,
			},
		);
		const first = rows();
		const more = screen.getByRole(
			"button",
			{
				name: "Show 2 more",
			},
		);
		const collapsed = more.getAttribute("aria-expanded");
		fireEvent.click(more);
		const trigger = screen.getByText("github").closest("button");
		const row = trigger?.parentElement?.parentElement;
		const meter = row?.children[1]?.firstElementChild;

		expect(
			{
				first,
				collapsed,
				expanded: rows(),
				expandedAttr: more.getAttribute("aria-expanded"),
				row:
				{
					className: row?.className,
					trigger: trigger?.className,
					meter: [
						meter?.getAttribute("data-size"),
						meter?.parentElement?.className,
						meter?.className.split(" ").at(-1),
						meter?.firstElementChild?.className.split(" ")[3],
						(meter?.firstElementChild as HTMLElement | null | undefined)?.style.transform,
					],
					share: row?.lastElementChild?.className,
				},
			},
		).toStrictEqual(
			{
				first: [
					"githubMCPShare 30%",
					"/reviewSkillShare 20%",
					"ExploreSubagentShare 15%",
					"general-purposeSubagentShare 4%",
					"/planSkillShare 3%",
					"Show 2 more",
				],
				collapsed: "false",
				expanded: [
					"githubMCPShare 30%",
					"/reviewSkillShare 20%",
					"ExploreSubagentShare 15%",
					"general-purposeSubagentShare 4%",
					"/planSkillShare 3%",
					"linearMCPShare 2%",
					"slackMCPShare 1%",
					"Show less",
				],
				expandedAttr: "true",
				row:
				{
					className: "flex items-center gap-1.25 text-footnote",
					trigger: "flex items-center gap-0.75 flex-1 min-w-0 cursor-help text-start",
					meter: [
						"sm",
						"w-20 shrink-0",
						"bg-upstream-accent-pressed",
						"bg-fill-accent",
						"translateX(calc(var(--_meter-dir, -1) * (100% - min(100%, max(30.0%, 4px)))))",
					],
					share: "text-muted-as-secondary tabular-nums text-end w-9 shrink-0",
				},
			},
		);
	});

	it("tips the top MCP server with Open MCP servers, and a top subagent with no button", () =>
	{
		const handlers = renderCard(
			{
				usage: NO_PLAN,
				stats: seven,
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open MCP servers",
				},
			),
		);
		const mcpTip = screen.getByText("Tip").nextElementSibling?.textContent;
		cleanup();
		renderCard(
			{
				usage: NO_PLAN,
				stats: stats(
					{
						usage: tokens,
						attribution:
						{
							skills: [],
							subagents: [
								{
									name: "Explore",
									pct: 40,
								},
							],
							mcpServers: [
								{
									name: "github",
									pct: 9,
								},
							],
						},
					},
				),
			},
		);

		expect(
			{
				opened: handlers.onOpenMcpServers.mock.calls.length,
				mcpTip,
				subagentTip: screen.getByText("Tip").nextElementSibling?.textContent,
				subagentButton: screen.queryByRole(
					"button",
					{
						name: "Open MCP servers",
					},
				),
			},
		).toStrictEqual(
			{
				opened: 1,
				mcpTip: "MCP tool results stay in context for the rest of the session. Compacting clears them, or you can turn off servers you don’t need.",
				subagentTip:
					"Each subagent runs its own requests. Consider a cheaper model for simple subagents, or tighten their prompts.",
				subagentButton: null,
			},
		);
	});
});
