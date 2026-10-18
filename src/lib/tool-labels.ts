import type {z} from "zod";
import {FileEditToolUseResultSchema, GitOperationSchema, type GitOperation} from "./schemas";
import {
	exitWorktreeActionLabels,
	gitBranchActionLabels,
	gitCommitKindLabels,
	gitPrActionLabels,
	remoteTriggerActionLabels,
} from "./schema-choices";
import {isRecord} from "./narrow";
import {pastTense, startsWithKnownVerb} from "./past-tense";
import {AskUserQuestionResultSchema, ExitWorktreeActionSchema, RemoteTriggerActionSchema} from "./tool-input-schemas";

/**
 * What a tool row needs from the call's `toolUseResult`, pulled out through
 * strict schemas when the transcript is read so the label can depend on the
 * outcome (a Write that created vs. updated a file, a Bash that committed).
 */
export interface ToolResultMeta {
	writeType?: "create" | "update";
	/**
	 * The lines a file edit added and removed, counted from the result's
	 * `structuredPatch` when the result reports the call's own change.
	 */
	patchStats?: {added: number; removed: number};
	gitOperation?: GitOperation;
	/** The subagent an Agent call launched, which a later SendMessage can address. */
	agentId?: string;
	/** An AskUserQuestion call's answers keyed by question text, with any notes the user typed. */
	answers?: Readonly<Record<string, {answer: string; notes: string | null}>>;
}

export interface ToolLabelCall {
	name: string;
	input: Record<string, unknown>;
	resultMeta?: ToolResultMeta | undefined;
	/** The input failed the tool's schema: label from the name alone. */
	invalidInput?: true | undefined;
	/** A SendMessage recipient's subagent description, when this session launched it. */
	recipientDescription?: string | null | undefined;
	/** The call is the one the session's tool permission prompt waits on. */
	awaitingPermission?: true | undefined;
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

type FileEditToolUseResult = z.infer<typeof FileEditToolUseResultSchema>;

/** The tool_use a result answers, for checking the result reports that call's change. */
export interface ToolResultCall {
	name: string;
	input: Record<string, unknown>;
}

function sameEdits(reported: readonly {old_string: string; new_string: string}[], requested: unknown): boolean {
	if (!Array.isArray(requested) || reported.length === 0 || reported.length !== requested.length) return false;
	return reported.every((edit, index) => {
		const asked: unknown = requested[index];
		return (
			typeof asked === "object" &&
			asked !== null &&
			"old_string" in asked &&
			"new_string" in asked &&
			edit.old_string === asked.old_string &&
			edit.new_string === asked.new_string
		);
	});
}

/**
 * Whether a file edit's result describes the very change its call asked for, as
 * upstream checks before trusting the result's patch: the same file and, for a
 * Write, the same content (or an update the CLI recorded with empty content).
 */
function reportsCallChange(result: FileEditToolUseResult, call: ToolResultCall): boolean {
	if (result.filePath !== call.input["file_path"]) return false;
	switch (call.name) {
		case "Write":
			return (
				"content" in result &&
				(result.content === call.input["content"] || (result.content === "" && result.type === "update"))
			);
		case "Edit":
			return (
				"oldString" in result &&
				result.oldString === call.input["old_string"] &&
				result.newString === call.input["new_string"]
			);
		case "MultiEdit":
			return "edits" in result && sameEdits(result.edits, call.input["edits"]);
		default:
			return false;
	}
}

/** The patch's added and removed line counts, or null for an empty or marker-only patch. */
function patchLineStats(hunks: FileEditToolUseResult["structuredPatch"]): {added: number; removed: number} | null {
	if (hunks === undefined || hunks.length === 0) return null;
	let added = 0;
	let removed = 0;
	for (const {lines} of hunks) {
		if (lines.every((line) => line.startsWith("\\"))) return null;
		for (const line of lines) {
			if (line.startsWith("+")) added++;
			else if (line.startsWith("-")) removed++;
		}
	}
	return {added, removed};
}

function fileEditMeta(result: FileEditToolUseResult, call: ToolResultCall | undefined): ToolResultMeta | undefined {
	const meta: ToolResultMeta = {};
	if ("type" in result) meta.writeType = result.type;
	const patchStats =
		call !== undefined && reportsCallChange(result, call) ? patchLineStats(result.structuredPatch) : null;
	if (patchStats !== null) meta.patchStats = patchStats;
	return Object.keys(meta).length > 0 ? meta : undefined;
}

export function toolResultMetaFrom(toolUseResult: unknown, call?: ToolResultCall): ToolResultMeta | undefined {
	if (typeof toolUseResult !== "object" || toolUseResult === null) return undefined;
	if ("gitOperation" in toolUseResult) {
		const git = GitOperationSchema.safeParse(toolUseResult.gitOperation);
		return git.success ? {gitOperation: git.data} : undefined;
	}
	if ("filePath" in toolUseResult) {
		const file = FileEditToolUseResultSchema.safeParse(toolUseResult);
		if (file.success) return fileEditMeta(file.data, call);
	}
	if ("agentId" in toolUseResult && typeof toolUseResult.agentId === "string" && toolUseResult.agentId !== "") {
		return {agentId: toolUseResult.agentId};
	}
	if ("answers" in toolUseResult) {
		const asked = AskUserQuestionResultSchema.safeParse(toolUseResult);
		if (!asked.success) return undefined;
		const answers: Record<string, {answer: string; notes: string | null}> = {};
		for (const [question, answer] of Object.entries(asked.data.answers)) {
			answers[question] = {answer, notes: asked.data.annotations?.[question]?.notes ?? null};
		}
		return {answers};
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
	// Upstream's generic map: tool_search reads "Loaded tools", with no parameter.
	ToolSearch: {verb: "Loaded tools"},
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
	// Upstream names the row by its first question's header, however many it asks.
	const first: unknown = questions[0];
	if (typeof first !== "object" || first === null || !("header" in first)) return null;
	return typeof first.header === "string" && first.header !== "" ? first.header : null;
}

function withMeta(label: ToolLabel, meta: string | null): ToolLabel {
	return meta === null ? label : {...label, meta};
}

/** Upstream's one-line meta: whitespace collapsed, at most 80 characters with an ellipsis. */
function oneLineMeta(text: unknown): string | null {
	if (typeof text !== "string") return null;
	const line = text.replaceAll(/\s+/g, " ").trim();
	if (line === "") return null;
	if (line.length <= 80) return line;
	// Never split a surrogate pair.
	const end = (line.charCodeAt(78) & 0xfc00) === 0xd800 ? 78 : 79;
	return `${line.slice(0, end).trimEnd()}\u2026`;
}

/** A session address rather than an agent or teammate name. */
const SESSION_ADDRESS = /^(?:did:|uds:|bridge:|\/|local_[0-9a-f-]{8,}$)/;

/** A bare agent id: a short teammate id or `a<16 hex>`, optionally with a name in between. */
const AGENT_ID = /^(?:[a-z0-9]{9}|a(?:[\w-]{1,63}-)?[0-9a-f]{16})$/;

function messageText(message: unknown): string | null {
	if (typeof message === "string") return message.trim() === "" ? null : message;
	if (!isRecord(message)) return null;
	for (const key of ["feedback", "reason"]) {
		const value = message[key];
		if (typeof value === "string" && value.trim() !== "") return value;
	}
	return null;
}

function approval(value: unknown): boolean | undefined {
	if (value === true || value === "true") return true;
	if (value === false || value === "false") return false;
	return undefined;
}

/** The verb a structured plan or shutdown message reads as, or null for a plain message. */
function handshakeVerb(message: Record<string, unknown>, to: string): string | null {
	const approve = approval(message["approve"]);
	switch (message["type"]) {
		case "plan_approval_response":
			return approve === undefined ? null : `${approve ? "Approved" : "Rejected"} plan from @${to}`;
		case "shutdown_request":
			return `Asked @${to} to shut down`;
		case "shutdown_response":
			return approve === undefined ? null : `${approve ? "Approved" : "Declined"} shutdown request from @${to}`;
		default:
			return null;
	}
}

function sendMessageLabel(call: ToolLabelCall): ToolLabel {
	const {input} = call;
	const to = stringInput(input, "to");
	if (to === null || SESSION_ADDRESS.test(to)) return {verb: "Messaged another session"};
	const message = input["message"];
	const meta = oneLineMeta(messageText(message));
	if (isRecord(message)) {
		const verb = handshakeVerb(message, to);
		if (verb !== null) return withMeta({verb}, meta);
	}
	const summaryMeta = oneLineMeta(input["summary"]) ?? meta;
	const kind = input["recipient_kind"];
	const description = call.recipientDescription ?? null;
	if (description !== null || AGENT_ID.test(to) || kind === "agent") {
		return withMeta({verb: "Messaged agent"}, oneLineMeta(description) ?? summaryMeta);
	}
	if (kind === "session") return {verb: "Messaged another session"};
	return withMeta({verb: `Messaged @${to}`}, summaryMeta);
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
			return filePath === null ? label : {...label, meta: filePath.split("/").at(-1) ?? filePath};
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
 * "server: tool name" for `mcp__server__tool`, the server kept as named (upstream
 * reads "Used claude-in-chrome: computer"), dropping a `plugin_<pkg>_` prefix
 * from it and spacing the tool's underscores.
 */
function mcpToolLabel(name: string): string {
	const [server = "", ...toolParts] = name.slice("mcp__".length).split("__");
	const serverName = server.startsWith("plugin_") ? (server.split("_").at(-1) ?? server) : server;
	const tool = toolParts.join("__").replaceAll("_", " ");
	return `${serverName}: ${tool}`;
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
	const [, word, rest] = /^([A-Za-z]+)([\s\S]*)$/.exec(text) ?? [];
	if (word === undefined || rest === undefined) return text;
	const replaced = transform(word.toLowerCase());
	return replaced === null ? text : capitalizeFirst(replaced) + rest;
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
	const done = toolLabel({
		name: call.name,
		input: call.input,
		invalidInput: call.invalidInput,
		recipientDescription: call.recipientDescription,
	});
	const verb = call.name === "Write" ? "Writing" : progressiveOfPast(done.verb);
	const running: RunningToolLabel = {verb};
	if (done.doneLabel !== undefined) {
		const description = stringInput(call.input, "description");
		// A call held at its permission prompt shows the description as written, and so
		// does a running subagent whose description opens with no verb to inflect
		// ("Mobile audit: session page"); upstream reads "Do task" as "Doing task".
		const isAgent = call.name === "Agent" || call.name === "Task";
		const verbatim = call.awaitingPermission === true || (isAgent && !startsWithKnownVerb(description ?? ""));
		running.label = description === null ? done.doneLabel : verbatim ? description : progressive(description);
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
		case "SendMessage":
			return sendMessageLabel(call);
		case "AskUserQuestion": {
			const meta = askedMeta(input);
			// Upstream draws "Asked <header>" as one text run, not a verb and a param.
			return meta === null ? {verb: "Asked"} : {verb: "Asked", meta, doneLabel: `Asked ${meta}`};
		}
	}

	return genericToolLabel(name);
}

/** "Used Read", for a tool with no label of its own or a call it cannot read. */
function genericToolLabel(name: string): ToolLabel {
	const label = name.startsWith("mcp__") ? mcpToolLabel(name) : name;
	return {verb: `Used ${label}`};
}
