import {isRecord} from "./narrow";

export type ChecklistStatus = "pending" | "in_progress" | "completed";

export interface ChecklistItem
{
	id: string;
	content: string;
	status: ChecklistStatus;
}

/** Upstream's `lI` (shared-3): an opening tag with at most a `filenames` attribute, or a closing tag. */
const CC_MEMORY_TAG = /<cc-memory(?:\s+filenames="[^"<>]*")?\s*>|<\/cc-memory\s*>/g;
const WORD_CHAR = /\w/;

/** Upstream's `sh` (shared-3): drop `<cc-memory>` tags outright. */
export function removeMemoryTags(text: string): string
{
	return text.includes("<") ? text.replace(CC_MEMORY_TAG, "") : text;
}

/** Drop `<cc-memory>` tags, joining the words around one with a word joiner as upstream does. */
export function stripMemoryTags(text: string): string
{
	return text.replace(CC_MEMORY_TAG, (tag: string, offset: number) =>
		WORD_CHAR.test(text.charAt(offset - 1)) && WORD_CHAR.test(text.charAt(offset + tag.length)) ? "⁠" : "",
	);
}

function statusOf(value: unknown): ChecklistStatus
{
	return value === "completed" || value === "in_progress" ? value : "pending";
}

function nonBlank(value: unknown): string | undefined
{
	if (typeof value !== "string") return undefined;
	const text = stripMemoryTags(value);
	return text.trim() === "" ? undefined : text;
}

/**
 * Upstream's checklist for a task tool call, built from the call's own input
 * alone: TaskCreate and TaskUpdate name one task (description, else subject);
 * every other tool lists `input.todos`, which only TodoWrite carries, so
 * TaskGet, TaskList and TaskStop list nothing.
 */
export function taskChecklist(name: string, input: Record<string, unknown>): ChecklistItem[]
{
	if (name === "TaskCreate" || name === "TaskUpdate")
	{
		const content = nonBlank(input["description"]) ?? nonBlank(input["subject"]);
		return content === undefined
			? []
			: [
					{
						id: "task",
						content,
						status: statusOf(input["status"]),
					},
				];
	}
	const todos = input["todos"];
	const items = new Map<string, ChecklistItem>();
	for (const [index, todo] of (Array.isArray(todos) ? todos : []).entries())
	{
		if (!isRecord(todo)) continue;
		const text =
			(typeof todo["content"] === "string" ? todo["content"] : undefined) ??
			(typeof todo["text"] === "string" ? todo["text"] : undefined) ??
			"";
		if (text === "") continue;
		const id = typeof todo["id"] === "string" ? todo["id"] : `todo-${index}`;
		items.set(
			id,
			{
				id,
				content: stripMemoryTags(text),
				status: statusOf(todo["status"]),
			},
		);
	}
	return [...items.values()];
}
