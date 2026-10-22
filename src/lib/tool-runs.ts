/**
 * Upstream's tool-run model (claude.ai/code `RO`/`UO` classifier, `CF` splitter, `OF` bare test).
 *
 * The consecutive tool calls between two prose blocks are cut into runs. A "stands-alone" call
 * is always its own run; consecutive default calls join one run. A run renders as a bare row
 * when every call in it targets the same file with the same verb.
 */

// TODO: upstream also has own-run buckets (`suggested_task` for spawn_task/start_session and
// `parasol_call`), which split at task events. No local producer exists yet.
export type ToolBucket = "default" | "standalone";

export interface RunCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
	result?: string | undefined;
	isError?: boolean | undefined;
	pending?: boolean | undefined;
	hasTaskEvents?: boolean | undefined;
	precedingThinking?: boolean | undefined;
}

const STANDALONE_TOOL_NAMES: ReadonlySet<string> = new Set([
	"AskUserQuestion",
	"ExitPlanMode",
	"SendUserMessage",
	"SendUserFile",
	"Workflow",
	"ReportFindings",
	"ClaudeDesign",
	"mcp__ccd_turn__wrap_up",
]);

const ARTIFACT_SURFACE_ACTIONS: ReadonlySet<unknown> = new Set([undefined, "publish", "edit", "open"]);

const NOT_SENT = /not sent/i;

export function toolBucket(call: Pick<RunCall, "name" | "input" | "result" | "isError" | "pending">): ToolBucket {
	if (STANDALONE_TOOL_NAMES.has(call.name)) return "standalone";
	if (call.name === "Artifact") {
		const surface = Object.keys(call.input).length > 0 && ARTIFACT_SURFACE_ACTIONS.has(call.input["action"]);
		return surface ? "standalone" : "default";
	}
	if (call.name === "PushNotification") {
		const sent = call.pending !== true && call.isError !== true && !NOT_SENT.test(call.result ?? "");
		return sent ? "default" : "standalone";
	}
	return "default";
}

const FILE_VERBS: Readonly<Record<string, string>> = {
	Read: "Read",
	Write: "Write",
	Edit: "Edit",
	MultiEdit: "Edit",
	NotebookEdit: "NotebookEdit",
};

export function targetKey(call: Pick<RunCall, "name" | "input">): string | null {
	const verb = FILE_VERBS[call.name];
	if (verb === undefined) return null;
	const path = call.input["file_path"] ?? call.input["notebook_path"];
	return typeof path === "string" ? `${verb} ${path}` : null;
}

export function rendersBare(calls: readonly RunCall[], options: {showThinking: boolean}): boolean {
	const first = calls[0];
	if (first === undefined) return false;
	const key = targetKey(first);
	if (key === null) return false;
	return calls.every(
		(c, index) =>
			targetKey(c) === key &&
			c.hasTaskEvents !== true &&
			!(options.showThinking && index > 0 && c.precedingThinking === true),
	);
}

export function splitRuns<T extends RunCall>(calls: readonly T[]): T[][] {
	const runs: T[][] = [];
	let previousJoinable = false;
	for (const c of calls) {
		const joinable = toolBucket(c) === "default";
		const last = runs.at(-1);
		if (joinable && previousJoinable && last !== undefined) last.push(c);
		else runs.push([c]);
		previousJoinable = joinable;
	}
	return runs;
}
