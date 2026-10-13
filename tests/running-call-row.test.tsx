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

function renderRecords(records: unknown[]): HTMLElement {
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
		/>,
	).container;
}

describe("an in-flight call's row", () => {
	it("leads with upstream's 20px running spinner and follows the label with the live elapsed time", () => {
		const records = [
			{type: "user", uuid: "user-1", message: {role: "user", content: "Check the login"}},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - 22_000).toISOString(),
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_running",
							name: "Bash",
							input: {command: "ssh -T git@github.com", description: "Recheck SSH auth"},
						},
					],
				},
			},
		];
		const container = renderRecords(records);
		const rows = [...container.querySelectorAll(".group\\/tool")].filter((row) =>
			row.textContent.includes("Rechecking SSH auth"),
		);
		const row = rows[0];

		expect({
			rows: rows.length,
			spinner: row?.querySelector("[data-running-spinner]")?.getAttribute("class"),
			elapsed: /^\d+s$/.test(row?.querySelector("[data-running-elapsed]")?.textContent ?? ""),
			chevron: row?.querySelector("svg[width='12']") !== null,
		}).toStrictEqual({
			rows: 1,
			spinner: "running-spinner me-1.5 inline-flex size-5 shrink-0",
			elapsed: true,
			chevron: true,
		});
	});
});
