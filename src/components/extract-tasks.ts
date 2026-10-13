import type {ClientToolCall} from "./tool-renderers/types";
import {getTaskCreateDisplaySubject} from "../lib/tool-utils";

export function extractTasks(toolCalls: ClientToolCall[]): TaskItem[] {
	const tasks = new Map<string, TaskItem>();
	let autoId = 0;

	for (const call of toolCalls) {
		if (call.name === "TaskCreate") {
			autoId++;
			const id = String(autoId);
			const description = (call.input["description"] as string) ?? "";
			tasks.set(id, {
				id,
				subject: getTaskCreateDisplaySubject(call.input) || `Task ${id}`,
				description,
				status: "pending",
			});
		} else if (call.name === "TaskUpdate") {
			const taskId = call.input["taskId"] as string | undefined;
			const existing = taskId ? tasks.get(taskId) : undefined;
			if (existing !== undefined) {
				const newStatus = call.input["status"] as string | undefined;
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
