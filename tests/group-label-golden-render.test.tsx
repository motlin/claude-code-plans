// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";
import specimens from "./fixtures/group-label-specimens.json";

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
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {configurable: true, value: vi.fn()});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

/**
 * Golden specimens that also carry the session's JSONL records behind the
 * group, rendered through processTranscript and SessionChat as the live UI does.
 */
interface RecordedSpecimen {
	session: string;
	line: number;
	upstream: string;
	records: unknown[];
}

const recorded = (specimens as {records?: unknown[]}[]).filter(
	(specimen): specimen is RecordedSpecimen => specimen.records !== undefined,
);

/** The text of every grouped status header in the rendered transcript. */
function groupLabels(records: unknown[]): (string | null)[] {
	const {lines, toolResultMap} = processTranscript(records);
	const {container} = render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	);
	return Array.from(container.querySelectorAll("[data-turn-status] > button"), (button) => button.textContent);
}

describe("group label golden specimens rendered from JSONL", () => {
	it.each(recorded)("$session:$line reads $upstream", (specimen) => {
		expect(groupLabels(specimen.records)).toStrictEqual([specimen.upstream]);
	});
});
