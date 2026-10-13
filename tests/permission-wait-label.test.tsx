// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
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

function renderRecords(records: unknown[], permissionWaitToolUseId?: string): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={true}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode="normal"
			{...(permissionWaitToolUseId === undefined ? {} : {permissionWaitToolUseId})}
		/>,
	).container;
}

const RECORDS = [
	{type: "user", uuid: "user-1", message: {role: "user", content: "Open the PR"}},
	{
		type: "assistant",
		uuid: "assistant-1",
		message: {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "toolu_waiting",
					name: "Bash",
					input: {command: "gh pr create --draft", description: "Open draft PR for the AssertJ branch"},
				},
			],
		},
	},
];

describe("a call held at its permission prompt", () => {
	it("labels its row with the description as written, while a merely running call reads progressive", () => {
		const waiting = renderRecords(RECORDS, "toolu_waiting").textContent;
		cleanup();
		const running = renderRecords(RECORDS).textContent;

		expect({
			waiting: waiting.includes("Open draft PR for the AssertJ branch") && !waiting.includes("Opening"),
			running: running.includes("Opening draft PR for the AssertJ branch"),
		}).toStrictEqual({waiting: true, running: true});
	});
});
