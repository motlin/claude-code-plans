// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";
import specimens from "./fixtures/group-label-specimens.json";
import rowSpecimens from "./fixtures/transcript-row-specimens.json";

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

function renderRecords(records: unknown[]): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	).container;
}

/** The label of every grouped status header in the rendered transcript, without its diff stats. */
function groupLabels(records: unknown[]): (string | null)[] {
	const container = renderRecords(records);
	return Array.from(
		container.querySelectorAll("[data-turn-status] > button > span:first-child"),
		(label) => label.textContent,
	);
}

describe("group label golden specimens rendered from JSONL", () => {
	it.each(recorded)("$session:$line reads $upstream", (specimen) => {
		expect(groupLabels(specimen.records)).toStrictEqual([specimen.upstream]);
	});
});

/**
 * Specimens whose whole row sequence was read from the upstream DOM: each
 * transcript row as "prose", "user: <bubble>", "message from <sender>" or
 * "status: <label>" per status it draws.
 */
interface RowSpecimen {
	session: string;
	line: number;
	upstream: string[];
	records: unknown[];
}

function statusText(status: Element): string {
	const groupLabel = status.querySelector(":scope > button > span:first-child");
	if (groupLabel !== null) return `status: ${groupLabel.textContent}`;
	const rowLabel = status.querySelector(":scope > [role=button]");
	const parts = Array.from(rowLabel?.children ?? [], (span) => span.textContent).filter((text) => text !== "");
	return `status: ${parts.join(" ")}`;
}

function rowTexts(row: Element): string[] {
	const kind = row.getAttribute("data-perf-row");
	if (kind === "assistant_text") return ["prose"];
	const sender = row.querySelector("[data-agent-message-from] bdi");
	if (sender !== null) return [`message from ${sender.textContent}`];
	const bubble = row.querySelector(".user-message-bubble");
	if (bubble !== null) return [`user: ${bubble.textContent}`];
	return Array.from(row.querySelectorAll("[data-turn-status]"), statusText);
}

function transcriptRows(records: unknown[]): string[] {
	const container = renderRecords(records);
	return Array.from(container.querySelectorAll("[data-testid=transcript-row]")).flatMap(rowTexts);
}

describe("transcript row golden specimens rendered from JSONL", () => {
	it.each(rowSpecimens as RowSpecimen[])("$session:$line", (specimen) => {
		expect(transcriptRows(specimen.records)).toStrictEqual(specimen.upstream);
	});
});
