import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

import type {PlanTodo} from "../src/lib/session-plan-model";
import {ruleStart} from "./css-rule";
import {planHoldsLoader, planWindow, turnPlanBox, turnPlanState} from "../src/lib/turn-plan-box";

function prompt(uuid: string): Record<string, unknown>
{
	return {
		type: "user",
		uuid,
		timestamp: "2026-11-17T10:00:00.000Z",
		message:
		{
			role: "user",
			content: "Fabricated prompt: tidy the repo.",
		},
	};
}

function toolUse(id: string, name: string, input: Record<string, unknown> = {}): Record<string, unknown>
{
	return {
		type: "assistant",
		uuid: `a-${id}`,
		timestamp: "2026-11-17T10:00:01.000Z",
		message:
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id,
					name,
					input,
				},
			],
		},
	};
}

function toolResult(id: string, isError: boolean): Record<string, unknown>
{
	return {
		type: "user",
		uuid: `r-${id}`,
		timestamp: "2026-11-17T10:00:02.000Z",
		message:
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					content: isError ? "Fabricated failure" : "ok",
					is_error: isError,
				},
			],
		},
	};
}

const TURN_END: Record<string, unknown> =
{
	type: "system",
	subtype: "turn_duration",
	timestamp: "2026-11-17T10:00:03.000Z",
	durationMs: 3000,
};

const TODOS: PlanTodo[] = [
	{
		content: "Read the config",
		status: "completed",
	},
	{
		content: "Fix the loader",
		status: "in_progress",
	},
	{
		content: "Run the tests",
		status: "pending",
	},
];

const ALL_DONE: PlanTodo[] = TODOS.map((todo) => (
{
	...todo,
	status: "completed",
}));

const NONE: ReadonlySet<string> = new Set();

describe("turnPlanState and turnPlanBox (upstream Qr task path and FS)", () =>
{
	it("draws no box without todos", () =>
	{
		const state = turnPlanState([prompt("u1"), toolUse("t1", "TodoWrite")], [], NONE);
		expect(turnPlanBox(state, true)).toBeNull();
	});
	it("holds a working box while the plan was touched this turn and the turn responds", () =>
	{
		const state = turnPlanState([prompt("u1"), toolUse("t1", "TodoWrite"), toolResult("t1", false)], TODOS, NONE);
		const box = turnPlanBox(state, true);
		expect(
			{
				state,
				box,
				holds: planHoldsLoader(box),
			},
		).toStrictEqual(
			{
				state:
				{
					todos: TODOS,
					touchedThisTurn: true,
					turnEnded: false,
					agentsRunning: 0,
				},
				box:
				{
					todos: TODOS,
					stale: false,
					working: true,
					leftOpen: false,
				},
				holds: true,
			},
		);
	});
	it("marks a plan from before the latest prompt stale, and drops it once every item is done", () =>
	{
		const records = [prompt("u1"), toolUse("t1", "TaskUpdate"), toolResult("t1", false), TURN_END, prompt("u2")];
		expect([
			turnPlanBox(turnPlanState(records, TODOS, NONE), true),
			turnPlanBox(turnPlanState(records, ALL_DONE, NONE), true),
		]).toStrictEqual([
			{
				todos: TODOS,
				stale: "prompt",
				working: true,
				leftOpen: false,
			},
			null,
		]);
	});
	it("drops the box when the turn ends, unless an agent launched this turn still runs", () =>
	{
		const records = [
			prompt("u1"),
			toolUse("t1", "TodoWrite"),
			toolResult("t1", false),
			toolUse("agent1", "Agent"),
			toolResult("agent1", false),
			TURN_END,
		];
		const running = turnPlanBox(turnPlanState(records, TODOS, new Set(["agent1"])), false);
		expect(
			{
				ended: turnPlanBox(turnPlanState(records, TODOS, NONE), true),
				running,
				holds: planHoldsLoader(running),
			},
		).toStrictEqual(
			{
				ended: null,
				running:
				{
					todos: TODOS,
					stale: false,
					working: false,
					leftOpen: false,
				},
				holds: true,
			},
		);
	});
	it("does not count a TodoWrite whose result is an error as touching the plan", () =>
	{
		const state = turnPlanState([prompt("u1"), toolUse("t1", "TodoWrite"), toolResult("t1", true)], TODOS, NONE);
		expect([state.touchedThisTurn, turnPlanBox(state, true)?.stale]).toStrictEqual([false, "prompt"]);
	});
});

describe("planWindow (upstream c26f8455e `s`)", () =>
{
	function todos(count: number, active: number): PlanTodo[]
	{
		return Array.from(
			{
				length: count,
			},
			(_, index) => (
			{
				content: `Step ${index + 1}`,
				status: index < active ? "completed" : index === active ? "in_progress" : "pending",
			}),
		);
	}
	it("starts one before the active item and counts the open items after the window", () =>
	{
		const window = planWindow(todos(20, 15));
		expect(
			{
				first: window.visible[0]?.content,
				visible: window.visible.length,
				hiddenBefore: window.hiddenBefore,
				openAfter: window.openAfter,
			},
		).toStrictEqual(
			{
				first: "Step 9",
				visible: 12,
				hiddenBefore: 8,
				openAfter: 0,
			},
		);
	});
	it("shows the head when the active item is first", () =>
	{
		const window = planWindow(todos(20, 0));
		expect([window.hiddenBefore, window.visible.length, window.openAfter]).toStrictEqual([0, 12, 8]);
	});
});

describe("the plan box's globals.css rules (upstream shared CSS)", () =>
{
	const styles = readFileSync("src/styles/globals.css", "utf8");
	function rule(selector: string): string
	{
		const start = ruleStart(styles, selector);
		return start === -1
			? ""
			: styles
					.slice(styles.indexOf("{", start) + 1, styles.indexOf("\n}", start))
					.replaceAll(/\s+/g, " ")
					.trim();
	}
	it("ports the exit, fade and first-line rules and the motion tokens they read", () =>
	{
		expect(
			{
				exitKeyframes: rule("@keyframes epitaxy-plan-exit"),
				exit: rule(".epitaxy-root .epitaxy-plan-exit"),
				fadeKeyframes: rule("@keyframes fade-in"),
				fade: styles.match(/--animate-fade-in:\s*([^;]+);/)?.[1],
				firstLine: rule(".epitaxy-markdown-first-line"),
				easeOut: styles.match(/--cds-ease-out:\s*([^;]+);/)?.[1],
			},
		).toStrictEqual(
			{
				exitKeyframes:
					"to { margin-top: calc(-1 * var(--chat-turn-gap, 15px)); opacity: 0; grid-template-rows: 0fr; }",
				exit: "animation: epitaxy-plan-exit var(--cds-dur-base) var(--cds-ease-out) calc(var(--cds-dur-base) / -12) forwards;",
				fadeKeyframes: "from { opacity: 0; } to { opacity: 1; }",
				fade: "fade-in 0.3s cubic-bezier(0.25, 0.1, 0.35, 1)",
				firstLine:
					"height: 1lh; font-size: var(--chat-body, var(--cds-font-size-body)); line-height: var(--chat-leading, var(--cds-leading-body));",
				easeOut: "cubic-bezier(0.165, 0.84, 0.44, 1)",
			},
		);
	});
});
