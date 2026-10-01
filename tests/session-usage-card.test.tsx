// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {Composer} from "../src/components/composer";
import {SessionUsageCard} from "../src/components/session-usage-card";
import type {ComposerState} from "../src/lib/composer-state";
import {USAGE_RECORDS} from "./fixtures/usage-records";

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
});

const CHIN: ComposerState = {
	mode: {id: "default", label: "Manual"},
	model: "Opus 5.5",
	modelId: "claude-opus-5-5",
	effort: {id: "high", label: "High"},
	usage: null,
};

describe("See detailed breakdown", () => {
	it("closes the usage popover and asks for the Usage card on a session composer", async () => {
		const onShowUsageBreakdown = vi.fn();
		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() => {}}
				chin={CHIN}
				onShowUsageBreakdown={onShowUsageBreakdown}
			/>,
		);

		fireEvent.click(screen.getByRole("button", {name: /^Usage:/}));
		fireEvent.click(await screen.findByRole("button", {name: "See detailed breakdown"}));

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(onShowUsageBreakdown.mock.calls).toStrictEqual([[]]);
	});

	it("is absent without a session to break down", async () => {
		render(<Composer variant="home" draftKey="home" onSend={() => {}} chin={CHIN} />);

		fireEvent.click(screen.getByRole("button", {name: /^Usage:/}));
		await screen.findByRole("dialog");

		expect(screen.queryByRole("button", {name: "See detailed breakdown"})).toBeNull();
	});
});

describe("SessionUsageCard", () => {
	it("shows the session cost, cache hit and per-model breakdown", () => {
		render(<SessionUsageCard records={USAGE_RECORDS} limits={null} />);
		const card = screen.getByRole("region", {name: "Usage"});
		const rows = (selector: string) =>
			Array.from(card.querySelectorAll(selector), (row) =>
				Array.from(row.children, (cell) => cell.textContent).join(" | "),
			);

		expect({
			session: rows("[data-usage-session-stat]"),
			cacheHitTitle: card
				.querySelector('[data-usage-session-stat="cache-hit"] > :first-child')
				?.getAttribute("title"),
			headers: rows("[data-usage-breakdown-header]"),
			breakdown: rows("[data-usage-breakdown-row]"),
		}).toStrictEqual({
			session: ["Cost | $0.04", "Cache hit | 81%"],
			cacheHitTitle: "Cache hit",
			headers: ["Breakdown | Opus 5.5", "Breakdown | Haiku 4.5"],
			breakdown: [
				"Input | 150",
				"Output | 500",
				"Cache read | 30.0k",
				"Cache write | 2.0k",
				"Input | 1.0k",
				"Output | 500",
				"Cache read | 0",
				"Cache write | 4.0k",
			],
		});
	});

	it("copies a plain-text report", async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal("navigator", {...navigator, clipboard: {writeText}});
		render(<SessionUsageCard records={USAGE_RECORDS} limits={null} />);

		fireEvent.click(screen.getByRole("button", {name: "Copy report"}));

		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		expect(writeText.mock.calls).toStrictEqual([
			[
				[
					"Usage",
					"",
					"This session",
					"Cost: $0.04",
					"Cache hit: 81%",
					"",
					"Breakdown Opus 5.5",
					"Input: 150",
					"Output: 500",
					"Cache read: 30.0k",
					"Cache write: 2.0k",
					"",
					"Breakdown Haiku 4.5",
					"Input: 1.0k",
					"Output: 500",
					"Cache read: 0",
					"Cache write: 4.0k",
				].join("\n"),
			],
		]);
	});
});
