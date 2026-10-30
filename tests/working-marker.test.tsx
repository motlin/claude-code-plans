// @vitest-environment jsdom

import {act, cleanup, render, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {WorkingMarker} from "../src/components/working-marker";
import {createStreamDropStore, EventStreamStatusContext} from "../src/hooks/use-claude-events";
import {type WorkingMarkerSignals} from "../src/components/use-working-marker-state";
import {useWorkingMarkerState} from "../src/components/use-working-marker-state";
import {
	formatElapsed,
	formatPaddedElapsed,
	PHASE_SETTLE_MS,
	phaseLabel,
	markerEventsFromRecords,
	tailMarkerQuiet,
	toolActivityLabel,
	formatTokenEstimate,
	turnTokenEstimate,
	workingLineAnnouncement,
	workingLineWaitsOnUser,
	workingMarkerState,
	workingMarkerText,
	type WorkingMarkerEvent,
} from "../src/lib/working-marker";

const T0 = Date.parse("2026-09-29T12:00:00.000Z");

function at(seconds: number): number {
	return T0 + seconds * 1000;
}

function stubReducedMotion(reduce: boolean) {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: reduce && query === "(prefers-reduced-motion: reduce)",
			addEventListener: () => {},
			removeEventListener: () => {},
		})),
	);
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("workingMarkerState", () => {
	it("is idle with no events", () => {
		expect(workingMarkerState([], at(5))).toStrictEqual({status: "idle"});
	});

	it("is working with an elapsed clock since the turn's prompt", () => {
		const events: WorkingMarkerEvent[] = [{kind: "prompt", at: at(0)}];
		expect(workingMarkerState(events, at(65))).toStrictEqual({
			status: "working",
			label: "Working…",
			thinking: false,
			replied: false,
			turnStartedAt: at(0),
			elapsedSeconds: 65,
		});
	});

	it("shows the current tool activity and falls back to Working… once it finishes", () => {
		const running: WorkingMarkerEvent[] = [
			{kind: "prompt", at: at(0)},
			{kind: "tool", at: at(2), label: "Reading app.ts"},
		];
		expect(workingMarkerState(running, at(3))).toStrictEqual({
			status: "working",
			label: "Reading app.ts",
			thinking: false,
			replied: true,
			turnStartedAt: at(0),
			elapsedSeconds: 3,
		});
		expect(workingMarkerState([...running, {kind: "progress", at: at(4)}], at(5))).toStrictEqual({
			status: "working",
			label: "Working…",
			thinking: false,
			replied: true,
			turnStartedAt: at(0),
			elapsedSeconds: 5,
		});
	});

	it("reports API retries until the next response arrives", () => {
		const retrying: WorkingMarkerEvent[] = [
			{kind: "prompt", at: at(0)},
			{kind: "retry", at: at(10), attempt: 2, maxRetries: 10, error: "Overloaded"},
		];
		expect(workingMarkerState(retrying, at(12))).toStrictEqual({
			status: "retrying",
			error: "Overloaded",
			attempt: 2,
			maxRetries: 10,
			turnStartedAt: at(0),
			elapsedSeconds: 12,
		});
		expect(workingMarkerState([...retrying, {kind: "progress", at: at(20)}], at(21))).toStrictEqual({
			status: "working",
			label: "Working…",
			thinking: false,
			replied: true,
			turnStartedAt: at(0),
			elapsedSeconds: 21,
		});
	});

	it("is stopping after an interrupt until the turn ends", () => {
		const stopping: WorkingMarkerEvent[] = [
			{kind: "prompt", at: at(0)},
			{kind: "tool", at: at(1), label: "Running command"},
			{kind: "interrupt", at: at(2)},
		];
		expect(workingMarkerState(stopping, at(3))).toStrictEqual({status: "stopping"});
		expect(workingMarkerState([...stopping, {kind: "stop", at: at(4)}], at(5))).toStrictEqual({
			status: "idle",
		});
	});

	it("restarts the clock on the next prompt", () => {
		const events: WorkingMarkerEvent[] = [
			{kind: "prompt", at: at(0)},
			{kind: "stop", at: at(30)},
			{kind: "prompt", at: at(40)},
		];
		expect(workingMarkerState(events, at(45))).toStrictEqual({
			status: "working",
			label: "Working…",
			thinking: false,
			replied: false,
			turnStartedAt: at(40),
			elapsedSeconds: 5,
		});
	});

	it("ignores activity outside a turn", () => {
		const events: WorkingMarkerEvent[] = [
			{kind: "tool", at: at(0), label: "Reading app.ts"},
			{kind: "retry", at: at(1), attempt: 1, maxRetries: 10, error: "Overloaded"},
			{kind: "interrupt", at: at(2)},
		];
		expect(workingMarkerState(events, at(3))).toStrictEqual({status: "idle"});
	});

	it("reports Thinking while a thinking block streams, until the next response arrives", () => {
		const thinking: WorkingMarkerEvent[] = [
			{kind: "prompt", at: at(0)},
			{kind: "thinking", at: at(1)},
		];
		expect({
			thinking: workingMarkerState(thinking, at(9)),
			after: workingMarkerState([...thinking, {kind: "progress", at: at(10)}], at(11)),
			tool: workingMarkerState([...thinking, {kind: "tool", at: at(10), label: "Reading a.ts"}], at(11)),
		}).toStrictEqual({
			thinking: {
				status: "working",
				label: "Working…",
				thinking: true,
				replied: true,
				turnStartedAt: at(0),
				elapsedSeconds: 9,
			},
			after: {
				status: "working",
				label: "Working…",
				thinking: false,
				replied: true,
				turnStartedAt: at(0),
				elapsedSeconds: 11,
			},
			tool: {
				status: "working",
				label: "Reading a.ts",
				thinking: false,
				replied: true,
				turnStartedAt: at(0),
				elapsedSeconds: 11,
			},
		});
	});

	it("never reports a negative elapsed clock", () => {
		expect(workingMarkerState([{kind: "prompt", at: at(10)}], at(5))).toStrictEqual({
			status: "working",
			label: "Working…",
			thinking: false,
			replied: false,
			turnStartedAt: at(10),
			elapsedSeconds: 0,
		});
	});
});

describe("tailMarkerQuiet", () => {
	const working = {
		status: "working",
		label: "Recheck SSH auth",
		thinking: false,
		replied: true,
		turnStartedAt: 0,
		elapsedSeconds: 24,
	} as const;

	it("quiets the line while the in-flight call's own row is busy, as upstream draws no second status line", () => {
		expect({
			inFlight: tailMarkerQuiet(working, true),
			noRow: tailMarkerQuiet(working, false),
			stopping: tailMarkerQuiet({status: "stopping"}, true),
		}).toStrictEqual({inFlight: true, noRow: false, stopping: false});
	});
});

describe("formatElapsed", () => {
	it("formats up to three units from the largest non-zero one, unpadded, as upstream's nW does", () => {
		expect([0, 1, 2, 9, 59, 60, 65, 3599, 3600, 3725, 90061].map(formatElapsed)).toStrictEqual([
			"0s",
			"1s",
			"2s",
			"9s",
			"59s",
			"1m",
			"1m 5s",
			"59m 59s",
			"1h",
			"1h 2m 5s",
			"1d 1h 1m",
		]);
	});
});

describe("formatPaddedElapsed", () => {
	it("pads trailing units to two digits and keeps zero units, as upstream's nW with padTrailingUnits does", () => {
		expect([0, 13, 60, 65, 3600, 3725, 90061].map(formatPaddedElapsed)).toStrictEqual([
			"0s",
			"13s",
			"1m 00s",
			"1m 05s",
			"1h 00m 00s",
			"1h 02m 05s",
			"1d 01h 01m",
		]);
	});
});

describe("workingMarkerText", () => {
	it("renders each visible state's status line, with no Working… label as upstream's live line has none", () => {
		expect([
			workingMarkerText({status: "idle"}),
			workingMarkerText({
				status: "working",
				label: "Working…",
				thinking: false,
				replied: true,
				turnStartedAt: at(0),
				elapsedSeconds: 65,
			}),
			workingMarkerText({status: "stopping"}),
			workingMarkerText({
				status: "retrying",
				error: "Overloaded",
				attempt: 2,
				maxRetries: 10,
				turnStartedAt: at(0),
				elapsedSeconds: 12,
			}),
		]).toStrictEqual(["", "1m 5s", "Stopping", "Overloaded · Retrying (2/10) · 12s"]);
	});

	it("hides the elapsed clock below 2s, as upstream shows it only from 2s", () => {
		const working = (elapsedSeconds: number) =>
			workingMarkerText({
				status: "working",
				label: "Working…",
				thinking: false,
				replied: true,
				turnStartedAt: at(0),
				elapsedSeconds,
			});
		expect([
			working(0),
			working(1),
			working(2),
			workingMarkerText({
				status: "retrying",
				error: "Overloaded",
				attempt: 1,
				maxRetries: 10,
				turnStartedAt: at(0),
				elapsedSeconds: 1,
			}),
		]).toStrictEqual(["", "", "2s", "Overloaded · Retrying (1/10)"]);
	});
});

describe("workingMarkerText thinking", () => {
	it('appends Thinking after the stats while thinking, as upstream\'s "9s · Thinking"', () => {
		const thinking = (elapsedSeconds: number) =>
			workingMarkerText({
				status: "working",
				label: "Working…",
				thinking: true,
				replied: true,
				turnStartedAt: at(0),
				elapsedSeconds,
			});
		expect([thinking(1), thinking(9)]).toStrictEqual(["Thinking", "9s · Thinking"]);
	});
});

describe("turnTokenEstimate", () => {
	const prompt = (content: string) => ({type: "user", message: {role: "user", content}});
	const assistantText = (text: string) => ({
		type: "assistant",
		message: {role: "assistant", content: [{type: "text", text}]},
	});

	it("estimates the turn's streamed characters / 4, as upstream's token counter", () => {
		expect(
			[400, 4, 201_000].map((length) =>
				formatTokenEstimate(turnTokenEstimate([prompt("go"), assistantText("x".repeat(length))])),
			),
		).toStrictEqual(["100 tokens", "1 token", "50.3k tokens"]);
	});

	it("counts thinking, tool_use input JSON and tool_result content since the turn's prompt only", () => {
		const input = {file_path: "/w/a.ts"};
		const records = [
			prompt("earlier"),
			assistantText("y".repeat(4000)),
			prompt("now"),
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{type: "thinking", thinking: "t".repeat(8)},
						{type: "tool_use", id: "t1", name: "Read", input},
					],
				},
			},
			{
				type: "user",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "t1", content: "r".repeat(12)}],
				},
			},
			{
				type: "user",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "t2", content: [{type: "text", text: "s".repeat(4)}]}],
				},
			},
			{
				type: "assistant",
				isSidechain: true,
				message: {role: "assistant", content: [{type: "text", text: "z".repeat(400)}]},
			},
		];
		expect(turnTokenEstimate(records)).toStrictEqual(Math.floor((8 + JSON.stringify(input).length + 12 + 4) / 4));
	});

	it("is zero before anything streams", () => {
		expect([turnTokenEstimate([]), turnTokenEstimate([prompt("go")])]).toStrictEqual([0, 0]);
	});
});

describe("workingMarkerText tokens", () => {
	const working = (elapsedSeconds: number, thinking = false) =>
		({
			status: "working",
			label: "Working…",
			thinking,
			replied: true,
			turnStartedAt: at(0),
			elapsedSeconds,
		}) as const;

	it('shows the token estimate between the clock and Thinking from 2s once non-zero, as upstream\'s "9s · 49.7k tokens · Thinking"', () => {
		expect([
			workingMarkerText(working(1), 49_700),
			workingMarkerText(working(9), 0),
			workingMarkerText(working(9, true), 49_700),
			workingMarkerText({status: "stopping"}, 49_700),
		]).toStrictEqual(["", "9s", "9s · 49.7k tokens · Thinking", "Stopping"]);
	});
});

describe("workingLineAnnouncement", () => {
	it("announces Working… rather than the ticking clock", () => {
		expect([
			workingLineAnnouncement({status: "idle"}),
			workingLineAnnouncement({status: "waiting"}),
			workingLineAnnouncement({
				status: "working",
				label: "Reading a.ts",
				thinking: false,
				replied: true,
				turnStartedAt: at(0),
				elapsedSeconds: 9,
			}),
			workingLineAnnouncement({status: "stopping"}),
			workingLineAnnouncement({
				status: "retrying",
				error: "Overloaded",
				attempt: 2,
				maxRetries: 10,
				turnStartedAt: at(0),
				elapsedSeconds: 12,
			}),
		]).toStrictEqual(["", "", "Working…", "Stopping", "Overloaded · Retrying (2/10)"]);
	});
});

describe("toolActivityLabel", () => {
	it("names the tool's activity, with its target when the input is known", () => {
		expect([
			toolActivityLabel("Read", {file_path: "/work/src/app.ts"}),
			toolActivityLabel("Read", undefined),
			toolActivityLabel("Edit", {file_path: "/work/src/app.ts"}),
			toolActivityLabel("Write", {file_path: "/work/notes.md"}),
			toolActivityLabel("Grep", {pattern: "useThing"}),
			toolActivityLabel("Glob", {pattern: "**/*.ts"}),
			toolActivityLabel("Bash", {command: "pnpm test", description: "Run the tests"}),
			toolActivityLabel("Bash", {command: "pnpm test"}),
			toolActivityLabel("WebFetch", {url: "https://example.com/page"}),
			toolActivityLabel("WebSearch", {query: "zod"}),
			toolActivityLabel("Agent", {description: "Explore the repo"}),
			toolActivityLabel("mcp__github__list_issues", {}),
		]).toStrictEqual([
			"Reading app.ts",
			"Reading file",
			"Editing app.ts",
			"Writing notes.md",
			"Searching for useThing",
			"Finding files",
			"Run the tests",
			"Running command",
			"Fetching example.com",
			"Searching the web",
			"Explore the repo",
			"Using mcp__github__list_issues",
		]);
	});
});

describe("markerEventsFromRecords", () => {
	it("maps transcript records to marker events", () => {
		const records = [
			{
				type: "user",
				timestamp: "2026-09-29T12:00:00.000Z",
				message: {role: "user", content: "fix the bug"},
			},
			{
				type: "user",
				isMeta: true,
				timestamp: "2026-09-29T12:00:00.500Z",
				message: {role: "user", content: "<local-command-caveat>…</local-command-caveat>"},
			},
			{
				type: "assistant",
				timestamp: "2026-09-29T12:00:01.000Z",
				message: {
					role: "assistant",
					content: [
						{type: "text", text: "Looking."},
						{type: "tool_use", id: "t1", name: "Read", input: {file_path: "/w/app.ts"}},
					],
				},
			},
			{
				type: "user",
				timestamp: "2026-09-29T12:00:02.000Z",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "t1", content: "…"}],
				},
			},
			{
				type: "system",
				subtype: "api_error",
				timestamp: "2026-09-29T12:00:03.000Z",
				error: {message: "Overloaded"},
				retryAttempt: 1,
				maxRetries: 10,
			},
			{
				type: "system",
				subtype: "api_error",
				timestamp: "2026-09-29T12:00:03.500Z",
				error: "boom",
			},
			{
				type: "assistant",
				timestamp: "2026-09-29T12:00:04.000Z",
				message: {role: "assistant", content: [{type: "text", text: "Done."}]},
			},
			{
				type: "system",
				subtype: "turn_duration",
				timestamp: "2026-09-29T12:00:05.000Z",
				durationMs: 5000,
			},
			{
				type: "user",
				timestamp: "2026-09-29T12:01:00.000Z",
				message: {role: "user", content: [{type: "text", text: "and again"}]},
			},
			{
				type: "user",
				timestamp: "2026-09-29T12:01:01.000Z",
				message: {
					role: "user",
					content: [{type: "text", text: "[Request interrupted by user for tool use]"}],
				},
			},
			{
				type: "assistant",
				isSidechain: true,
				timestamp: "2026-09-29T12:01:02.000Z",
				message: {
					role: "assistant",
					content: [{type: "tool_use", id: "t2", name: "Bash", input: {command: "ls"}}],
				},
			},
		];
		expect(markerEventsFromRecords(records)).toStrictEqual([
			{kind: "prompt", at: at(0)},
			{kind: "tool", at: at(1), label: "Reading app.ts"},
			{kind: "progress", at: at(2)},
			{kind: "retry", at: at(3), attempt: 1, maxRetries: 10, error: "Model overloaded"},
			{kind: "progress", at: at(4)},
			{kind: "stop", at: at(5)},
			{kind: "prompt", at: at(60)},
			{kind: "stop", at: at(61)},
		]);
	});
});

describe("markerEventsFromRecords thinking", () => {
	it("maps an assistant record ending in a thinking block to a thinking event, and later text to progress", () => {
		const records = [
			{type: "user", timestamp: "2026-09-29T12:00:00.000Z", message: {role: "user", content: "think"}},
			{
				type: "assistant",
				timestamp: "2026-09-29T12:00:01.000Z",
				message: {role: "assistant", content: [{type: "thinking", thinking: "Hmm.", signature: "s"}]},
			},
			{
				type: "assistant",
				timestamp: "2026-09-29T12:00:02.000Z",
				message: {
					role: "assistant",
					content: [
						{type: "thinking", thinking: "Hmm.", signature: "s"},
						{type: "text", text: "Done."},
					],
				},
			},
		];
		expect(markerEventsFromRecords(records)).toStrictEqual([
			{kind: "prompt", at: at(0)},
			{kind: "thinking", at: at(1)},
			{kind: "progress", at: at(2)},
		]);
	});
});

/** The working line's visible text: upstream's TurnStatus row without its sr-only spans. */
function visibleLineText(root: ParentNode): string | null {
	const row = root.querySelector('[data-cds="TurnStatus"]');
	if (row === null) return null;
	const copy = row.cloneNode(true) as Element;
	for (const hidden of copy.querySelectorAll(".sr-only, [inert]")) hidden.remove();
	return copy.textContent;
}

describe("WorkingMarker", () => {
	it("keeps an empty 24px code-working-line mounted when idle, so the transcript bottom never jumps", () => {
		stubReducedMotion(false);
		const {getByRole, container} = render(<WorkingMarker state={{status: "idle"}} />);
		const line = container.querySelector('[data-testid="code-working-line"]');
		expect({
			status: getByRole("status").textContent,
			row: container.querySelector('[data-perf-row="marker"]') !== null,
			turnWorking: line?.getAttribute("data-turn-working"),
			className: line?.className,
			turnStatus: container.querySelector('[data-cds="TurnStatus"]'),
			mark: container.querySelector('[data-cds="WorkingMark"]'),
			oldAnnouncer: container.querySelector('[data-testid="response-status-announcer"]'),
		}).toStrictEqual({
			status: "",
			row: true,
			turnWorking: "false",
			className: "flex min-h-6 flex-col comfortable:min-h-8",
			turnStatus: null,
			mark: null,
			oldAnnouncer: null,
		});
	});

	it("renders a busy TurnStatus row of mark and muted elapsed, announcing Working… only to assistive tech", () => {
		stubReducedMotion(false);
		const {getByRole, container} = render(
			<WorkingMarker
				state={{
					status: "working",
					label: "Reading app.ts",
					thinking: false,
					replied: true,
					turnStartedAt: at(0),
					elapsedSeconds: 7,
				}}
			/>,
		);
		const line = container.querySelector('[data-testid="code-working-line"]');
		const status = container.querySelector('[data-cds="TurnStatus"]');
		const mark = container.querySelector("[data-cds-row-mark]");
		expect({
			turnWorking: line?.getAttribute("data-turn-working"),
			hidden: line?.getAttribute("aria-hidden"),
			state: status?.getAttribute("data-state"),
			statusClass: status?.className,
			rowClass: status?.firstElementChild?.className,
			markClass: mark?.className,
			markHidden: mark?.getAttribute("aria-hidden"),
			animated: mark?.querySelector('[data-cds="WorkingMark"]')?.getAttribute("data-animated"),
			activity: mark?.querySelector('[data-cds="WorkingMark"]')?.getAttribute("data-activity"),
			visible: visibleLineText(container),
			stat: [...(status?.querySelectorAll(".tabular-nums") ?? [])].map((el) => [el.className, el.textContent]),
			busy: status?.querySelector(".sr-only")?.textContent,
			announcer: getByRole("status").textContent,
			announcerLive: getByRole("status").getAttribute("aria-live"),
		}).toStrictEqual({
			turnWorking: "true",
			hidden: null,
			state: "busy",
			statusClass: "group/status flex w-full min-w-0 flex-col",
			rowClass: "flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-body comfortable:px-1.5 comfortable:py-1.5",
			markClass: "relative me-[6px] flex h-[1lh] w-[20px] shrink-0 items-center justify-center",
			markHidden: "true",
			animated: "true",
			activity: "default",
			visible: "7s",
			stat: [["inline-flex h-[1lh] shrink-0 items-center text-ink-muted tabular-nums", "7s"]],
			busy: "running",
			announcer: "Working…",
			announcerLive: "polite",
		});
	});

	it("quiets the line while a tool row is in flight: invisible and aria-hidden but still 24px tall", () => {
		stubReducedMotion(false);
		const {container} = render(
			<WorkingMarker
				state={{
					status: "working",
					label: "Working…",
					thinking: false,
					replied: true,
					turnStartedAt: at(0),
					elapsedSeconds: 3,
				}}
				quiet
			/>,
		);
		const line = container.querySelector('[data-testid="code-working-line"]');
		expect({
			className: line?.className,
			hidden: line?.getAttribute("aria-hidden"),
			quiet: line?.getAttribute("data-quiet"),
			turnWorking: line?.getAttribute("data-turn-working"),
			mark: container.querySelector("[data-cds-row-mark]"),
		}).toStrictEqual({
			className: "invisible flex min-h-6 flex-col comfortable:min-h-8",
			hidden: "true",
			quiet: "true",
			turnWorking: "true",
			mark: null,
		});
	});

	it("shows the running background task count after a dot inside the working line", () => {
		stubReducedMotion(false);
		const {container} = render(
			<WorkingMarker
				state={{
					status: "working",
					label: "Working…",
					thinking: false,
					replied: true,
					turnStartedAt: at(0),
					elapsedSeconds: 3,
				}}
				runningTasks={4}
			/>,
		);
		expect({
			text: visibleLineText(container),
			button: container.querySelector('[data-cds="TurnStatus"] button')?.textContent,
		}).toStrictEqual({text: "3s·4 running tasks", button: "4 running tasks"});
	});

	it("draws no running task count while the turn is idle, as upstream's idle tail is empty", () => {
		stubReducedMotion(false);
		const {container} = render(<WorkingMarker state={{status: "idle"}} runningTasks={16} />);
		expect({
			text: container.querySelector('[data-testid="code-working-line"]')?.textContent,
			button: container.querySelector("button"),
		}).toStrictEqual({text: "", button: null});
	});

	it("keeps the mark playing and morphs in a shimmering Stopping with no clock, as upstream does", () => {
		stubReducedMotion(false);
		const {getByRole, container} = render(<WorkingMarker state={{status: "stopping"}} />);
		const shimmer = container.querySelector('[data-cds="TurnStatus"] [data-cds="ShimmerText"]');
		expect({
			text: visibleLineText(container),
			announcer: getByRole("status").textContent,
			animated: container.querySelector('[data-cds="WorkingMark"]')?.getAttribute("data-animated"),
			shimmer: shimmer?.firstChild?.textContent,
			morph: shimmer?.parentElement?.className,
		}).toStrictEqual({
			text: "Stopping",
			announcer: "Stopping",
			animated: "true",
			shimmer: "Stopping",
			morph: "truncate whitespace-nowrap motion-safe:animate-[cds-morph-in_0.18s_cubic-bezier(.2,0,0,1)]",
		});
	});

	it("shows a plain Thinking stat after the clock while thinking", () => {
		stubReducedMotion(false);
		const {container} = render(
			<WorkingMarker
				state={{
					status: "working",
					label: "Working…",
					thinking: true,
					replied: true,
					turnStartedAt: at(0),
					elapsedSeconds: 9,
				}}
			/>,
		);
		const status = container.querySelector('[data-cds="TurnStatus"]');
		expect({
			text: visibleLineText(container),
			stats: [...(status?.querySelectorAll(".tabular-nums") ?? [])].map((el) => el.textContent),
			activity: container.querySelector('[data-cds="WorkingMark"]')?.getAttribute("data-activity"),
		}).toStrictEqual({text: "9s·Thinking", stats: ["9s", "·", "Thinking"], activity: "think"});
	});

	it("shows the token estimate as a muted stat after the clock", () => {
		stubReducedMotion(false);
		const {container} = render(
			<WorkingMarker
				state={{
					status: "working",
					label: "Working…",
					thinking: false,
					replied: true,
					turnStartedAt: at(0),
					elapsedSeconds: 7,
				}}
				tokens={49_700}
			/>,
		);
		expect(visibleLineText(container)).toStrictEqual("7s·49.7k tokens");
	});

	it("holds the working mark still under reduced motion", () => {
		stubReducedMotion(true);
		const {container} = render(
			<WorkingMarker
				state={{
					status: "working",
					label: "Working…",
					thinking: false,
					replied: true,
					turnStartedAt: at(0),
					elapsedSeconds: 1,
				}}
			/>,
		);
		expect(container.querySelector('[data-cds="WorkingMark"]')?.getAttribute("data-animated")).toStrictEqual(
			"false",
		);
	});
});

describe("useWorkingMarkerState", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(at(3));
	});

	const OPEN_TURN = [
		{
			type: "user",
			timestamp: new Date(at(0)).toISOString(),
			message: {role: "user", content: "go"},
		},
	];

	function Harness(props: WorkingMarkerSignals) {
		return <WorkingMarker state={useWorkingMarkerState(props)} />;
	}

	function statusText(props: WorkingMarkerSignals): string | null {
		const view = render(<Harness {...props} />);
		const text = visibleLineText(view.container) ?? "";
		view.unmount();
		return text;
	}

	it("follows the hook state, falling back to the session being live", () => {
		stubReducedMotion(false);
		expect([
			statusText({
				records: OPEN_TURN,
				sessionState: "working",
				isActive: false,
				pendingToolName: undefined,
			}),
			statusText({
				records: OPEN_TURN,
				sessionState: "working",
				isActive: false,
				pendingToolName: "Bash",
			}),
			statusText({
				records: OPEN_TURN,
				sessionState: "idle",
				isActive: true,
				pendingToolName: undefined,
			}),
			statusText({
				records: OPEN_TURN,
				sessionState: "waiting",
				isActive: true,
				pendingToolName: undefined,
			}),
			statusText({
				records: OPEN_TURN,
				sessionState: "ended",
				isActive: false,
				pendingToolName: undefined,
			}),
			statusText({
				records: OPEN_TURN,
				sessionState: null,
				isActive: true,
				pendingToolName: undefined,
			}),
			statusText({
				records: OPEN_TURN,
				sessionState: "unknown",
				isActive: false,
				pendingToolName: undefined,
			}),
		]).toStrictEqual(["Waiting for Claude…", "3s", "", "", "", "Waiting for Claude…", ""]);
	});

	it("shows no mark while an inline card holds the mark for a waiting prompt, as upstream does", () => {
		stubReducedMotion(false);
		const {container, getByRole} = render(<WorkingMarker state={{status: "waiting"}} waitingOnUser={false} />);
		expect({
			text: getByRole("status").textContent,
			turnStatus: container.querySelector('[data-cds="TurnStatus"]'),
			mark: container.querySelector('[data-cds="WorkingMark"]'),
		}).toStrictEqual({text: "", turnStatus: null, mark: null});
	});

	it("shows a blocked Needs your input status when no card holds the mark, as upstream does", () => {
		stubReducedMotion(false);
		const {container, getByRole} = render(
			<WorkingMarker state={{status: "idle"}} waitingOnUser quiet runningTasks={0} />,
		);
		const line = container.querySelector('[data-testid="code-working-line"]');
		const row = container.querySelector('[data-cds="TurnStatus"]');
		const badge = row?.querySelector('[data-cds="Badge"]');
		expect({
			turnWorking: line?.getAttribute("data-turn-working"),
			lineClass: line?.className,
			state: row?.getAttribute("data-state"),
			title: row?.getAttribute("title"),
			mark: row?.querySelector('[data-cds="WorkingMark"]')?.getAttribute("data-activity"),
			badgeClass: badge?.className,
			badgeHtml: badge?.innerHTML,
			visible: visibleLineText(container),
			announcer: getByRole("status").textContent,
			announcerLive: getByRole("status").getAttribute("aria-live"),
		}).toStrictEqual({
			turnWorking: "false",
			lineClass: "flex min-h-6 flex-col comfortable:min-h-8",
			state: "blocked",
			title: "Needs your input",
			mark: "blocked",
			badgeClass:
				"inline-flex h-5 min-w-0 max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 align-middle font-sans text-caption font-medium bg-[var(--warning-tint)] text-upstream-warning",
			badgeHtml:
				'<span class="min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap pb-[0.05em]"><bdi>Needs your input</bdi></span>',
			visible: "Needs your input",
			announcer: "Needs your input",
			announcerLive: "polite",
		});
	});
	it("keeps one state object while its value holds, so the working line it memoizes renders once per change", () => {
		const signals = (records: readonly unknown[], sessionState: WorkingMarkerSignals["sessionState"]) => ({
			records,
			sessionState,
			isActive: false,
			pendingToolName: undefined,
		});
		const {result, rerender} = renderHook((props: WorkingMarkerSignals) => useWorkingMarkerState(props), {
			initialProps: signals(OPEN_TURN, "idle"),
		});
		const idle = result.current;
		rerender(signals([...OPEN_TURN], "idle"));
		const idleAgain = result.current;
		rerender(signals(OPEN_TURN, "working"));
		const working = result.current;
		rerender(signals([...OPEN_TURN], "working"));
		expect({
			idle,
			idleKept: idleAgain === idle,
			working,
			workingKept: result.current === working,
		}).toStrictEqual({
			idle: {status: "idle"},
			idleKept: true,
			working: {
				status: "working",
				label: "Working…",
				thinking: false,
				replied: false,
				turnStartedAt: at(0),
				elapsedSeconds: 3,
			},
			workingKept: true,
		});
	});
});

describe("workingLineWaitsOnUser", () => {
	it("says the turn needs input only while a prompt waits with no card holding the mark", () => {
		const cases: Parameters<typeof workingLineWaitsOnUser>[0][] = [
			{awaitingPermission: true, sessionState: "working", cardShown: false},
			{awaitingPermission: true, sessionState: "working", cardShown: true},
			{awaitingPermission: false, sessionState: "waiting", cardShown: false},
			{awaitingPermission: false, sessionState: "waiting", cardShown: true},
			{awaitingPermission: false, sessionState: "working", cardShown: false},
			{awaitingPermission: false, sessionState: "idle", cardShown: false},
			{awaitingPermission: false, sessionState: null, cardShown: false},
		];
		expect(cases.map((signals) => workingLineWaitsOnUser(signals))).toStrictEqual([
			true,
			false,
			true,
			false,
			false,
			false,
			false,
		]);
	});
});

describe("phaseLabel", () => {
	it("says Sending… until the prompt lands, then Waiting for Claude… until the first reply, as upstream's pre-stream phases", () => {
		expect(
			[
				{sending: false, promptSeen: false, firstAssistantSeen: false},
				{sending: true, promptSeen: false, firstAssistantSeen: false},
				{sending: true, promptSeen: true, firstAssistantSeen: false},
				{sending: false, promptSeen: true, firstAssistantSeen: false},
				{sending: false, promptSeen: true, firstAssistantSeen: true},
				{sending: true, promptSeen: true, firstAssistantSeen: true},
			].map((input) => phaseLabel(input)),
		).toStrictEqual([null, "Sending…", "Waiting for Claude…", "Waiting for Claude…", null, null]);
	});

	it("settles label swaps for upstream's 150ms", () => {
		expect(PHASE_SETTLE_MS).toBe(150);
	});
});

describe("WorkingMarker pre-stream phases", () => {
	const UNREPLIED = {
		status: "working",
		label: "Working…",
		thinking: false,
		replied: false,
		turnStartedAt: at(0),
		elapsedSeconds: 5,
	} as const;

	function phaseView(container: HTMLElement) {
		const line = container.querySelector('[data-testid="code-working-line"]');
		return {
			turnWorking: line?.getAttribute("data-turn-working"),
			state: container.querySelector('[data-cds="TurnStatus"]')?.getAttribute("data-state"),
			activity: container.querySelector('[data-cds="WorkingMark"]')?.getAttribute("data-activity"),
			visible: visibleLineText(container),
			announcer: container.querySelector("[role=status]")?.textContent,
		};
	}

	it("draws a busy Sending… line while a live-pane prompt is in flight with no open turn", () => {
		stubReducedMotion(false);
		const {container} = render(<WorkingMarker state={{status: "idle"}} sending />);
		expect(phaseView(container)).toStrictEqual({
			turnWorking: "true",
			state: "busy",
			activity: "default",
			visible: "Sending…",
			announcer: "Working…",
		});
	});

	it("says Waiting for Claude… in place of the stats until the turn's first reply", () => {
		stubReducedMotion(false);
		const {container} = render(<WorkingMarker state={UNREPLIED} />);
		expect(phaseView(container)).toStrictEqual({
			turnWorking: "true",
			state: "busy",
			activity: "default",
			visible: "Waiting for Claude…",
			announcer: "Working…",
		});
	});

	it("holds the earlier phase word for 150ms before swapping to the next, so fast transitions don't flash", () => {
		vi.useFakeTimers();
		stubReducedMotion(false);
		const view = render(<WorkingMarker state={{status: "idle"}} sending />);
		view.rerender(<WorkingMarker state={UNREPLIED} />);
		const held = visibleLineText(view.container);
		act(() => {
			vi.advanceTimersByTime(149);
		});
		const before = visibleLineText(view.container);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect({held, before, after: visibleLineText(view.container)}).toStrictEqual({
			held: "Sending…",
			before: "Sending…",
			after: "Waiting for Claude…",
		});
	});

	it.each(["reconnecting", "connecting"] as const)(
		"says Connecting… in place of a phase word while the event stream is %s, as upstream's isConnecting",
		(drop) => {
			stubReducedMotion(false);
			const store = createStreamDropStore(drop);
			const sending = render(
				<EventStreamStatusContext.Provider value={store}>
					<WorkingMarker state={{status: "idle"}} sending />
				</EventStreamStatusContext.Provider>,
			);
			const sendingView = phaseView(sending.container);
			cleanup();
			const waiting = render(
				<EventStreamStatusContext.Provider value={store}>
					<WorkingMarker state={UNREPLIED} />
				</EventStreamStatusContext.Provider>,
			);
			expect({sending: sendingView, waiting: phaseView(waiting.container)}).toStrictEqual({
				sending: {
					turnWorking: "true",
					state: "busy",
					activity: "default",
					visible: "Connecting…",
					announcer: "Working…",
				},
				waiting: {
					turnWorking: "true",
					state: "busy",
					activity: "default",
					visible: "Connecting…",
					announcer: "Working…",
				},
			});
		},
	);

	it("leaves the line alone during a stream drop once the turn is past its waiting phase", () => {
		stubReducedMotion(false);
		const store = createStreamDropStore("reconnecting");
		const {container} = render(
			<EventStreamStatusContext.Provider value={store}>
				<WorkingMarker state={{...UNREPLIED, replied: true}} />
			</EventStreamStatusContext.Provider>,
		);
		expect(visibleLineText(container)).toBe("5s");
	});

	it("drops the phase word as soon as the first reply lands", () => {
		stubReducedMotion(false);
		const view = render(<WorkingMarker state={UNREPLIED} />);
		view.rerender(<WorkingMarker state={{...UNREPLIED, replied: true}} />);
		expect(visibleLineText(view.container)).toBe("5s");
	});
});

describe("retry wording", () => {
	function retryText(record: Record<string, unknown>): string {
		const events = markerEventsFromRecords([
			{type: "user", timestamp: "2026-09-29T12:00:00.000Z", message: {role: "user", content: "go"}},
			{type: "system", subtype: "api_error", timestamp: "2026-09-29T12:00:03.000Z", ...record},
		]);
		return workingMarkerText(workingMarkerState(events, at(3)));
	}

	it("maps api_error shapes to upstream's short retry phrases", () => {
		const retry = {retryAttempt: 2, retryInMs: 4000, maxRetries: 10};
		expect({
			connection: retryText({
				...retry,
				error: {message: "Connection error.", formatted: "Unable to connect to API (ConnectionRefused)"},
			}),
			overloadedString: retryText({...retry, error: "Overloaded"}),
			overloadedStatus: retryText({...retry, error: {status: 529, message: "boom"}}),
			rateLimitStatus: retryText({...retry, error: {status: 429, message: "boom"}}),
			rateLimitText: retryText({...retry, error: {message: "Rate limit exceeded"}}),
			auth401: retryText({...retry, error: {status: 401}}),
			auth403: retryText({...retry, error: {status: 403}}),
			authText: retryText({...retry, error: "authentication_error: invalid x-api-key"}),
			credentials: retryText({...retry, error: {message: "cloud_credential_error"}}),
			other: retryText({...retry, error: "boom"}),
			missing: retryText(retry),
		}).toStrictEqual({
			connection: "No response from the API · Retrying (2/10) · 3s",
			overloadedString: "Model overloaded · Retrying (2/10) · 3s",
			overloadedStatus: "Model overloaded · Retrying (2/10) · 3s",
			rateLimitStatus: "Rate limited · Retrying (2/10) · 3s",
			rateLimitText: "Rate limited · Retrying (2/10) · 3s",
			auth401: "Authentication failed · Retrying (2/10) · 3s",
			auth403: "Authentication failed · Retrying (2/10) · 3s",
			authText: "Authentication failed · Retrying (2/10) · 3s",
			credentials: "Cloud credentials unavailable · Retrying (2/10) · 3s",
			other: "Request failed · Retrying (2/10) · 3s",
			missing: "Request failed · Retrying (2/10) · 3s",
		});
	});

	it("says Trying once more for a last no-response retry", () => {
		const error = {message: "Connection error.", formatted: "Unable to connect to API (ConnectionRefused)"};
		expect({
			onceMore: retryText({error, retryAttempt: 1, retryInMs: 120_000, maxRetries: 1}),
			onceMoreRoundsUp: retryText({error, retryAttempt: 1, retryInMs: 90_000, maxRetries: 1}),
			onceMoreOverloaded: retryText({error: "Overloaded", retryAttempt: 1, retryInMs: 120_000, maxRetries: 1}),
		}).toStrictEqual({
			onceMore: "Trying once more, for up to 2 min · 3s",
			onceMoreRoundsUp: "Trying once more, for up to 2 min · 3s",
			onceMoreOverloaded: "Model overloaded · Retrying (1/1) · 3s",
		});
	});
});
