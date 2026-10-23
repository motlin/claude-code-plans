// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {WorkingMarker} from "../src/components/working-marker";
import {type WorkingMarkerSignals} from "../src/components/use-working-marker-state";
import {useWorkingMarkerState} from "../src/components/use-working-marker-state";
import {
	formatElapsed,
	markerEventsFromRecords,
	tailMarkerQuiet,
	toolActivityLabel,
	workingLineAnnouncement,
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
			turnStartedAt: at(0),
			elapsedSeconds: 3,
		});
		expect(workingMarkerState([...running, {kind: "progress", at: at(4)}], at(5))).toStrictEqual({
			status: "working",
			label: "Working…",
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

	it("never reports a negative elapsed clock", () => {
		expect(workingMarkerState([{kind: "prompt", at: at(10)}], at(5))).toStrictEqual({
			status: "working",
			label: "Working…",
			turnStartedAt: at(10),
			elapsedSeconds: 0,
		});
	});
});

describe("tailMarkerQuiet", () => {
	const working = {status: "working", label: "Recheck SSH auth", turnStartedAt: 0, elapsedSeconds: 24} as const;

	it("quiets the line while the in-flight call's own row is busy, as upstream draws no second status line", () => {
		expect({
			inFlight: tailMarkerQuiet(working, true),
			noRow: tailMarkerQuiet(working, false),
			stopping: tailMarkerQuiet({status: "stopping"}, true),
		}).toStrictEqual({inFlight: true, noRow: false, stopping: false});
	});
});

describe("formatElapsed", () => {
	it("formats seconds, minutes, and hours", () => {
		expect([0, 9, 59, 60, 65, 3599, 3600, 3725].map(formatElapsed)).toStrictEqual([
			"0s",
			"9s",
			"59s",
			"1m 00s",
			"1m 05s",
			"59m 59s",
			"1h 00m",
			"1h 02m",
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
		]).toStrictEqual(["", "1m 05s", "Stopping…", "Overloaded · Retrying (2/10) · 12s"]);
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
		]).toStrictEqual(["", "", "Working…", "Stopping…", "Overloaded · Retrying (2/10)"]);
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
			{kind: "retry", at: at(3), attempt: 1, maxRetries: 10, error: "Overloaded"},
			{kind: "progress", at: at(4)},
			{kind: "stop", at: at(5)},
			{kind: "prompt", at: at(60)},
			{kind: "stop", at: at(61)},
		]);
	});
});

/** The working line's visible text: upstream's TurnStatus row without its sr-only spans. */
function visibleLineText(root: ParentNode): string | null {
	const row = root.querySelector('[data-cds="TurnStatus"]');
	if (row === null) return null;
	const copy = row.cloneNode(true) as Element;
	for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
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
			spark: container.querySelector('[data-cds="Spark"]'),
			oldAnnouncer: container.querySelector('[data-testid="response-status-announcer"]'),
		}).toStrictEqual({
			status: "",
			row: true,
			turnWorking: "false",
			className: "flex min-h-6 flex-col",
			turnStatus: null,
			spark: null,
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
			animated: mark?.querySelector('[data-cds="Spark"]')?.getAttribute("data-animated"),
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
			rowClass: "flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-body",
			markClass: "relative me-[6px] flex h-[1lh] w-[20px] shrink-0 items-center justify-center",
			markHidden: "true",
			animated: "true",
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
				state={{status: "working", label: "Working…", turnStartedAt: at(0), elapsedSeconds: 3}}
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
			className: "invisible flex min-h-6 flex-col",
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
				state={{status: "working", label: "Working…", turnStartedAt: at(0), elapsedSeconds: 3}}
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

	it("does not animate the spark once the turn is stopping", () => {
		stubReducedMotion(false);
		const {getByRole, container} = render(<WorkingMarker state={{status: "stopping"}} />);
		expect({
			text: visibleLineText(container),
			announcer: getByRole("status").textContent,
			animated: container.querySelector('[data-cds="Spark"]')?.getAttribute("data-animated"),
		}).toStrictEqual({text: "Stopping…", announcer: "Stopping…", animated: "false"});
	});

	it("disables the spark animation under reduced motion", () => {
		stubReducedMotion(true);
		const {container} = render(
			<WorkingMarker state={{status: "working", label: "Working…", turnStartedAt: at(0), elapsedSeconds: 1}} />,
		);
		expect(container.querySelector('[data-cds="Spark"]')?.getAttribute("data-animated")).toStrictEqual("false");
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
		]).toStrictEqual(["3s", "3s", "", "", "", "3s", ""]);
	});

	it("shows no spark for a session waiting on a permission prompt, as upstream does", () => {
		stubReducedMotion(false);
		const {container, getByRole} = render(
			<Harness
				records={OPEN_TURN}
				sessionState="ended"
				isActive={false}
				pendingToolName={undefined}
				awaitingPermission
			/>,
		);
		expect({
			text: getByRole("status").textContent,
			turnStatus: container.querySelector('[data-cds="TurnStatus"]'),
			spark: container.querySelector('[data-cds="Spark"]'),
		}).toStrictEqual({text: "", turnStatus: null, spark: null});
	});
});
