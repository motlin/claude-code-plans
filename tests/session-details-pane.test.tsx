// @vitest-environment jsdom

import {cleanup, fireEvent, render, type RenderResult} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {SessionDetails} from "../src/components/panes/session-details-pane";

const FULL_STATUSLINE = {
	cwd: "/work/claude-code-plans",
	version: "1.0.23",
	cost: {
		total_duration_ms: 60_000,
		total_cost_usd: 1.47,
		total_lines_added: 245,
		total_lines_removed: 89,
	},
	context_window: {
		used_percentage: 42,
		total_input_tokens: 85_000,
		total_output_tokens: 12_000,
		context_window_size: 200_000,
	},
	model: {display_name: "Claude Sonnet 4"},
	rate_limits: {five_hour: {used_percentage: 18}, seven_day: {used_percentage: 5}},
};

function renderDetails(data: Record<string, unknown>, messageCount: number): RenderResult {
	return render(<SessionDetails data={data} messageCount={messageCount} />);
}

function segmentTexts(view: RenderResult): string[] {
	return Array.from(view.container.querySelectorAll("[data-status-segment]"), (el) => el.textContent);
}

afterEach(() => {
	cleanup();
});

describe("SessionDetails", () => {
	it("shows the segments without a details toggle", () => {
		const view = renderDetails(FULL_STATUSLINE, 2);
		expect({
			toggle: view.queryByRole("button", {name: "Session details"}),
			rowClass: view.container.querySelector("[data-status-segments]")?.getAttribute("class"),
		}).toStrictEqual({toggle: null, rowClass: "flex flex-wrap items-center gap-1.5"});
	});

	it("shows only the data with no upstream home", () => {
		expect(segmentTexts(renderDetails(FULL_STATUSLINE, 2))).toStrictEqual([
			"v1.0.23",
			"1m 0s · 2 msgs",
			"97.0k (42%) / 200.0k",
			"5h:18% 7d:5%",
			"$1.47",
		]);
	});

	it("omits the message count when the session is empty", () => {
		expect(segmentTexts(renderDetails({cost: {total_duration_ms: 60_000}}, 0))).toStrictEqual(["1m 0s"]);
	});

	it("says so when no segment has data", () => {
		const view = renderDetails({cwd: "/work/x", model: {display_name: "Opus"}}, 0);
		expect({
			segments: segmentTexts(view),
			empty: view.getByText("No session details yet.").tagName,
		}).toStrictEqual({segments: [], empty: "P"});
	});

	it("reveals the raw statusline JSON on demand", () => {
		const view = renderDetails({version: "1.0.23"}, 0);
		const before = view.container.querySelector("pre");
		fireEvent.click(view.getByRole("button", {name: "Show raw JSON"}));
		expect({
			before,
			raw: view.container.querySelector("pre")?.textContent,
			toggle: view.getByRole("button", {name: "Hide raw JSON"}).getAttribute("aria-expanded"),
		}).toStrictEqual({before: null, raw: JSON.stringify({version: "1.0.23"}, null, 2), toggle: "true"});
	});
});
