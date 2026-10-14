import type {BackgroundTaskStatus} from "./background-tasks";

/** Upstream's noun kinds for a background task notification. */
export type NoticeKind = "shell" | "agent" | "workflow" | "monitor" | "task";

export interface NoticeEntry {
	status: BackgroundTaskStatus;
	kind: NoticeKind;
}

export interface NoticePart {
	key: BackgroundTaskStatus;
	text: string;
	/** Upstream draws the failed part in danger ink. */
	danger: boolean;
}

const NOUNS = {
	shell: ["command", "commands"],
	agent: ["agent", "agents"],
	workflow: ["workflow", "workflows"],
	monitor: ["monitor", "monitors"],
	task: ["task", "tasks"],
} as const satisfies Record<NoticeKind, readonly [string, string]>;

const PART_ORDER = ["completed", "failed", "stopped", "running"] as const satisfies readonly BackgroundTaskStatus[];

/**
 * claude.ai/code's one row for two or more notifications in a slot: "23 background commands
 * completed, 1 stopped". Parts run completed, failed, stopped, running, each only when present;
 * only the first names the noun (singular for a count of 1), the shared kind or "task" for a mix.
 */
export function backgroundNoticeSummary(entries: readonly NoticeEntry[]): NoticePart[] {
	const kinds = new Set(entries.map((entry) => entry.kind));
	const [kind] = kinds.size === 1 ? [...kinds] : ["task" as const];
	const [singular, plural] = NOUNS[kind ?? "task"];
	const parts: NoticePart[] = [];
	for (const key of PART_ORDER) {
		const count = entries.filter((entry) => entry.status === key).length;
		if (count === 0) continue;
		const text =
			parts.length === 0 ? `${count} background ${count === 1 ? singular : plural} ${key}` : `${count} ${key}`;
		parts.push({key, text, danger: key === "failed"});
	}
	return parts;
}
