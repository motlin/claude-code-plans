import {isRecord} from "./narrow";
import type {SessionLine} from "./transcript";

export interface PlanTodo {
	content: string;
	status: string;
	activeForm?: string;
}

/** What upstream's Plan pane shows: the latest ExitPlanMode plan text and the session's checklist. */
export interface SessionPlanModel {
	content: string | null;
	todos: PlanTodo[];
	/** Whether the session wrote or edited a `~/.claude/plans/*.md` file. */
	editsPlanFile: boolean;
}

const PLAN_FILE_PATH = /\/\.claude\/plans\/[^/]+\.md$/;

function todoOf(value: unknown): PlanTodo | null {
	if (!isRecord(value) || typeof value["content"] !== "string") return null;
	const todo: PlanTodo = {
		content: value["content"],
		status: typeof value["status"] === "string" ? value["status"] : "pending",
	};
	if (typeof value["activeForm"] === "string") todo.activeForm = value["activeForm"];
	return todo;
}

/**
 * claude.ai/code's plan model, built from the main transcript's assistant tool calls: the latest
 * ExitPlanMode `plan` or Write to a plan file, and the checklist from TodoWrite (replacing it) or TaskCreate / TaskUpdate
 * (task ids numbered in creation order, as the CLI's task list numbers them).
 */
export function sessionPlanModel(lines: readonly SessionLine[]): SessionPlanModel {
	let content: string | null = null;
	let todos: PlanTodo[] = [];
	let editsPlanFile = false;
	const tasks = new Map<string, PlanTodo>();
	for (const line of lines) {
		if (line.type !== "assistant" || !Array.isArray(line.message?.content)) continue;
		for (const block of line.message.content) {
			if (block.type !== "tool_use" || !isRecord(block.input)) continue;
			const input = block.input;
			switch (block.name) {
				case "ExitPlanMode":
					if (typeof input["plan"] === "string" && input["plan"] !== "") content = input["plan"];
					break;
				case "Write":
				case "Edit":
					if (typeof input["file_path"] !== "string" || !PLAN_FILE_PATH.test(input["file_path"])) break;
					editsPlanFile = true;
					if (block.name === "Write" && typeof input["content"] === "string") content = input["content"];
					break;
				case "TodoWrite":
					if (Array.isArray(input["todos"])) {
						todos = input["todos"].flatMap((todo) => todoOf(todo) ?? []);
						tasks.clear();
					}
					break;
				case "TaskCreate": {
					if (typeof input["subject"] !== "string") break;
					const task: PlanTodo = {content: input["subject"], status: "pending"};
					if (typeof input["activeForm"] === "string") task.activeForm = input["activeForm"];
					tasks.set(String(tasks.size + 1), task);
					todos = [...tasks.values()];
					break;
				}
				case "TaskUpdate": {
					const id = input["taskId"] ?? input["id"];
					const task = tasks.get(String(id));
					if (task === undefined) break;
					if (typeof input["status"] === "string") task.status = input["status"];
					if (typeof input["subject"] === "string") task.content = input["subject"];
					todos = [...tasks.values()].filter((entry) => entry.status !== "deleted");
					break;
				}
				default:
					break;
			}
		}
	}
	return {content, todos, editsPlanFile};
}
