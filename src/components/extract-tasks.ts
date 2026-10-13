import type {ClientToolCall} from "./tool-renderers/types";
import {getTaskCreateDisplaySubject, inputString} from "../lib/tool-utils";

export function extractTasks(toolCalls: ClientToolCall[]): TaskItem[] {
	const tasks = new Map<string, TaskItem>();
	let autoId = 0;

	for (const call of toolCalls) {
		if (call.name === "TaskCreate") {
			autoId++;
			const id = String(autoId);
			const description = inputString(call.input, "description") ?? "";
			tasks.set(id, {
				id,
				subject: getTaskCreateDisplaySubject(call.input) || `Task ${id}`,
				description,
				status: "pending",
			});
		} else if (call.name === "TaskUpdate") {
			const taskId = inputString(call.input, "taskId");
			const existing = taskId ? tasks.get(taskId) : undefined;
			if (existing !== undefined) {
				const newStatus = inputString(call.input, "status");
				if (newStatus === "pending" || newStatus === "in_progress" || newStatus === "completed") {
					existing.status = newStatus;
				}
			}
		}
	}

	return Array.from(tasks.values());
}

export interface TaskItem {
	id: string;
	subject: string;
	description: string;
	status: "pending" | "in_progress" | "completed";
}
