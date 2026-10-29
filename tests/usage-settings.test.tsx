// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {UsagePanel, UsageSettings} from "../src/components/settings/usage-settings";
import {apiFetch} from "../src/lib/api/client";
import {usageQueryOptions} from "../src/lib/api/usage";
import {formatUsageUpdated} from "../src/lib/usage";

const NOW_MS = Date.UTC(2026, 8, 28, 12, 0);
const NOW_SECONDS = NOW_MS / 1000;

vi.mock("../src/lib/api/client", () => ({
	apiFetch: vi.fn<(path: string) => Promise<unknown>>(),
}));

afterEach(() => {
	cleanup();
	vi.mocked(apiFetch).mockReset();
});

function renderUsageSettings() {
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	return render(
		<QueryClientProvider client={client}>
			<UsageSettings />
		</QueryClientProvider>,
	);
}

describe("UsageSettings", () => {
	it("shows upstream's usage-page skeleton while the first fetch is pending", () => {
		vi.mocked(apiFetch).mockImplementation(async () => new Promise(() => {}));
		renderUsageSettings();

		const skeleton = screen.getByTestId("usage-page-skeleton");
		expect({
			busy: skeleton.getAttribute("aria-busy"),
			inner: skeleton.firstElementChild?.className,
			blocks: [...skeleton.querySelectorAll("[data-cds=Skeleton]")].map((node) =>
				node.className.split(" ").slice(-3).join(" "),
			),
		}).toStrictEqual({
			busy: "true",
			inner: "space-y-6 py-3",
			blocks: [
				"mb-2 h-6 w-[180px]",
				"rounded h-5 w-[300px]",
				"rounded h-3 w-full",
				"rounded h-3 w-full",
				"rounded h-3 w-full",
			],
		});
	});

	it("shows upstream's error copy with a Try again button that refetches", async () => {
		vi.mocked(apiFetch).mockImplementation(async (path: string) =>
			path === "/api/usage"
				? Promise.reject(new Error("boom"))
				: Promise.resolve({name: "", firstName: "", initial: ""}),
		);
		renderUsageSettings();

		const message = await screen.findByText("Unable to load usage limits. Please try again later.");
		expect(message.parentElement?.className).toBe("flex flex-col items-start gap-2 text-footnote text-secondary");
		const usageCalls = () => vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/api/usage").length;
		expect(usageCalls()).toBe(1);

		fireEvent.click(screen.getByRole("button", {name: "Try again"}));
		await waitFor(() => {
			expect(usageCalls()).toBe(2);
		});
	});
});

describe("usageQueryOptions", () => {
	it("refetches every five minutes, on mount and on window focus like upstream", () => {
		expect({
			refetchInterval: usageQueryOptions.refetchInterval,
			refetchOnMount: usageQueryOptions.refetchOnMount,
			refetchOnWindowFocus: usageQueryOptions.refetchOnWindowFocus,
		}).toStrictEqual({refetchInterval: 300_000, refetchOnMount: "always", refetchOnWindowFocus: "always"});
	});
});

describe("UsagePanel", () => {
	it("renders the header, pace headline, meters and last-updated line", () => {
		const onRefresh = vi.fn<() => void>();
		render(
			<UsagePanel
				usage={{
					fiveHour: {usedPct: 16.4, resetsAt: Date.UTC(2026, 8, 28, 15, 40) / 1000},
					sevenDay: {usedPct: 66, resetsAt: NOW_SECONDS + 21 * 3_600},
					updatedAt: new Date(NOW_MS - 5_000).toISOString(),
				}}
				planDetail="Max (20x)"
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={onRefresh}
			/>,
		);

		expect(screen.getByRole("heading", {name: "Your usage"}).textContent).toBe("Your usage");
		expect(screen.getByText("Max (20x)").textContent).toBe("Max (20x)");
		expect(screen.getByTestId("usage-page-pace").textContent).toContain(
			"On track. You should reach tomorrow’s reset with room to spare.",
		);

		const meters = screen.getAllByRole("meter");
		expect(
			meters.map((meter) => ({
				name: meter.getAttribute("aria-labelledby")
					? document.getElementById(meter.getAttribute("aria-labelledby") ?? "")?.textContent
					: null,
				min: meter.getAttribute("aria-valuemin"),
				max: meter.getAttribute("aria-valuemax"),
				now: meter.getAttribute("aria-valuenow"),
				text: meter.getAttribute("aria-valuetext"),
			})),
		).toStrictEqual([
			{name: "Current session", min: "0", max: "100", now: "16", text: "16% used"},
			{name: "This week", min: "0", max: "100", now: "66", text: "66% used"},
		]);
		expect(screen.getByText("Resets at 3:40 PM").textContent).toBe("Resets at 3:40 PM");
		expect(screen.getByText("Resets Tuesday 9:00 AM").textContent).toBe("Resets Tuesday 9:00 AM");
		expect(screen.getAllByText(/% used$/).map((node) => node.textContent)).toStrictEqual(["16% used", "66% used"]);
		expect(screen.getByText("Last updated: less than a minute ago").textContent).toBe(
			"Last updated: less than a minute ago",
		);

		fireEvent.click(screen.getByRole("button", {name: "Refresh"}));
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it("copies upstream's header, headline and meter-section structure", () => {
		render(
			<UsagePanel
				usage={{
					fiveHour: {usedPct: 0, resetsAt: NOW_SECONDS + 3_600},
					sevenDay: {usedPct: 37, resetsAt: NOW_SECONDS + 21 * 3_600},
					updatedAt: new Date(NOW_MS).toISOString(),
				}}
				planDetail="Max (20x)"
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() => {}}
			/>,
		);

		const heading = screen.getByRole("heading", {name: "Your usage"});
		expect(heading.className).toBe("text-[15px] leading-[20px] font-[580] text-primary");
		const pace = screen.getByTestId("usage-page-pace");
		const headline = pace.querySelector("p");
		expect(headline?.className).toBe("text-[22px] leading-[28px] font-[580] text-primary");
		const section = pace.querySelector("section");
		expect(section?.className).toBe("mb-10 last:mb-0");
		const items = [...(section?.querySelectorAll("[data-settings-item]") ?? [])];
		expect(items.map((item) => item.className)).toStrictEqual([
			"flex flex-col items-start gap-3 py-3",
			"flex flex-col gap-5 py-3",
		]);
		expect(document.querySelector(".divide-y")).toBeNull();

		const [sessionMeter, weekMeter] = screen.getAllByRole("meter");
		expect(sessionMeter?.className).toContain("bg-alpha-1");
		expect(sessionMeter?.querySelector("[data-usage-bar-fill]")).toBeNull();
		expect(weekMeter?.className).toContain("bg-accent-900");
		const fill = weekMeter?.querySelector<HTMLElement>("[data-usage-bar-fill]");
		expect(fill?.style.transform).toContain("max(37%, 4px)");
	});

	it("colours the meters by severity", () => {
		render(
			<UsagePanel
				usage={{
					fiveHour: {usedPct: 80, resetsAt: NOW_SECONDS + 3_600},
					sevenDay: {usedPct: 95, resetsAt: NOW_SECONDS + 21 * 3_600},
					updatedAt: new Date(NOW_MS).toISOString(),
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() => {}}
			/>,
		);

		const [sessionMeter, weekMeter] = screen.getAllByRole("meter");
		expect(sessionMeter?.className).toContain("bg-usage-track-warning");
		expect(sessionMeter?.querySelector("[data-usage-bar-fill]")?.className).toContain("bg-usage-warning");
		expect(weekMeter?.className).toContain("bg-usage-track-danger");
		expect(weekMeter?.querySelector("[data-usage-bar-fill]")?.className).toContain("bg-usage-danger");
		expect(
			screen.getAllByText(/% used$/).map((node) => ({text: node.textContent, className: node.className})),
		).toStrictEqual([
			{text: "80% used", className: "min-w-20 whitespace-nowrap text-end text-footnote text-secondary"},
			{text: "95% used", className: "min-w-20 whitespace-nowrap text-end text-footnote text-danger"},
		]);
	});

	it("captions a session reset on another day with its short weekday and a passed reset as not started", () => {
		render(
			<UsagePanel
				usage={{
					fiveHour: {usedPct: 10, resetsAt: Date.UTC(2026, 8, 29, 1, 0) / 1000},
					sevenDay: {usedPct: 20, resetsAt: NOW_SECONDS - 60},
					updatedAt: new Date(NOW_MS).toISOString(),
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() => {}}
			/>,
		);

		expect(screen.getByText("Resets Tue 1:00 AM").textContent).toBe("Resets Tue 1:00 AM");
		expect(screen.getByText("Starts with your first message").textContent).toBe("Starts with your first message");
	});

	it("pauses the session row while the week is hit", () => {
		render(
			<UsagePanel
				usage={{
					fiveHour: {usedPct: 95, resetsAt: NOW_SECONDS + 3_600},
					sevenDay: {usedPct: 100, resetsAt: NOW_SECONDS + 21 * 3_600},
					updatedAt: new Date(NOW_MS).toISOString(),
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() => {}}
			/>,
		);

		expect(screen.getByText("Paused until your week resets").textContent).toBe("Paused until your week resets");
		expect(screen.getByText("Current session").className).toBe("text-body text-secondary");
		expect(screen.getByText("This week").className).toBe("text-body text-primary");
		const [sessionMeter, weekMeter] = screen.getAllByRole("meter");
		expect(sessionMeter?.parentElement?.className).toBe("flex-1 opacity-50");
		expect(weekMeter?.parentElement?.className).toBe("flex-1");
		expect(screen.getAllByText(/% used$/).map((node) => node.className)).toStrictEqual([
			"min-w-20 whitespace-nowrap text-end text-footnote text-secondary",
			"min-w-20 whitespace-nowrap text-end text-footnote text-danger",
		]);
	});

	it("clamps the meter to 0-100", () => {
		render(
			<UsagePanel
				usage={{
					fiveHour: {usedPct: 140, resetsAt: NOW_SECONDS + 60},
					sevenDay: null,
					updatedAt: new Date(NOW_MS).toISOString(),
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() => {}}
			/>,
		);

		const meter = screen.getByRole("meter");
		expect([meter.getAttribute("aria-valuenow"), meter.getAttribute("aria-valuetext")]).toStrictEqual([
			"100",
			"100% used",
		]);
	});

	it("shows the empty state when no session has reported rate limits", () => {
		render(
			<UsagePanel
				usage={{fiveHour: null, sevenDay: null, updatedAt: null}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() => {}}
			/>,
		);

		expect(screen.queryAllByRole("meter")).toStrictEqual([]);
		expect(screen.getByText("Usage appears after a Claude Code session reports its status line").textContent).toBe(
			"Usage appears after a Claude Code session reports its status line",
		);
	});

	it("copies upstream's footer and learn-more link", () => {
		render(
			<UsagePanel
				usage={{
					fiveHour: {usedPct: 10, resetsAt: NOW_SECONDS + 3_600},
					sevenDay: {usedPct: 20, resetsAt: NOW_SECONDS + 21 * 3_600},
					updatedAt: new Date(NOW_MS - 5 * 60_000).toISOString(),
				}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() => {}}
			/>,
		);

		const text = screen.getByText("Last updated: 5 minutes ago");
		expect(text.className).toBe("text-footnote text-secondary");
		const button = screen.getByRole("button", {name: "Refresh"});
		expect(button.getAttribute("title")).toBeNull();
		const group = text.parentElement;
		expect(group?.className).toBe("flex items-center gap-2");
		const item = group?.parentElement;
		expect(item?.className).toBe("flex items-center justify-between py-3");
		expect(item?.hasAttribute("data-settings-item")).toBe(true);
		expect(item?.closest("section")?.className).toBe("mt-2");

		const link = screen.getByRole("link", {name: "Learn more about usage limits(opens in new tab)"});
		expect({
			href: link.getAttribute("href"),
			target: link.getAttribute("target"),
			rel: link.getAttribute("rel"),
			wrapper: link.parentElement?.className,
		}).toStrictEqual({
			href: "https://support.claude.com/en/articles/11647753-understanding-usage-and-length-limits",
			target: "_blank",
			rel: "noopener",
			wrapper: "flex flex-col items-start gap-2 text-footnote",
		});
	});

	it("omits the footer but keeps the link when nothing has been reported", () => {
		render(
			<UsagePanel
				usage={{fiveHour: null, sevenDay: null, updatedAt: null}}
				nowMs={NOW_MS}
				timeZone="UTC"
				refreshing={false}
				onRefresh={() => {}}
			/>,
		);

		expect(screen.queryByRole("button", {name: "Refresh"})).toBeNull();
		expect(screen.queryByText(/^Last updated/)).toBeNull();
		expect(screen.getByRole("link", {name: "Learn more about usage limits(opens in new tab)"}).tagName).toBe("A");
	});
});

describe("formatUsageUpdated", () => {
	const iso = (msAgo: number) => new Date(NOW_MS - msAgo).toISOString();

	it("copies upstream's Tr wording", () => {
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
