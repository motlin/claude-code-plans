// @vitest-environment jsdom

import {fireEvent, render, type RenderResult} from "@testing-library/react";
import {describe, expect, it} from "vite-plus/test";
import {StatusFooter} from "../src/components/status-footer";

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

function renderFooter(data: Record<string, unknown>, messageCount: number): RenderResult {
	return render(<StatusFooter data={data} messageCount={messageCount} />);
}

function expand(view: RenderResult): Element | null {
	fireEvent.click(view.getByRole("button", {name: "Session details"}));
	return view.container.querySelector("[data-status-segments]");
}

function segmentTexts(view: RenderResult): string[] {
	const row = expand(view);
	return Array.from(row?.querySelectorAll("[data-status-segment]") ?? [], (el) => el.textContent);
}

describe("StatusFooter", () => {
	it("keeps the segments behind a collapsed details toggle", () => {
		const view = renderFooter(FULL_STATUSLINE, 2);
		const toggle = view.getByRole("button", {name: "Session details"});
		expect({
			expanded: toggle.getAttribute("aria-expanded"),
			segments: view.container.querySelector("[data-status-segments]"),
		}).toStrictEqual({expanded: "false", segments: null});
	});

	it("wraps status segments instead of scrolling them horizontally", () => {
		const view = renderFooter(FULL_STATUSLINE, 0);
		expect(expand(view)?.getAttribute("class")).toBe("flex flex-wrap items-center gap-1.5 px-4 py-2");
	});

	it("shows only the data with no upstream home", () => {
		expect(segmentTexts(renderFooter(FULL_STATUSLINE, 2))).toStrictEqual([
			"v1.0.23",
			"1m 0s · 2 msgs",
			"97.0k (42%) / 200.0k",
			"5h:18% 7d:5%",
			"$1.47",
		]);
	});

	it("omits the message count when the session is empty", () => {
		expect(segmentTexts(renderFooter({cost: {total_duration_ms: 60_000}}, 0))).toStrictEqual(["1m 0s"]);
	});

	it("renders nothing when no segment has data", () => {
		const view = renderFooter({cwd: "/work/x", model: {display_name: "Opus"}}, 0);
		expect(view.container.innerHTML).toBe("");
	});
});
