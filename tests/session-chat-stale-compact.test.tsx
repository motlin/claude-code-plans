// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import type {StaleCompactBandProps} from "../src/components/stale-compact-band";
import {processTranscript} from "../src/lib/transcript";

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

const user = (uuid: string, text: string, timestamp: string) => ({
	type: "user",
	uuid,
	timestamp,
	message: {role: "user", content: text},
});
const assistant = (uuid: string, text: string, timestamp: string) => ({
	type: "assistant",
	uuid,
	timestamp,
	message: {role: "assistant", content: [{type: "text", text}]},
});

const BAND: StaleCompactBandProps = {
	ageMinutes: 80,
	contextTokens: 412_000,
	tokensInLine: true,
	compacting: false,
	onCompact: () => {},
	focusComposer: () => {},
};

function renderChat(records: unknown[], staleCompact: StaleCompactBandProps | undefined, verbose = false) {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode={verbose ? "verbose" : "normal"}
			{...(staleCompact === undefined ? {} : {staleCompact})}
		/>,
	).container;
}

const bands = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-transcript-keeps-pin]"));

const TWO_TURNS = [
	user("u-1", "First fabricated prompt", "2026-11-09T08:00:00.000Z"),
	assistant("a-1", "First fabricated reply", "2026-11-09T08:00:05.000Z"),
	user("u-2", "Second fabricated prompt", "2026-11-09T08:01:00.000Z"),
	assistant("a-2", "Second fabricated reply", "2026-11-09T08:01:05.000Z"),
];

describe("SessionChat stale-compact line", () => {
	it.each([false, true])(
		"renders inside the last assistant reply, just before its actions (verbose %s)",
		(verbose) => {
			const container = renderChat(TWO_TURNS, BAND, verbose);
			const found = bands(container);
			expect(found).toHaveLength(1);
			const band = found[0]!;
			const record = band.closest("[data-record-index]")!;
			const records = Array.from(container.querySelectorAll("[data-record-index]"));
			const actions = record.querySelector("[data-message-actions]")!;
			expect({
				isLastRecord: record === records.at(-1),
				recordText: record.textContent.includes("Second fabricated reply"),
				precedesActions: band.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
				followsContent:
					record.querySelector("[data-transcript-prose]")!.compareDocumentPosition(band) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			}).toStrictEqual({
				isLastRecord: true,
				recordText: true,
				precedesActions: Node.DOCUMENT_POSITION_FOLLOWING,
				followsContent: Node.DOCUMENT_POSITION_FOLLOWING,
			});
		},
	);

	it("renders nothing when the user's message is the last entry", () => {
		const container = renderChat(
			[...TWO_TURNS, user("u-3", "Third fabricated prompt", "2026-11-09T08:02:00.000Z")],
			BAND,
		);
		expect(bands(container)).toStrictEqual([]);
	});

	it("renders nothing without an advisory", () => {
		expect(bands(renderChat(TWO_TURNS, undefined))).toStrictEqual([]);
	});
});
