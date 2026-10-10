// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";
import type {TranscriptMode} from "../src/lib/transcript-mode";

vi.mock("../src/components/settings-provider", () => ({
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
	// A tall viewport, so the virtualized list mounts every row.
	vi.stubGlobal("innerHeight", 10_000);
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {configurable: true, value: vi.fn()});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function renderRecords(records: unknown[], mode: TranscriptMode): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			shouldScrollToEnd={false}
			transcriptMode={mode}
		/>,
	).container;
}

function entryLines(container: HTMLElement): (string | undefined)[] {
	return Array.from(container.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")).map(
		(row) => row.dataset["perfLine"],
	);
}

function interruptedSession(text: string): unknown[] {
	return [
		{type: "user", uuid: "u-1", message: {role: "user", content: "Fabricated question"}},
		{
			type: "assistant",
			uuid: "a-1",
			message: {role: "assistant", content: [{type: "text", text: "Fabricated answer"}]},
		},
		{type: "user", uuid: "u-2", message: {role: "user", content: [{type: "text", text}]}},
	];
}

describe("Request interrupted records", () => {
	it.each(["[Request interrupted by user]", "[Request interrupted by user for tool use]"])(
		"draw no entry for %s outside Verbose and keep it in Verbose",
		(text) => {
			const observe = (mode: TranscriptMode) => {
				const container = renderRecords(interruptedSession(text), mode);
				const result = {
					entries: entryLines(container),
					interrupted: (container.textContent ?? "").includes("Request interrupted"),
				};
				cleanup();
				return result;
			};

			expect({
				normal: observe("normal"),
				thinking: observe("thinking"),
				verbose: observe("verbose"),
			}).toStrictEqual({
				normal: {entries: ["0", "1"], interrupted: false},
				thinking: {entries: ["0", "1"], interrupted: false},
				verbose: {entries: ["0", "1", "2"], interrupted: true},
			});
		},
	);
});
