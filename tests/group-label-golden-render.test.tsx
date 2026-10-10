// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import type {Subagent} from "../src/lib/subagents";
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
	/** Why the local render cannot match yet. */
	skip?: string;
}

const recorded = (specimens as {records?: unknown[]}[]).filter(
	(specimen): specimen is RecordedSpecimen => specimen.records !== undefined,
);

/** The session the records came from, as the live UI renders them under it. */
function recordedSessionId(records: unknown[]): string {
	const withId = records.find(
		(record): record is {sessionId: string} => typeof (record as {sessionId?: unknown}).sessionId === "string",
	);
	return withId?.sessionId ?? "test-session";
}

function renderRecords(records: unknown[], subagents: Subagent[] = []): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId={recordedSessionId(records)}
			lines={lines}
			toolResultMap={toolResultMap}
			subagents={subagents}
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
	it.each(recorded.filter((specimen) => specimen.skip === undefined))(
		"$session:$line reads $upstream",
		(specimen) => {
			expect(groupLabels(specimen.records)).toStrictEqual([specimen.upstream]);
		},
	);

	it.skip.each(recorded.filter((specimen) => specimen.skip !== undefined))("$session:$line ($skip)", (specimen) => {
		expect(groupLabels(specimen.records)).toStrictEqual([specimen.upstream]);
	});
});

/**
 * Specimens whose whole row sequence was read from the upstream DOM: each
 * transcript row as "prose", "user: <bubble>", "message from <sender>" or
 * "status: <label>" per status it draws, after any background notice drawn outside a group,
 * and "changes" after the row that draws the turn's changes card when the
 * records reach the turn's real end (`turnEnd`), as a cut-off turn draws its card early.
 */
interface RowSpecimen {
	session: string;
	line: number;
	upstream: string[];
	records: unknown[];
	/** The records run to the turn's real end, so its changes card sits where upstream draws it. */
	turnEnd?: true;
	/** The session's subagents, as the live page loads them beside the transcript. */
	subagents?: Subagent[];
}

/** A row label part's text, with a diff stat's counts spaced as they read: "+59 -0". */
function spanText(span: Element): string {
	const counts = Array.from(span.querySelectorAll("[class*='text-extended-']"), (count) => count.textContent);
	return counts.length > 0 ? counts.join(" ") : (span.textContent ?? "");
}

function statusText(status: Element): string {
	const groupLabel = status.querySelector(":scope > button > span:first-child");
	if (groupLabel !== null) return `status: ${groupLabel.textContent}`;
	const rowLabel = status.querySelector(":scope > [role=button]");
	const parts = Array.from(rowLabel?.children ?? [], spanText).filter((text) => text !== "");
	return `status: ${parts.join(" ")}`;
}

function rowContentTexts(row: Element): string[] {
	const kind = row.getAttribute("data-perf-row");
	if (kind === "assistant_text") return ["prose"];
	const sender = row.querySelector("[data-agent-message-from] bdi");
	if (sender !== null) return [`message from ${sender.textContent}`];
	const bubble = row.querySelector(".user-message-bubble");
	if (bubble !== null) return [`user: ${bubble.textContent}`];
	const notices = Array.from(
		row.querySelectorAll(":not([data-turn-status]) > [data-background-notice]"),
		(notice) => `notice: ${notice.textContent}`,
	);
	return [...notices, ...Array.from(row.querySelectorAll("[data-turn-status]"), statusText)];
}

/** A row's texts, then "changes" where it ends its turn with the end-of-turn changes card. */
function rowTexts(row: Element, withCards: boolean): string[] {
	const cards = withCards ? Array.from(row.querySelectorAll("[data-turn-changes-card]"), () => "changes") : [];
	return [...rowContentTexts(row), ...cards];
}

function transcriptRows({records, turnEnd, subagents}: RowSpecimen): string[] {
	const container = renderRecords(records, subagents);
	return Array.from(container.querySelectorAll("[data-testid=transcript-row]")).flatMap((row) =>
		rowTexts(row, turnEnd === true),
	);
}

describe("transcript row golden specimens rendered from JSONL", () => {
	it.each(rowSpecimens as RowSpecimen[])("$session:$line", (specimen) => {
		expect(transcriptRows(specimen)).toStrictEqual(specimen.upstream);
	});
});

describe("an agent message folded into a tool group", () => {
	it("lists the message as the first step of the expanded group, before the tool it led", () => {
		const specimen = recorded.find((candidate) => candidate.session === "54e53f89" && candidate.line === 1079)!;
		const container = renderRecords(specimen.records);
		fireEvent.click(container.querySelector("[data-turn-status] > button")!);
		const steps = container.querySelectorAll("[data-turn-status] .card-outline > *");
		expect(
			Array.from(steps, (step) =>
				step.matches("[data-agent-message-from]")
					? `message from ${step.querySelector("bdi")?.textContent}`
					: `tool: ${step.querySelector("[role=button]")?.firstElementChild?.textContent}`,
			),
		).toStrictEqual(["message from subagent", "tool: Verified task commit, gate HEAD, get next task"]);
	});
});

describe("consecutive user rows", () => {
	it("leaves upstream's 20px row gap between the 79a0ad58:91 queued bubbles, keeping the last one's reply boundary", () => {
		const specimen = (rowSpecimens as RowSpecimen[]).find(
			(candidate) => candidate.session === "79a0ad58" && candidate.line === 91,
		)!;
		const container = renderRecords(specimen.records);
		const bubbleRows = Array.from(container.querySelectorAll("[data-testid=transcript-row]"))
			.filter((row) => row.querySelector(".user-message-bubble") !== null)
			.map((row) => ({
				userRowGap: row
					.querySelector(":scope > [data-record-index]")
					?.classList.contains("pb-[var(--chat-user-row-gap)]"),
				turnGap: row
					.querySelector(":scope > [data-record-index]")
					?.classList.contains("pb-[var(--chat-turn-gap)]"),
			}));
		expect(bubbleRows).toStrictEqual([
			{userRowGap: true, turnGap: false},
			{userRowGap: false, turnGap: false},
		]);
	});
});

describe("user bubble line box", () => {
	it("sets the bubble on upstream's 14px/18px heading leading, as the streaming bubble does, leaving the prompt paragraph on its 20px body leading", () => {
		const specimen = (rowSpecimens as RowSpecimen[]).find(
			(candidate) => candidate.session === "79a0ad58" && candidate.line === 91,
		)!;
		const bubble = renderRecords(specimen.records).querySelector(".user-message-bubble")!;
		expect({
			bubble: bubble.classList.contains("leading-[1.2857]"),
			paragraph: bubble.querySelector("p")?.classList.contains("text-body"),
		}).toStrictEqual({bubble: true, paragraph: true});
	});
});
