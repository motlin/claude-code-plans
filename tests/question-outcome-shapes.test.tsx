// @vitest-environment jsdom

import {cleanup, fireEvent, render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";
import shapes from "./fixtures/question-outcome-shapes.json";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({
		settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("innerHeight", 10_000);
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn<HTMLElement["scrollIntoView"]>(),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function recordsFor(name: string): unknown[] {
	const shape = shapes.find((candidate) => candidate.name === name);
	if (shape === undefined) throw new Error(`No question outcome shape named ${name}`);
	return shape.records;
}

/**
 * The collapsed row's label and note, then the expanded body's question and
 * outcome lines, rendered from the fixture's JSONL records as the live UI does.
 */
async function rowAndBody(name: string) {
	const {lines, toolResultMap} = processTranscript(recordsFor(name));
	const {container} = render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	);
	const header = container.querySelector(".group\\/tool");
	const row = header === null ? null : Array.from(header.children, (child) => child.textContent).filter(Boolean);
	const receipt = container.querySelector("[data-answered-question]") !== null;
	const toggle = container.querySelector<HTMLElement>('[aria-expanded="false"]');
	if (toggle === null) throw new Error("Expected the question row to be collapsed.");
	fireEvent.click(toggle);
	const body = await waitFor(() => {
		const mounted = container.querySelector(".group\\/body .flex.flex-col.gap-3.pt-1");
		if (mounted === null) throw new Error("Expected the step body to mount.");
		return mounted;
	});
	return {
		row,
		receipt,
		body: Array.from(body.children, (item) =>
			Array.from(item.children, (line) => ({className: line.className, text: line.textContent})),
		),
		optionBadges: container.querySelectorAll(".size-\\[30px\\]").length,
	};
}

const question = (text: string) => ({className: "text-secondary", text});
const outcome = (text: string) => ({className: "text-ink-muted", text});

describe("AskUserQuestion outcome shapes from real JSONL", () => {
	it('draws a two-question reply in chat as "Asked Parser fixes · Replied in chat", each question replied', async () => {
		expect(await rowAndBody("replied in chat, two questions")).toStrictEqual({
			row: ["Asked Parser fixes", "Replied in chat"],
			receipt: false,
			body: [
				[question("Approve the two parser fixes?"), outcome("Replied in chat")],
				[question("How to resolve the lint disagreements?"), outcome("Replied in chat")],
			],
			optionBadges: 0,
		});
	});

	it('draws a dismissed question as "Asked Next · Not answered"', async () => {
		expect(await rowAndBody("dismissed, one question")).toStrictEqual({
			row: ["Asked Next", "Not answered"],
			receipt: false,
			body: [
				[
					question(
						"The fixes are done. What's left: (1) remove the stale worktrees; (2) resolve the conflicted rebase. Which next?",
					),
					outcome("Not answered"),
				],
			],
			optionBadges: 0,
		});
	});

	it('draws the CLI terminal skip (answers: {}) as a plain "Asked G" row whose body lists only the questions', async () => {
		expect(await rowAndBody("CLI terminal skip, answers {}")).toStrictEqual({
			row: ["Asked G"],
			receipt: false,
			body: [[question("Gee?")], [question("Aitch?")]],
			optionBadges: 0,
		});
	});

	it('draws a Stop / Esc rejection as "Asked Game pic · Stopped" with Not answered under the question', async () => {
		expect(await rowAndBody("stopped by Stop / Esc")).toStrictEqual({
			row: ["Asked Game pic", "Stopped"],
			receipt: false,
			body: [[question('Game "Raw" resource-panel screenshot — where does it belong?'), outcome("Not answered")]],
			optionBadges: 0,
		});
	});

	it('draws upstream\'s single "[No preference]" skip as "Asked Color · Skipped"', async () => {
		expect(await rowAndBody("[No preference], one question")).toStrictEqual({
			row: ["Asked Color", "Skipped"],
			receipt: false,
			body: [[question("Which color do you prefer?"), outcome("Skipped")]],
			optionBadges: 0,
		});
	});

	it('draws upstream\'s two-question "[No preference]" skip as "Asked Fruit · Skipped", each question skipped', async () => {
		expect(await rowAndBody("[No preference], two questions")).toStrictEqual({
			row: ["Asked Fruit", "Skipped"],
			receipt: false,
			body: [
				[question("Which fruit do you prefer?"), outcome("Skipped")],
				[question("Which sizes do you want?"), outcome("Skipped")],
			],
			optionBadges: 0,
		});
	});
});
