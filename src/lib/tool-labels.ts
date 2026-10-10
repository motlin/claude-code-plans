import {FileEditToolUseResultSchema, GitOperationSchema, type GitOperation} from "./schemas";
import {
	exitWorktreeActionLabels,
	gitBranchActionLabels,
	gitCommitKindLabels,
	gitPrActionLabels,
	remoteTriggerActionLabels,
} from "./schema-choices";
import {pastTense} from "./past-tense";
import {ExitWorktreeActionSchema, RemoteTriggerActionSchema} from "./tool-input-schemas";

/**
 * What a tool row needs from the call's `toolUseResult`, pulled out through
 * strict schemas when the transcript is read so the label can depend on the
 * outcome (a Write that created vs. updated a file, a Bash that committed).
 */
export interface ToolResultMeta {
	writeType?: "create" | "update";
	gitOperation?: GitOperation;
}

export interface ToolLabelCall {
	name: string;
	input: Record<string, unknown>;
	resultMeta?: ToolResultMeta | undefined;
	/** The input failed the tool's schema: label from the name alone. */
	invalidInput?: true | undefined;
}

/**
 * Upstream claude.ai/code's label for a tool row: the verb, an optional meta
 * beside it. `doneLabel` is a whole
 * phrase that names a successful row on its own (a Bash call's past-tensed
 * description, a subagent's description) in place of verb + meta.
 */
export interface ToolLabel {
	verb: string;
	meta?: string;
	metaIsCode?: true;
	metaHref?: string;
	doneLabel?: string;
}

export function toolResultMetaFrom(toolUseResult: unknown): ToolResultMeta | undefined {
	if (typeof toolUseResult !== "object" || toolUseResult === null) return undefined;
	if ("gitOperation" in toolUseResult) {
		const git = GitOperationSchema.safeParse(toolUseResult.gitOperation);
		return git.success ? {gitOperation: git.data} : undefined;
	}
	if ("type" in toolUseResult) {
		const file = FileEditToolUseResultSchema.safeParse(toolUseResult);
		if (file.success && "type" in file.data) return {writeType: file.data.type};
	}
	return undefined;
}

function capitalizeFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Tools whose label is a fixed phrase: upstream's per-tool table plus its
 * generic map.
 */
const FIXED_LABELS: Record<string, {verb: string}> = {
	Read: {verb: "Read"},
	Edit: {verb: "Edited"},
	MultiEdit: {verb: "Edited"},
	NotebookEdit: {verb: "Edited"},
	Grep: {verb: "Searched"},
	Glob: {verb: "Searched"},
	LS: {verb: "Listed"},
	WebFetch: {verb: "Fetched"},
	WebSearch: {verb: "Searched web"},
	TaskGet: {verb: "Read task"},
	TaskList: {verb: "Listed tasks"},
	TaskCreate: {verb: "Added task"},
	TaskStop: {verb: "Stopped task"},
	EnterPlanMode: {verb: "Started planning"},
	ExitPlanMode: {verb: "Proposed plan"},
	// Not in upstream's table (claude.ai/code has no deferred tools); kept local.
	ToolSearch: {verb: "Searched tools"},
	ReportFindings: {
		verb: "Reported review findings",
	},
	TaskOutput: {verb: "Read task output"},
	Monitor: {
		verb: "Started watching background command",
	},
	CronList: {verb: "Listed scheduled prompts"},
	CronDelete: {verb: "Stopped scheduled prompt"},
	LSP: {verb: "Inspected code"},
	ListMcpResourcesTool: {verb: "Listed resources"},
	ReadMcpResourceTool: {verb: "Read resource"},
	ReadMcpResourceDirTool: {
		verb: "Listed resource folder",
	},
	WaitForMcpServers: {verb: "Loaded connectors"},
	RefreshMcpTools: {verb: "Refreshed tools"},
	Workflow: {verb: "Ran workflow"},
	SendFeedback: {verb: "Sent feedback"},
	SendUserMessage: {verb: "Sent"},
	SendUserFile: {verb: "Sent"},
	PushNotification: {verb: "Sent notification"},
};

const TASK_STATUS_VERBS: Record<string, string> = {
	completed: "Completed task",
	in_progress: "Started task",
	pending: "Reset task to pending",
	deleted: "Removed task",
};

function stringInput(input: Record<string, unknown>, key: string): string | null {
	const value = input[key];
	return typeof value === "string" && value !== "" ? value : null;
}

function taskUpdateVerb(input: Record<string, unknown>): string {
	const status = stringInput(input, "status");
	if (status !== null) return TASK_STATUS_VERBS[status] ?? "Updated task status";
	const changed = Object.keys(input).filter((key) => key !== "taskId" && key !== "task_id");
	if (changed.length === 1 && changed[0] === "subject") return "Renamed task";
	return "Updated task";
}

function askedMeta(input: Record<string, unknown>): string | null {
	const questions = input["questions"];
	if (!Array.isArray(questions) || questions.length === 0) return null;
	if (questions.length > 1) return `${questions.length} questions`;
	const first: unknown = questions[0];
	if (typeof first !== "object" || first === null || !("header" in first)) return null;
	return typeof first.header === "string" && first.header !== "" ? first.header : null;
}

function withMeta(label: ToolLabel, meta: string | null): ToolLabel {
	return meta === null ? label : {...label, meta};
}

function basename(path: string): string {
	return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

function enterWorktreeLabel(input: Record<string, unknown>): ToolLabel {
	const path = stringInput(input, "path");
	if (path !== null) {
		return {verb: "Entered a worktree", meta: basename(path)};
	}
	return withMeta({verb: "Created a worktree"}, stringInput(input, "name"));
}

function exitWorktreeLabel(input: Record<string, unknown>): ToolLabel {
	const action = ExitWorktreeActionSchema.safeParse(input["action"]);
	return {verb: exitWorktreeActionLabels[action.success ? action.data : "keep"]};
}

function scheduleWakeupLabel(input: Record<string, unknown>): ToolLabel {
	if (input["stop"] === true) return {verb: "Stopped loop"};
	return withMeta({verb: "Scheduled check-in"}, stringInput(input, "reason"));
}

/** A `<<...>>` prompt is a loop sentinel, not text worth showing as meta. */
function cronCreateLabel(input: Record<string, unknown>): ToolLabel {
	const prompt = stringInput(input, "prompt");
	const meta = prompt !== null && /^<<[\s\S]*>>$/.test(prompt) ? null : prompt;
	const label = {verb: input["recurring"] === false ? "Scheduled prompt" : "Started loop"};
	return withMeta(label, meta);
}

function remoteTriggerLabel(input: Record<string, unknown>): ToolLabel {
	const action = RemoteTriggerActionSchema.safeParse(input["action"]);
	if (!action.success) return {verb: "Used routines"};
	return {verb: remoteTriggerActionLabels[action.data]};
}

function gitLabel(git: GitOperation): ToolLabel | null {
	if (git.pr) {
		const label = {verb: gitPrActionLabels[git.pr.action], meta: `#${git.pr.number}`};
		return git.pr.url === undefined ? label : {...label, metaHref: git.pr.url};
	}
	if (git.commit) return {verb: gitCommitKindLabels[git.commit.kind], meta: git.commit.sha.slice(0, 7)};
	if (git.push) return {verb: "Pushed", meta: git.push.branch};
	if (git.branch) return {verb: gitBranchActionLabels[git.branch.action], meta: git.branch.ref};
	return null;
}

function bashLabel(call: ToolLabelCall): ToolLabel {
	const git = call.resultMeta?.gitOperation;
	const gitVerb = git === undefined ? null : gitLabel(git);
	if (gitVerb !== null) return gitVerb;
	const description = stringInput(call.input, "description");
	const command = stringInput(call.input, "command");
	if (description !== null) {
		return {verb: "Ran", meta: description, doneLabel: pastTense(description)};
	}
	if (command !== null) return {verb: "Ran", meta: command, doneLabel: command};
	return {verb: "Ran", meta: "a command"};
}

/**
 * Upstream's Artifact row: "Published artifact" with the file's basename,
 * "Pinned/Unpinned artifact", "Listed artifacts", and otherwise "Used artifact
 * tool" with the action as meta.
 */
function artifactLabel(input: Record<string, unknown>): ToolLabel {
	const action = stringInput(input, "action");
	switch (action) {
		case null:
		case "publish": {
			const filePath = stringInput(input, "file_path");
			const label = {verb: "Published artifact"};
			return filePath === null ? label : {...label, meta: filePath.split("/").pop()!};
		}
		case "pin":
			return {verb: "Pinned artifact"};
		case "unpin":
			return {verb: "Unpinned artifact"};
		case "list":
			return {verb: "Listed artifacts"};
		default:
			return {
				verb: "Used artifact tool",
				meta: action,
			};
	}
}

/**
 * "Server: tool name" for `mcp__server__tool`, dropping a `plugin_<pkg>_`
 * prefix from the server and spacing the tool's underscores.
 */
function mcpToolLabel(name: string): string {
	const [server = "", ...toolParts] = name.slice("mcp__".length).split("__");
	const serverName = server.startsWith("plugin_") ? server.split("_").pop()! : server;
	const tool = toolParts.join("__").replaceAll("_", " ");
	return `${capitalizeFirst(serverName)}: ${tool}`;
}

/**
 * The label an in-flight tool row shows before its result arrives, as upstream
 * names it with the progressive verb ("Reading", "Running agent"). `label` is a
 * whole phrase in place of verb + meta, like `ToolLabel.doneLabel`.
 */
export interface RunningToolLabel {
	verb: string;
	meta?: string;
	metaIsCode?: true;
	label?: string;
}

/** Progressive forms of past-tense verbs that don't end in -ed. */
const IRREGULAR_PAST_PROGRESSIVE: Record<string, string> = {
	built: "building",
	cut: "cutting",
	found: "finding",
	got: "getting",
	kept: "keeping",
	left: "leaving",
	made: "making",
	put: "putting",
	ran: "running",
	read: "reading",
	reran: "rerunning",
	reset: "resetting",
	saw: "seeing",
	sent: "sending",
	set: "setting",
	split: "splitting",
	took: "taking",
	told: "telling",
	wrote: "writing",
};

/** Base verbs whose progressive form doubles a final consonant the syllable rule misses. */
const DOUBLED_PROGRESSIVE = new Set([
	"admit",
	"begin",
	"commit",
	"emit",
	"forget",
	"omit",
	"permit",
	"rerun",
	"submit",
]);

/** Base verbs with a progressive form no suffix rule produces. */
const IRREGULAR_BASE_PROGRESSIVE: Record<string, string> = {
	be: "being",
	see: "seeing",
};

function replaceLeadingWord(text: string, transform: (lower: string) => string | null): string {
	const match = /^([A-Za-z]+)([\s\S]*)$/.exec(text);
	if (!match) return text;
	const replaced = transform(match[1]!.toLowerCase());
	return replaced === null ? text : capitalizeFirst(replaced) + match[2]!;
}

/** "Ran agent" -> "Running agent", "Searched web" -> "Searching web". */
function progressiveOfPast(verb: string): string {
	return replaceLeadingWord(verb, (word) => {
		const irregular = IRREGULAR_PAST_PROGRESSIVE[word];
		if (irregular) return irregular;
		if (word.endsWith("ied")) return `${word.slice(0, -3)}ying`;
		if (word.endsWith("ed")) return `${word.slice(0, -2)}ing`;
		return null;
	});
}

/**
 * Progressive form of a description's leading verb, the way upstream labels an
 * in-flight Bash row: "Poll PR #1" -> "Polling PR #1", "Run tests" -> "Running
 * tests", "Write config" -> "Writing config". A description already in -ing or
 * past tense is left verbatim.
 */
function progressive(description: string): string {
	return replaceLeadingWord(description, (word) => {
		if (word.endsWith("ing") || (word.endsWith("ed") && !word.endsWith("eed"))) return null;
		const irregular = IRREGULAR_BASE_PROGRESSIVE[word];
		if (irregular) return irregular;
		if (DOUBLED_PROGRESSIVE.has(word)) return `${word}${word.at(-1)}ing`;
		if (word.endsWith("ie")) return `${word.slice(0, -2)}ying`;
		if (/[^aeiouy]e$/.test(word)) return `${word.slice(0, -1)}ing`;
		// A one-syllable consonant-vowel-consonant verb doubles its final consonant.
		if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(word)) return `${word}${word.at(-1)}ing`;
		return `${word}ing`;
	});
}

export function runningToolLabel(call: ToolLabelCall): RunningToolLabel {
	const done = toolLabel({name: call.name, input: call.input, invalidInput: call.invalidInput});
	const verb = call.name === "Write" ? "Writing" : progressiveOfPast(done.verb);
	const running: RunningToolLabel = {verb};
	if (done.doneLabel !== undefined) {
		const description = stringInput(call.input, "description");
		// A running subagent shows its description as written.
		const isAgent = call.name === "Agent" || call.name === "Task";
		running.label = description === null ? done.doneLabel : isAgent ? description : progressive(description);
		return running;
	}
	if (done.meta !== undefined) running.meta = done.meta;
	if (done.metaIsCode) running.metaIsCode = true;
	return running;
}

/** A running label as one phrase, for rows that show only the in-flight call. */
export function runningToolLabelText(label: RunningToolLabel): string {
	return label.label ?? (label.meta === undefined ? label.verb : `${label.verb} ${label.meta}`);
}

export function toolLabel(call: ToolLabelCall): ToolLabel {
	const {name, input} = call;
	if (call.invalidInput === true) return genericToolLabel(name);
	const fixed = FIXED_LABELS[name];
	if (fixed) return {...fixed};

	switch (name) {
		case "Bash":
		case "PowerShell":
			return bashLabel(call);
		case "Write":
			return {verb: call.resultMeta?.writeType === "update" ? "Updated" : "Created"};
		case "Agent":
		case "Task": {
			const description = stringInput(input, "description");
			if (description === null) return {verb: "Ran agent"};
			return {verb: "Ran agent", meta: description, doneLabel: pastTense(description)};
		}
		case "Skill": {
			const skill = stringInput(input, "skill");
			if (skill === null) return {verb: "Ran skill"};
			return {verb: "Ran skill", meta: `/${skill}`, metaIsCode: true};
		}
		case "EnterWorktree":
			return enterWorktreeLabel(input);
		case "ExitWorktree":
			return exitWorktreeLabel(input);
		case "ScheduleWakeup":
			return scheduleWakeupLabel(input);
		case "CronCreate":
			return cronCreateLabel(input);
		case "RemoteTrigger":
			return remoteTriggerLabel(input);
		case "TaskUpdate":
			return {verb: taskUpdateVerb(input)};
		case "TodoWrite": {
			const todos = input["todos"];
			const cleared = Array.isArray(todos) && todos.length === 0;
			return {verb: cleared ? "Cleared todos" : "Updated todos"};
		}
		case "Artifact":
			return artifactLabel(input);
		case "AskUserQuestion": {
			const meta = askedMeta(input);
			return meta === null ? {verb: "Asked"} : {verb: "Asked", meta};
		}
	}

	return genericToolLabel(name);
}

/** "Used Read", for a tool with no label of its own or a call it cannot read. */
function genericToolLabel(name: string): ToolLabel {
	const label = name.startsWith("mcp__") ? mcpToolLabel(name) : name;
	return {verb: `Used ${label}`};
}
