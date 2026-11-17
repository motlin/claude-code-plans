import {isRecord} from "./narrow";
import type {PlanTodo} from "./session-plan-model";
import {turnBoundaryKind} from "./working-marker";

/** Upstream `Qr`'s task-path fields: the session's checklist and what the current turn did with it. */
export interface TurnPlanState
{
	todos: PlanTodo[];
	/** A TodoWrite / TaskCreate / TaskUpdate since the latest prompt (an errored TodoWrite does not count). */
	touchedThisTurn: boolean;
	/** The turn ended (turn_duration or an interrupt) since the latest prompt. */
	turnEnded: boolean;
	/** Tool calls launched this turn that are still running in the background. */
	agentsRunning: number;
}

/** Upstream `FS`'s box: the plan card in the transcript tail, or null when none is drawn. */
export type TurnPlanBox =
{
	todos: PlanTodo[];
	stale: false | "prompt";
	working: boolean;
	leftOpen: boolean;
} | null;

const PLAN_TOOLS: ReadonlySet<string> = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"]);

function contentBlocks(record: Record<string, unknown>): Record<string, unknown>[]
{
	const message = record["message"];
	if (!isRecord(message) || !Array.isArray(message["content"])) return [];
	return message["content"].filter(isRecord);
}

/**
 * Upstream `Qr` on its task path (local sessions always take it): walks the main thread back to the latest real
 * prompt, noting plan-tool calls, a turn end, and calls whose ids are in `runningAgentIds`.
 */
export function turnPlanState(
	records: readonly unknown[],
	todos: PlanTodo[],
	runningAgentIds: ReadonlySet<string>,
): TurnPlanState
{
	let touchedThisTurn = false;
	let turnEnded = false;
	let agentsRunning = 0;
	const failed = new Set<string>();
	for (let index = records.length - 1; index >= 0; index--)
	{
		const record = records[index];
		if (!isRecord(record) || record["isSidechain"] === true) continue;
		const boundary = turnBoundaryKind(record);
		if (boundary === "prompt") break;
		if (boundary === "stop")
		{
			turnEnded = true;
			continue;
		}
		for (const block of contentBlocks(record))
		{
			const id = typeof block["id"] === "string" ? block["id"] : null;
			if (
				block["type"] === "tool_result" &&
				block["is_error"] === true &&
				typeof block["tool_use_id"] === "string"
			)
				failed.add(block["tool_use_id"]);
			if (block["type"] !== "tool_use" || record["type"] !== "assistant") continue;
			if (id !== null && runningAgentIds.has(id)) agentsRunning++;
			const name = block["name"];
			if (typeof name !== "string" || !PLAN_TOOLS.has(name)) continue;
			if (name === "TodoWrite" && id !== null && failed.has(id)) continue;
			touchedThisTurn = true;
		}
	}
	return {
		todos,
		touchedThisTurn,
		turnEnded,
		agentsRunning,
	};
}

/** Upstream `FS` (task path: no side sessions, never cut short). */
export function turnPlanBox(state: TurnPlanState, isResponding: boolean): TurnPlanBox
{
	const {todos, touchedThisTurn, turnEnded, agentsRunning} = state;
	if (todos.length === 0) return null;
	if (turnEnded || !isResponding)
	{
		const keep = agentsRunning > 0;
		return touchedThisTurn && keep
			?
				{
					todos,
					stale: false,
					working: false,
					leftOpen: !keep,
				}
			: null;
	}
	const allDone = todos.every((todo) => todo.status === "completed");
	if (!touchedThisTurn && allDone) return null;
	return {
		todos,
		stale: touchedThisTurn ? false : "prompt",
		working: true,
		leftOpen: false,
	};
}

/** Upstream `PS`: the box holds the turn's loader (the working line moves below it). */
export function planHoldsLoader(box: TurnPlanBox): boolean
{
	return box !== null && !box.leftOpen;
}

/** Upstream's plan box shows at most twelve items. */
const PLAN_WINDOW_SIZE = 12;

export interface PlanWindow
{
	visible: PlanTodo[];
	hiddenBefore: number;
	/** Items after the window that are not completed. */
	openAfter: number;
}

/** Upstream c26f8455e `s`: a window starting one before the active item (the first in progress, else the first open). */
export function planWindow(todos: readonly PlanTodo[], size = PLAN_WINDOW_SIZE): PlanWindow
{
	const inProgress = todos.findIndex((todo) => todo.status === "in_progress");
	const active = inProgress >= 0 ? inProgress : todos.findIndex((todo) => todo.status !== "completed");
	const anchor = active >= 0 ? active : todos.length;
	const start = Math.max(0, Math.min(anchor - 1, todos.length - size));
	const after = todos.slice(start + size);
	return {
		visible: todos.slice(start, start + size),
		hiddenBefore: start,
		openAfter: after.filter((todo) => todo.status !== "completed").length,
	};
}
