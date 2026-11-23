// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {UsagePanel, UsageSettings} from "../src/components/settings/usage-settings";
import {apiFetch} from "../src/lib/api/client";
import {usageQueryOptions} from "../src/lib/api/usage";
import {formatUsageUpdated, type ScopedUsage, type UsageSummary} from "../src/lib/usage";

const NOW_MS = Date.UTC(2026, 8, 28, 12, 0);
const NOW_SECONDS = NOW_MS / 1000;

vi.mock("../src/lib/api/client", () => (
{
	apiFetch: vi.fn<(path: string) => Promise<unknown>>(),
}));

afterEach(() =>
{
	cleanup();
	vi.mocked(apiFetch).mockReset();
});

function renderUsageSettings()
{
	const client = new QueryClient(
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
	return render(
		<QueryClientProvider client={client}>
			<UsageSettings />
		</QueryClientProvider>,
	);
}

describe("UsageSettings", () =>
{
	it("shows upstream's usage-page skeleton while the first fetch is pending", () =>
	{
		vi.mocked(apiFetch).mockImplementation(async () => new Promise(() => {}));
		renderUsageSettings();

		const skeleton = screen.getByTestId("usage-page-skeleton");
		expect(
			{
				busy: skeleton.getAttribute("aria-busy"),
				inner: skeleton.firstElementChild?.className,
				blocks: [...skeleton.querySelectorAll("[data-cds=Skeleton]")].map((node) =>
					node.className.split(" ").slice(-3).join(" "),
				),
			},
		).toStrictEqual(
			{
				busy: "true",
				inner: "space-y-6 py-3",
				blocks: [
					"mb-2 h-6 w-[180px]",
					"rounded h-5 w-[300px]",
					"rounded h-3 w-full",
					"rounded h-3 w-full",
					"rounded h-3 w-full",
				],
			},
		);
	});

	it("shows upstream's error copy with a Try again button that refetches", async () =>
	{
		vi.mocked(apiFetch).mockImplementation(async (path: string) =>
			path === "/api/usage"
				? Promise.reject(new Error("boom"))
				: Promise.resolve(
						{
							name: "",
							firstName: "",
							initial: "",
						},
					),
		);
		renderUsageSettings();

		const message = await screen.findByText("Unable to load usage limits. Please try again later.");
		expect(message.parentElement?.className).toBe("flex flex-col items-start gap-2 text-footnote text-secondary");
		const usageCalls = () => vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/api/usage").length;
		expect(usageCalls()).toBe(1);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Try again",
				},
			),
		);
		await waitFor(() =>
		{
			expect(usageCalls()).toBe(2);
		});
	});
});

describe("usageQueryOptions", () =>
{
	it("refetches every five minutes, on mount and on window focus like upstream", () =>
	{
		expect(
			{
				refetchInterval: usageQueryOptions.refetchInterval,
				refetchOnMount: usageQueryOptions.refetchOnMount,
				refetchOnWindowFocus: usageQueryOptions.refetchOnWindowFocus,
			},
		).toStrictEqual(
			{
				refetchInterval: 300_000,
				refetchOnMount: "always",
				refetchOnWindowFocus: "always",
			},
		);
	});
});

describe("UsagePanel", () =>
{
	it("renders the header, pace headline, meters and last-updated line", () =>
	{
		const onRefresh = vi.fn<() => void>();
		render(
			<UsagePanel
				usage={
				{
					fiveHour:
					{
						usedPct: 16.4,
						resetsAt: Date.UTC(2026, 8, 28, 15, 40) / 1000,
					},
					sevenDay:
					{
						usedPct: 66,
						resetsAt: NOW_SECONDS + 21 * 3_600,
					},
					updatedAt: new Date(NOW_MS - 5_000).toISOString(),
					scoped: null,
				}}
				planDetail="Max (20x)"
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={onRefresh}
			/>,
		);

		expect(
			screen.getByRole(
				"heading",
				{
					name: "Your usage",
				},
			).textContent,
		).toBe("Your usage");
		expect(screen.getByText("Max (20x)").textContent).toBe("Max (20x)");
		expect(screen.getByTestId("usage-page-pace").textContent).toContain(
			"On track. You should reach tomorrow’s reset with room to spare.",
		);
		const usageBars = screen.getByTestId("usage-page-pace").parentElement;
		expect(
			{
				surface: usageBars?.dataset["usageBars"],
				className: usageBars?.className,
				crossfade: usageBars?.hasAttribute("data-usage-bars-crossfade"),
				firstChild: usageBars?.firstElementChild?.getAttribute("data-testid"),
			},
		).toStrictEqual(
			{
				surface: "usage_page",
				className: "contents",
				crossfade: true,
				firstChild: "usage-page-pace",
			},
		);

		const meters = screen.getAllByRole("meter");
		expect(
			meters.map((meter) => (
			{
				name: meter.getAttribute("aria-labelledby")
					? document.getElementById(meter.getAttribute("aria-labelledby") ?? "")?.textContent
					: null,
				min: meter.getAttribute("aria-valuemin"),
				max: meter.getAttribute("aria-valuemax"),
				now: meter.getAttribute("aria-valuenow"),
				text: meter.getAttribute("aria-valuetext"),
			})),
		).toStrictEqual([
			{
				name: "Current session",
				min: "0",
				max: "100",
				now: "16",
				text: "16% used",
			},
			{
				name: "This week",
				min: "0",
				max: "100",
				now: "66",
				text: "66% used",
			},
		]);
		expect(screen.getByText("Resets at 3:40 PM").textContent).toBe("Resets at 3:40 PM");
		expect(screen.getByText("Resets Tuesday 9:00 AM").textContent).toBe("Resets Tuesday 9:00 AM");
		expect(screen.getAllByText(/% used$/).map((node) => node.textContent)).toStrictEqual(["16% used", "66% used"]);
		expect(screen.getByText("Last updated: less than a minute ago").textContent).toBe(
			"Last updated: less than a minute ago",
		);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Refresh",
				},
			),
		);
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it("copies upstream's header, headline and meter-section structure", () =>
	{
		render(
			<UsagePanel
				usage={
				{
					fiveHour:
					{
						usedPct: 0,
						resetsAt: NOW_SECONDS + 3_600,
					},
					sevenDay:
					{
						usedPct: 37,
						resetsAt: NOW_SECONDS + 21 * 3_600,
					},
					updatedAt: new Date(NOW_MS).toISOString(),
					scoped: null,
				}}
				planDetail="Max (20x)"
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() =>
				{
				}}
			/>,
		);

		const heading = screen.getByRole(
			"heading",
			{
				name: "Your usage",
			},
		);
		expect(heading.className).toBe("text-[15px] leading-[20px] font-[580] text-primary");
		expect(heading.hasAttribute("data-settings-group-title")).toBe(true);
		const pace = screen.getByTestId("usage-page-pace");
		const headline = screen.getByRole(
			"heading",
			{
				level: 3,
			},
		);
		expect(
			{
				text: headline.textContent,
				className: headline.className,
				groupTitle: headline.hasAttribute("data-settings-group-title"),
			},
		).toStrictEqual(
			{
				text: "On track. You should reach tomorrow’s reset with room to spare.",
				className: "text-[15px] leading-[20px] font-[580] text-primary",
				groupTitle: true,
			},
		);
		expect(pace.querySelector("p")).toBeNull();
		const section = pace.querySelector("section");
		expect(section?.className).toBe("mb-10 last:mb-0");
		const items = [...(section?.querySelectorAll("[data-settings-item]") ?? [])];
		expect(items.map((item) => item.className)).toStrictEqual([
			"flex flex-col items-start gap-3 py-3",
			"flex flex-col gap-5 py-3",
		]);
		const meterItem = items[1];
		expect([...(meterItem?.children ?? [])].map((child) => child.className)).toStrictEqual(["flex flex-col gap-5"]);
		expect(meterItem?.firstElementChild?.querySelectorAll(":scope > [data-usage-row]").length).toBe(2);
		expect(document.querySelector(".divide-y")).toBeNull();

		// Upstream's `ze` is the shared cds Meter at size sm.
		const meterShape = (meter: HTMLElement | undefined) => (
		{
			wrapper:
			{
				cds: meter?.parentElement?.getAttribute("data-cds"),
				className: meter?.parentElement?.className,
			},
			size: meter?.getAttribute("data-size"),
			className: meter?.className,
			fill:
				meter?.querySelector<HTMLElement>("[data-usage-bar-fill]") === null
					? null
					:
						{
							className: meter?.querySelector<HTMLElement>("[data-usage-bar-fill]")?.className,
							transform: meter?.querySelector<HTMLElement>("[data-usage-bar-fill]")?.style.transform,
						},
		});
		const [sessionMeter, weekMeter] = screen.getAllByRole("meter");
		const FORCED =
			"forced-color-adjust-none forced-colors:bg-[color:Canvas] forced-colors:outline forced-colors:outline-[color:CanvasText]";
		expect([meterShape(sessionMeter), meterShape(weekMeter)]).toStrictEqual([
			{
				wrapper:
				{
					cds: "Meter",
					className: "w-full",
				},
				size: "sm",
				className: `w-full overflow-hidden rounded-full ${FORCED} h-1 bg-neutral relative`,
				fill: null,
			},
			{
				wrapper:
				{
					cds: "Meter",
					className: "w-full",
				},
				size: "sm",
				className: `w-full overflow-hidden rounded-full ${FORCED} h-1 bg-upstream-accent-pressed relative`,
				fill:
				{
					className:
						"h-full w-full rounded-full bg-fill-accent transition-transform duration-200 ease-[cubic-bezier(.165,.84,.44,1)] motion-reduce:transition-none rtl:[--_meter-dir:1]",
					transform: "translateX(calc(var(--_meter-dir, -1) * (100% - min(100%, max(37.0%, 4px)))))",
				},
			},
		]);
	});

	it("colours the meters by severity", () =>
	{
		render(
			<UsagePanel
				usage={
				{
					fiveHour:
					{
						usedPct: 80,
						resetsAt: NOW_SECONDS + 3_600,
					},
					sevenDay:
					{
						usedPct: 95,
						resetsAt: NOW_SECONDS + 21 * 3_600,
					},
					updatedAt: new Date(NOW_MS).toISOString(),
					scoped: null,
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() =>
				{
				}}
			/>,
		);

		const [sessionMeter, weekMeter] = screen.getAllByRole("meter");
		expect(sessionMeter?.className).toContain("bg-usage-track-warning");
		expect(sessionMeter?.querySelector("[data-usage-bar-fill]")?.className).toContain("bg-usage-warning");
		expect(weekMeter?.className).toContain("bg-usage-track-danger");
		expect(weekMeter?.querySelector("[data-usage-bar-fill]")?.className).toContain("bg-usage-danger");
		expect(
			screen.getAllByText(/% used$/).map((node) => (
			{
				text: node.textContent,
				className: node.className,
			})),
		).toStrictEqual([
			{
				text: "80% used",
				className: "min-w-20 whitespace-nowrap text-end text-footnote text-secondary",
			},
			{
				text: "95% used",
				className: "min-w-20 whitespace-nowrap text-end text-footnote text-danger",
			},
		]);
	});

	it("captions a session reset on another day with its short weekday and a passed reset as not started", () =>
	{
		render(
			<UsagePanel
				usage={
				{
					fiveHour:
					{
						usedPct: 10,
						resetsAt: Date.UTC(2026, 8, 29, 1, 0) / 1000,
					},
					sevenDay:
					{
						usedPct: 20,
						resetsAt: NOW_SECONDS - 60,
					},
					updatedAt: new Date(NOW_MS).toISOString(),
					scoped: null,
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() =>
				{
				}}
			/>,
		);

		expect(screen.getByText("Resets Tue 1:00 AM").textContent).toBe("Resets Tue 1:00 AM");
		expect(screen.getByText("Starts with your first message").textContent).toBe("Starts with your first message");
	});

	it("pauses the session row while the week is hit", () =>
	{
		render(
			<UsagePanel
				usage={
				{
					fiveHour:
					{
						usedPct: 95,
						resetsAt: NOW_SECONDS + 3_600,
					},
					sevenDay:
					{
						usedPct: 100,
						resetsAt: NOW_SECONDS + 21 * 3_600,
					},
					updatedAt: new Date(NOW_MS).toISOString(),
					scoped: null,
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() =>
				{
				}}
			/>,
		);

		expect(screen.getByText("Paused until your week resets").textContent).toBe("Paused until your week resets");
		expect(screen.getByText("Current session").className).toBe("text-body text-secondary");
		expect(screen.getByText("This week").className).toBe("text-body text-primary");
		const [sessionMeter, weekMeter] = screen.getAllByRole("meter");
		expect(sessionMeter?.parentElement?.parentElement?.className).toBe("flex-1 opacity-50");
		expect(weekMeter?.parentElement?.parentElement?.className).toBe("flex-1");
		expect(screen.getAllByText(/% used$/).map((node) => node.className)).toStrictEqual([
			"min-w-20 whitespace-nowrap text-end text-footnote text-secondary",
			"min-w-20 whitespace-nowrap text-end text-footnote text-danger",
		]);
	});

	it("clamps the meter to 0-100", () =>
	{
		render(
			<UsagePanel
				usage={
				{
					fiveHour:
					{
						usedPct: 140,
						resetsAt: NOW_SECONDS + 60,
					},
					sevenDay: null,
					updatedAt: new Date(NOW_MS).toISOString(),
					scoped: null,
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() =>
				{
				}}
			/>,
		);

		const meter = screen.getByRole("meter");
		expect([meter.getAttribute("aria-valuenow"), meter.getAttribute("aria-valuetext")]).toStrictEqual([
			"100",
			"100% used",
		]);
	});

	it("shows the empty state when no session has reported rate limits", () =>
	{
		render(
			<UsagePanel
				usage={
				{
					fiveHour: null,
					sevenDay: null,
					updatedAt: null,
					scoped: null,
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() =>
				{
				}}
			/>,
		);

		expect(screen.queryAllByRole("meter")).toStrictEqual([]);
		expect(screen.getByText("Usage appears after a Claude Code session reports its status line").textContent).toBe(
			"Usage appears after a Claude Code session reports its status line",
		);
	});

	it("copies upstream's footer and learn-more link", () =>
	{
		render(
			<UsagePanel
				usage={
				{
					fiveHour:
					{
						usedPct: 10,
						resetsAt: NOW_SECONDS + 3_600,
					},
					sevenDay:
					{
						usedPct: 20,
						resetsAt: NOW_SECONDS + 21 * 3_600,
					},
					updatedAt: new Date(NOW_MS - 5 * 60_000).toISOString(),
					scoped: null,
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() =>
				{
				}}
			/>,
		);

		const text = screen.getByText("Last updated: 5 minutes ago");
		expect(text.className).toBe("text-footnote text-secondary");
		const button = screen.getByRole(
			"button",
			{
				name: "Refresh",
			},
		);
		expect(button.getAttribute("title")).toBeNull();
		const group = text.parentElement;
		expect(group?.className).toBe("flex items-center gap-2");
		const item = group?.parentElement;
		expect(item?.className).toBe("flex items-center justify-between py-3");
		expect(item?.hasAttribute("data-settings-item")).toBe(true);
		expect(item?.closest("section")?.className).toBe("mt-2");

		const link = screen.getByRole(
			"link",
			{
				name: "Learn more about usage limits",
				description: "(opens in new tab)",
			},
		);
		const hint = link.querySelector("span.sr-only[hidden]");
		expect(
			{
				href: link.getAttribute("href"),
				target: link.getAttribute("target"),
				rel: link.getAttribute("rel"),
				wrapper: link.parentElement?.className,
				describedByHint: hint !== null && hint.id === link.getAttribute("aria-describedby"),
			},
		).toStrictEqual(
			{
				href: "https://support.claude.com/en/articles/11647753-understanding-usage-and-length-limits",
				target: "_blank",
				rel: "noopener",
				wrapper: "flex flex-col items-start gap-2 text-footnote",
				describedByHint: true,
			},
		);
	});

	it("omits the footer but keeps the link when nothing has been reported", () =>
	{
		render(
			<UsagePanel
				usage={
				{
					fiveHour: null,
					sevenDay: null,
					updatedAt: null,
					scoped: null,
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() =>
				{
				}}
			/>,
		);

		expect(
			screen.queryByRole(
				"button",
				{
					name: "Refresh",
				},
			),
		).toBeNull();
		expect(screen.queryByText(/^Last updated/)).toBeNull();
		expect(
			screen.getByRole(
				"link",
				{
					name: "Learn more about usage limits",
					description: "(opens in new tab)",
				},
			).tagName,
		).toBe("A");
	});
});

// The live 2026-11-06 usage body: weekly 45% plus a Fable-only weekly row with a 50% allowance,
// both resetting Tue Nov 10 3:00 AM in New York.
const FOLD_NOW_MS = Date.UTC(2026, 10, 6, 12);
const FOLD_ZONE = "America/New_York";
const FOLD_RESETS_AT = "2026-11-10T08:00:00.395665+00:00";

function foldScoped({
	used = 0,
	fablePercent = 0,
	shares = true,
}:
{
	used?: number;
	fablePercent?: number;
	shares?: boolean;
} = {}): ScopedUsage
{
	return {
		limits: [
			{
				kind: "weekly_all",
				group: "weekly",
				percent: 45,
				severity: "normal",
				resets_at: FOLD_RESETS_AT,
				scope: null,
				is_active: true,
			},
			{
				kind: "weekly_scoped",
				group: "weekly",
				percent: fablePercent,
				severity: "normal",
				resets_at: FOLD_RESETS_AT,
				scope:
				{
					model:
					{
						id: null,
						display_name: "Fable",
					},
					surface: null,
				},
				is_active: false,
			},
		],
		shares: shares
			? [
					{
						limit_index: 1,
						used_percent_of_weekly: used,
						allowance_percent_of_weekly: 50,
					},
				]
			: [],
		fetchedAt: new Date(FOLD_NOW_MS - 60_000).toISOString(),
	};
}

function foldUsage(scoped: ScopedUsage | null, sevenDay = true): UsageSummary
{
	return {
		fiveHour: null,
		sevenDay: sevenDay
			?
				{
					usedPct: 45,
					resetsAt: Date.parse(FOLD_RESETS_AT) / 1000,
				}
			: null,
		updatedAt: null,
		scoped,
	};
}

function renderFold(usage: UsageSummary, defaultModel?: string | null)
{
	return render(
		<UsagePanel
			usage={usage}
			nowMs={FOLD_NOW_MS}
			timeZone={FOLD_ZONE}
			refreshing={false}
			onRefresh={() =>
			{
			}}
			defaultModel={defaultModel}
		/>,
	);
}

function foldState()
{
	const fold = screen.getByTestId("pace-week");
	const toggle = screen.getByTestId("pace-week-toggle");
	const panel = screen.queryByTestId("pace-week-scoped");
	return {
		state: fold.getAttribute("data-state"),
		expanded: toggle.getAttribute("aria-expanded"),
		controlsPanel: toggle.hasAttribute("aria-controls")
			? toggle.getAttribute("aria-controls") === panel?.parentElement?.id
			: null,
		caretRotated: toggle.querySelector("svg")?.classList.contains("rotate-180") ?? null,
		panel: panel === null ? null : panel.className,
	};
}

function rowText(row: Element)
{
	const caption = row.querySelector(".text-footnote.text-secondary");
	return {
		label: row.querySelector("[id]")?.textContent,
		caption: [...(caption?.querySelectorAll("span.block") ?? [])].map((span) => span.textContent),
		used: row.querySelector("[role=meter]")?.getAttribute("aria-valuetext"),
	};
}

function weekShare()
{
	const meter = screen.getByRole(
		"meter",
		{
			name: "This week",
		},
	);
	const span = meter.querySelector<HTMLElement>("[data-testid=usage-meter-share]");
	return span === null
		? null
		:
			{
				share: span.getAttribute("data-share"),
				inlineSize: span.style.inlineSize,
			};
}

describe("UsagePanel This week fold", () =>
{
	it("starts closed with the toggle as the week row's label", () =>
	{
		renderFold(foldUsage(foldScoped()));

		const toggle = screen.getByTestId("pace-week-toggle");
		expect(
			{
				...foldState(),
				tag: toggle.tagName,
				type: toggle.getAttribute("type"),
				text: toggle.textContent,
				className: toggle.className,
				caret: toggle.querySelector("svg")?.getAttribute("class"),
				root: screen.getByTestId("pace-week").className,
				meterNamed: screen
					.getByRole(
						"meter",
						{
							name: "This week",
						},
					)
					.getAttribute("aria-valuetext"),
			},
		).toStrictEqual(
			{
				state: "closed",
				expanded: "false",
				controlsPanel: null,
				caretRotated: false,
				panel: null,
				tag: "BUTTON",
				type: "button",
				text: "This week",
				className:
					"cds-reset group/clp inline-flex w-fit items-center gap-1.5 border-0 select-none outline-none focus-visible:outline-hidden font-sans font-control-regular hover:text-primary transition-shadow duration-[60ms] focus-visible:shadow-focus rounded data-[disabled]:opacity-40 data-[disabled]:pointer-events-none text-body text-primary",
				caret: expect.stringContaining("text-secondary transition-transform") as string,
				root: "flex flex-col",
				meterNamed: "45% used",
			},
		);
	});

	it("opens to one nested Fable row with its allowance and long reset", () =>
	{
		renderFold(foldUsage(foldScoped()));
		fireEvent.click(screen.getByTestId("pace-week-toggle"));

		const rows = screen.getByTestId("pace-week-scoped").querySelectorAll("[data-usage-row]");
		expect(
			{
				...foldState(),
				rows: [...rows].map(rowText),
			},
		).toStrictEqual(
			{
				state: "open",
				expanded: "true",
				controlsPanel: true,
				caretRotated: true,
				panel: "flex flex-col gap-5 pt-4",
				rows: [
					{
						label: "Fable",
						caption: ["Up to 50% of your weekly limit", "Resets Tuesday 3:00 AM"],
						used: "0% used",
					},
				],
			},
		);
	});

	it("toggles closed and open again from the focused toggle, keeping focus", () =>
	{
		renderFold(foldUsage(foldScoped()));
		const toggle = screen.getByTestId("pace-week-toggle");
		toggle.focus();

		fireEvent.click(toggle);
		const opened = foldState().state;
		fireEvent.click(toggle);
		const closed = foldState().state;

		expect(
			{
				opened,
				closed,
				focused: document.activeElement === toggle,
			},
		).toStrictEqual(
			{
				opened: "open",
				closed: "closed",
				focused: true,
			},
		);
	});

	it("captions a nested row without a share with its reset only", () =>
	{
		renderFold(
			foldUsage(
				foldScoped(
					{
						shares: false,
					},
				),
			),
		);
		fireEvent.click(screen.getByTestId("pace-week-toggle"));

		expect(
			[...screen.getByTestId("pace-week-scoped").querySelectorAll("[data-usage-row]")].map(rowText),
		).toStrictEqual([
			{
				label: "Fable",
				caption: ["Resets Tuesday 3:00 AM"],
				used: "0% used",
			},
		]);
	});

	it("keeps today's flat week row without scoped rows", () =>
	{
		renderFold(foldUsage(null));

		expect(
			{
				fold: screen.queryByTestId("pace-week"),
				toggle: screen.queryByTestId("pace-week-toggle"),
				week: screen.getByText("This week").tagName,
				caption: screen.getByText("Resets Tuesday 3:00 AM").className,
			},
		).toStrictEqual(
			{
				fold: null,
				toggle: null,
				week: "SPAN",
				caption: "text-footnote text-secondary",
			},
		);
	});

	it("shows a flat Fable this week row when there is no week to nest under", () =>
	{
		renderFold(foldUsage(foldScoped(), false));

		expect(
			{
				fold: screen.queryByTestId("pace-week"),
				rows: [...document.querySelectorAll("[data-usage-row]")].map((row) => (
				{
					label: row.querySelector("[id]")?.textContent,
					caption: row.querySelector(".text-footnote.text-secondary")?.textContent,
				})),
			},
		).toStrictEqual(
			{
				fold: null,
				rows: [
					{
						label: "Fable this week",
						caption: "Separate weekly limit for Fable · Resets Tuesday 3:00 AM",
					},
				],
			},
		);
	});

	it("paints the models' used share over the week meter only while open", () =>
	{
		renderFold(
			foldUsage(
				foldScoped(
					{
						used: 10,
						fablePercent: 20,
					},
				),
			),
		);
		const closed = weekShare();
		fireEvent.click(screen.getByTestId("pace-week-toggle"));
		const opened = weekShare();
		const nested = screen
			.getByTestId("pace-week-scoped")
			.querySelector("[data-testid=usage-meter-share]")
			?.getAttribute("data-share");
		fireEvent.click(screen.getByTestId("pace-week-toggle"));

		expect(
			{
				closed,
				opened,
				nested,
				reclosed: weekShare(),
			},
		).toStrictEqual(
			{
				closed: null,
				opened:
				{
					share: "10",
					inlineSize: "10%",
				},
				nested: "20",
				reclosed: null,
			},
		);
	});

	it.each([
		{
			model: "claude-fable-1",
			state: "open",
		},
		{
			model: "mythos",
			state: "open",
		},
		{
			model: "opus",
			state: "closed",
		},
		{
			model: null,
			state: "closed",
		},
	])("opens by default for the $model default model: $state", ({model, state}) =>
	{
		renderFold(foldUsage(foldScoped()), model);

		expect(screen.getByTestId("pace-week").getAttribute("data-state")).toBe(state);
	});

	it("keeps the user's choice across new usage data", () =>
	{
		const {rerender} = renderFold(foldUsage(foldScoped()), "claude-fable-1");
		fireEvent.click(screen.getByTestId("pace-week-toggle"));
		rerender(
			<UsagePanel
				usage={foldUsage(
					foldScoped(
						{
							used: 5,
						},
					),
				)}
				nowMs={FOLD_NOW_MS + 300_000}
				timeZone={FOLD_ZONE}
				refreshing={false}
				onRefresh={() =>
				{
				}}
				defaultModel="claude-fable-1"
			/>,
		);

		expect(screen.getByTestId("pace-week").getAttribute("data-state")).toBe("closed");
	});
});

describe("UsagePanel meter share overlay", () =>
{
	function meterSpans(usedPct: number, scoped: ScopedUsage | null)
	{
		cleanup();
		renderFold(
			{
				...foldUsage(scoped),
				sevenDay:
				{
					usedPct,
					resetsAt: Date.parse(FOLD_RESETS_AT) / 1000,
				},
			},
			"claude-fable-1",
		);
		const meter = screen.getByRole(
			"meter",
			{
				name: "This week",
			},
		);
		const span = meter.querySelector<HTMLElement>("[data-testid=usage-meter-share]");
		return {
			children: meter.children.length,
			span:
				span === null
					? null
					:
						{
							share: span.getAttribute("data-share"),
							className: span.className,
							inlineSize: span.style.inlineSize,
							minInlineSize: span.style.minInlineSize,
							hidden: span.getAttribute("aria-hidden"),
						},
		};
	}

	it("draws the share span capped by the fill, and nothing at 0%", () =>
	{
		expect(
			{
				share20: meterSpans(
					45,
					foldScoped(
						{
							used: 20,
						},
					),
				),
				share0: meterSpans(45, foldScoped()),
				capped: meterSpans(
					30,
					foldScoped(
						{
							used: 40,
						},
					),
				).span?.inlineSize,
				empty: meterSpans(
					0,
					foldScoped(
						{
							used: 20,
						},
					),
				),
			},
		).toStrictEqual(
			{
				share20:
				{
					children: 2,
					span:
					{
						share: "20",
						className:
							"absolute inset-y-0 start-0 rounded-full data-[share=0]:opacity-0 bg-usage-share-accent",
						inlineSize: "20%",
						minInlineSize: "4px",
						hidden: "true",
					},
				},
				share0:
				{
					children: 1,
					span: null,
				},
				capped: "30%",
				empty:
				{
					children: 0,
					span: null,
				},
			},
		);
	});

	it("hides a share-toned warning meter's span", () =>
	{
		renderFold(
			foldUsage(
				foldScoped(
					{
						used: 10,
						fablePercent: 80,
					},
				),
			),
			"claude-fable-1",
		);
		const span = screen
			.getByTestId("pace-week-scoped")
			.querySelector<HTMLElement>("[data-testid=usage-meter-share]");

		expect(
			{
				share: span?.getAttribute("data-share"),
				className: span?.className,
				inlineSize: span?.style.inlineSize,
			},
		).toStrictEqual(
			{
				share: "0",
				className: "absolute inset-y-0 start-0 rounded-full data-[share=0]:opacity-0 bg-usage-share-warning",
				inlineSize: "80%",
			},
		);
	});
});

describe("formatUsageUpdated", () =>
{
	const iso = (msAgo: number) => new Date(NOW_MS - msAgo).toISOString();

	it("copies upstream's Tr wording", () =>
	{
		expect(
			[0, -5_000, 30_000, 60_000, 5 * 60_000, 59 * 60_000 + 59_000, 2 * 3_600_000].map((msAgo) =>
				formatUsageUpdated(iso(msAgo), NOW_MS, "UTC"),
			),
		).toStrictEqual([
			"Last updated: just now",
			"Last updated: just now",
			"Last updated: less than a minute ago",
			"Last updated: 1 minute ago",
			"Last updated: 5 minutes ago",
			"Last updated: 59 minutes ago",
			"Last updated: 10:00 AM",
		]);
	});
});
