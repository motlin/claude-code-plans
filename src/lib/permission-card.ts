import {findPendingToolUses, matchPendingToolUse, type PendingToolUse, type PermissionAsk} from "./approval-dock";
import type {PendingElicitation} from "./domain-event-payload-schemas";
import {asRecord} from "./narrow";
import {PERMISSION_PROMPT_NOTIFICATION} from "./permission-prompt";
import {clampRows, inputRows, rowsFitBudget, type PermissionRow} from "./permission-rows";
import type {PermissionDialogDecision, PersistentAllowKind, PersistentAllowSave} from "./permission-suggestions";
import {markerEventsFromRecords} from "./working-marker";

export type PermissionDecision = PermissionDialogDecision;

export interface PermissionNotification {
	id: string;
	sessionId: string;
	notificationType: string;
	message: string;
	/** The dialog's persistent allow option, from the PermissionRequest hook; absent when it has none. */
	persistentAllow?: PersistentAllowKind | undefined;
	/** What the persistent option adds; set with `persistentAllow`. */
	persistentAllowSaves?: PersistentAllowSave[] | undefined;
}

/**
 * Upstream's card title: "Allow Claude to <action> <meta>?" for a tool call, or
 * the notification's own text when no call in the transcript describes it.
 */
export type PermissionTitle = {action: string; meta: string | null} | {heading: string};

export interface PendingPermission {
	notificationId: string;
	/** The transcript's tool call the prompt holds, shared by every signal; null when none describes it. */
	toolUseId: string | null;
	title: PermissionTitle;
	/** The block under the title: the command, the full path, the skill args, or the input as JSON. */
	detail: string | null;
	/** A command detail drawn as upstream's highlighted code card. */
	detailLang?: PermissionDetailLang;
	/** Upstream's `clampTitle`: the title value is clamped to two lines. */
	clampTitle?: true;
	/** Upstream's footnote under the detail, such as a Bash command's sandbox, background and time-limit notes. */
	detailNote?: string;
	/** The description line in the body: a Bash command's, an agent's or a Workflow's. */
	description?: string;
	/** Upstream's "Dynamic workflows … background tasks pane." callout. */
	tokenWarning?: true;
	/** Upstream's `detailFirst`: the detail leads the body. */
	detailFirst?: true;
	/** Upstream's input rows: the call's other input as key/value rows. */
	rows?: PermissionRow[];
	/** Upstream's `rowsTrail`: the rows close the body in the "What Claude sent" panel. */
	rowsTrail?: true;
	/** Upstream's loose rows read gate (`rowsReadGate {loose: true}`). */
	rowsGate?: true;
	/** Upstream's `fileChange`: a Write/Edit/MultiEdit card previews its change, or says it is too large to. */
	fileChange?: FileChangeKind;
	/** The previewed file tool's name, for its diff. */
	toolName?: string;
	/** The previewed file tool's input, for its diff. */
	toolInput?: Record<string, unknown>;
	persistentAllow?: PersistentAllowKind;
	/** What the persistent option adds, listed in the body; absent for an elicitation's verdict. */
	persistentAllowSaves?: PersistentAllowSave[];
}

/** Tools with their own docked card, which never show the permission card. */
const OWN_CARD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

function stringInput(input: Record<string, unknown>, key: string): string | null {
	const value = input[key];
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

function findPermissionNotification(
	sessionId: string,
	notifications: readonly PermissionNotification[],
): PermissionNotification | undefined {
	return notifications.find(
		(candidate) =>
			candidate.sessionId === sessionId && candidate.notificationType === PERMISSION_PROMPT_NOTIFICATION,
	);
}

/**
 * The unanswered main-thread call the prompt asks about: the one the hook's ask
 * names (same tool, deep-equal input), else the first, since the CLI asks a
 * serial batch's tools in order and a parallel ask's siblings may have finished.
 */
function findAskedToolUse(records: readonly unknown[], ask: PermissionAsk | undefined): PendingToolUse | null {
	const pending = findPendingToolUses(records);
	return (ask === undefined ? null : matchPendingToolUse(pending, ask)) ?? pending[0] ?? null;
}

/** The call the prompt asks about, unless a later turn end (Stop or interrupt) closed it. */
function findWaitingToolUse(records: readonly unknown[], ask: PermissionAsk | undefined): PendingToolUse | null {
	const toolUse = findAskedToolUse(records, ask);
	if (toolUse === null || OWN_CARD_TOOLS.has(toolUse.name)) return null;
	return markerEventsFromRecords(records).at(-1)?.kind === "stop" ? null : toolUse;
}

interface PermissionSignals {
	sessionId: string;
	notifications: readonly PermissionNotification[];
	records: readonly unknown[];
	/**
	 * The session itself reports a permission wait (its registry `waitingFor`),
	 * which still holds when the hook notification predates this server.
	 */
	awaitingPermission?: boolean;
	/** The hook's report of the ask, which picks its call when several are pending. */
	ask?: PermissionAsk | undefined;
}

/**
 * The session is blocked on a tool permission prompt: the call it asks about is
 * unanswered and the hook state still holds a `permission_prompt`
 * notification, or the session reports the wait itself. Upstream treats this as live however old the transcript is.
 */
export function isAwaitingPermission(signals: PermissionSignals): boolean {
	return permissionWaitToolUseId(signals) !== null;
}

/** The id of the unanswered tool call the session's permission prompt holds, or null when none does. */
export function permissionWaitToolUseId({
	sessionId,
	notifications,
	records,
	awaitingPermission = false,
	ask,
}: PermissionSignals): string | null {
	const prompted = awaitingPermission || findPermissionNotification(sessionId, notifications) !== undefined;
	return prompted ? (findWaitingToolUse(records, ask)?.id ?? null) : null;
}

/**
 * The tool permission prompt to dock for this session: the hook state holds a
 * `permission_prompt` notification, described by the transcript's pending
 * tool call it asks about when there is one. A live session falls back to the notification
 * text (a subagent's call is not in the main thread); an inactive one shows
 * the card only while it is awaiting permission.
 */
export function findPendingPermission({
	sessionId,
	isActive,
	notifications,
	records,
	awaitingPermission = false,
	ask,
}: PermissionSignals & {isActive: boolean}): PendingPermission | null {
	const notification = findPermissionNotification(sessionId, notifications);
	if (notification === undefined) {
		// Without a notification only the waiting call can describe the prompt.
		const waiting = awaitingPermission ? findWaitingToolUse(records, ask) : null;
		return waiting === null ? null : permissionFor(waiting.id, waiting);
	}
	const toolUse = isActive ? findAskedToolUse(records, ask) : findWaitingToolUse(records, ask);
	if (toolUse === null) {
		return isActive
			? withPersistentAllow(
					{
						notificationId: notification.id,
						toolUseId: null,
						title: {heading: notification.message},
						detail: null,
					},
					notification,
				)
			: null;
	}
	if (OWN_CARD_TOOLS.has(toolUse.name)) return null;
	return withPersistentAllow(permissionFor(notification.id, toolUse), notification);
}

/** The `verdict` property's enum values, or null when the schema has no such enum. */
function verdictEnum(schema: unknown): readonly unknown[] | null {
	const verdict = asRecord(asRecord(asRecord(schema)?.["properties"])?.["verdict"]);
	const values = verdict?.["enum"];
	return Array.isArray(values) ? values : null;
}

/** Upstream's `Xr`: a permission-style elicitation, whose `verdict` enum offers both "allow" and "deny". */
export function isVerdictSchema(schema: unknown): boolean {
	const values = verdictEnum(schema);
	return values !== null && values.includes("allow") && values.includes("deny");
}

/**
 * The oldest verdict elicitation as upstream's permission card: "Allow Claude
 * to use {server}?" with the message below, and Always allow only when the
 * verdict enum offers "always_allow" (upstream's `NH`). Forms and url asks get no card.
 */
export function findPendingElicitationPermission(entries: readonly PendingElicitation[]): PendingPermission | null {
	const entry = entries.find((candidate) => candidate.mode === "form" && isVerdictSchema(candidate.requestedSchema));
	if (entry === undefined) return null;
	const permission: PendingPermission = {
		notificationId: elicitationKey(entry),
		toolUseId: null,
		title: {action: `use ${entry.serverName}`, meta: null},
		detail: null,
		description: entry.message,
	};
	if (verdictEnum(entry.requestedSchema)?.includes("always_allow") === true) permission.persistentAllow = "always";
	return permission;
}

/** The oldest form or url elicitation: one the CLI's terminal dialog answers, not a verdict card. */
function oldestTerminalElicitation(entries: readonly PendingElicitation[]): PendingElicitation | undefined {
	return entries.find((candidate) => candidate.mode === "url" || !isVerdictSchema(candidate.requestedSchema));
}

/** Upstream's `kE`: the longest elicitation message it draws. */
const ELICITATION_MESSAGE_MAX = 4000;

/**
 * The oldest form or url elicitation, named for the waiting notice with
 * upstream's form-card heading "{server} requests your input" and its message.
 * Verdict elicitations draw a permission card instead, so they are skipped.
 */
export function findElicitationWaitingNotice(
	entries: readonly PendingElicitation[],
): {title: string; message: string} | null {
	const entry = oldestTerminalElicitation(entries);
	if (entry === undefined) return null;
	return {
		title: `${entry.serverName} requests your input`,
		message: entry.message.slice(0, ELICITATION_MESSAGE_MAX),
	};
}

/** A url elicitation the dock can answer: Open presses the CLI dialog's Accept, Decline its Decline. */
export interface UrlElicitationCardModel {
	/** Stable per elicitation: its id, else server and arrival. */
	key: string;
	serverName: string;
	message: string;
	url: string;
}

/**
 * The url elicitation the CLI shows now, as a card: the oldest form or url
 * elicitation (the order the CLI shows them in), when it is a url ask with a url.
 */
export function findUrlElicitationCard(entries: readonly PendingElicitation[]): UrlElicitationCardModel | null {
	const entry = oldestTerminalElicitation(entries);
	if (entry?.mode !== "url" || entry.url === undefined) return null;
	return {
		key: elicitationKey(entry),
		serverName: entry.serverName,
		message: entry.message.slice(0, ELICITATION_MESSAGE_MAX),
		url: entry.url,
	};
}

function elicitationKey(entry: PendingElicitation): string {
	return `elicitation:${entry.elicitationId ?? `${entry.serverName}:${entry.receivedAt}`}`;
}

function withPersistentAllow(permission: PendingPermission, notification: PermissionNotification): PendingPermission {
	const {persistentAllow, persistentAllowSaves} = notification;
	if (persistentAllow === undefined) return permission;
	return persistentAllowSaves === undefined
		? {...permission, persistentAllow}
		: {...permission, persistentAllow, persistentAllowSaves};
}

function permissionFor(notificationId: string, toolUse: PendingToolUse): PendingPermission {
	const {action, meta = null, detail = null, ...extras} = withRowsBudget(permissionCopy(toolUse));
	return {
		notificationId,
		toolUseId: toolUse.id,
		title: {action, meta},
		detail,
		...extras,
		...(extras.fileChange === undefined ? {} : {toolName: toolUse.name, toolInput: toolUse.input}),
	};
}

/**
 * The key a prompt is answered and drawn under: its tool call, which the hook
 * notification and the registry wait share, else the notification or elicitation id.
 */
export function permissionAnswerKey(permission: PendingPermission): string {
	return permission.toolUseId ?? permission.notificationId;
}

/** The highlighter language of a command detail: upstream's `detailLang`. */
export type PermissionDetailLang = "bash" | "powershell";

interface PermissionCopy {
	action: string;
	meta?: string | null;
	detail?: string | null;
	detailLang?: PermissionDetailLang;
	clampTitle?: true;
	detailNote?: string;
	description?: string;
	tokenWarning?: true;
	detailFirst?: true;
	rows?: PermissionRow[];
	rowsTrail?: true;
	rowsGate?: true;
	fileChange?: FileChangeKind;
}

/** Upstream's `fileChange`: "preview" draws the change's diff, "too_large" says why it can't. */
export type FileChangeKind = "preview" | "too_large";

/** Upstream's `Jq`/`gy` cap: a change string over 200,000 characters is too large to preview. */
export const FILE_CHANGE_PREVIEW_MAX_CHARS = 200_000;

/**
 * Upstream's `Dv`: whether a Write/Edit/MultiEdit call can preview its change. Nothing without a string
 * path or when a changed string isn't a string; "too_large" once any string passes the cap.
 */
function fileChangeKind(name: string, input: Record<string, unknown>): Pick<PermissionCopy, "fileChange"> {
	if (typeof input["file_path"] !== "string") return {};
	let strings: unknown[];
	const edits = input["edits"];
	if (name === "Write") strings = [input["content"]];
	else if (name === "Edit") strings = [input["old_string"], input["new_string"]];
	else if (Array.isArray(edits) && edits.length > 0)
		strings = edits.flatMap((edit: unknown) => {
			const record = asRecord(edit);
			return record === undefined ? [undefined] : [record["old_string"], record["new_string"]];
		});
	else return {};
	if (!strings.every((value): value is string => typeof value === "string")) return {};
	return {
		fileChange: strings.every((value) => value.length <= FILE_CHANGE_PREVIEW_MAX_CHARS) ? "preview" : "too_large",
	};
}

/** Upstream's `xh`: the edit replaces every match, at the top level or in any of its edits. */
function replacesEveryMatch(input: Record<string, unknown>): boolean {
	const edits = input["edits"];
	return (
		input["replace_all"] === true ||
		(Array.isArray(edits) && edits.some((edit: unknown) => asRecord(edit)?.["replace_all"] === true))
	);
}

function numberInput(input: Record<string, unknown>, key: string): number | null {
	const value = input[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Joins the notes that apply, or yields nothing when none does. */
function notes(parts: readonly (string | null)[], separator = " "): {detailNote?: string} {
	const detailNote = parts.filter((part) => part !== null).join(separator);
	return detailNote === "" ? {} : {detailNote};
}

function plural(count: number, unit: string): string {
	return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** Upstream's "Time limit: {n} seconds." note, in minutes when the limit is a whole number of them. */
function timeLimitNote(timeout: number | null): string | null {
	if (timeout === null || timeout <= 0) return null;
	const seconds = Math.round(timeout / 1000);
	return seconds % 60 === 0
		? `Time limit: ${plural(seconds / 60, "minute")}.`
		: `Time limit: ${plural(seconds, "second")}.`;
}

/**
 * Upstream's Bash copy: "run this command" with the command as a highlighted detail,
 * the description in the body unless it repeats the command, and the sandbox, background and time-limit notes.
 */
function commandCopy(input: Record<string, unknown>, detailLang: PermissionDetailLang): PermissionCopy {
	const command = stringInput(input, "command");
	const description = stringInput(input, "description");
	return {
		action: "run this command",
		detail: command,
		detailLang,
		clampTitle: true,
		...(description === null || description === command ? {} : {description}),
		...notes([
			input["dangerouslyDisableSandbox"] === true ? "Runs outside Claude’s sandbox." : null,
			input["run_in_background"] === true ? "Keeps running in the background." : null,
			timeLimitNote(numberInput(input, "timeout")),
		]),
	};
}

/** Upstream's Workflow copy: its args other than the script (and the name it is titled by) as gated trail rows. */
function workflowCopy(input: Record<string, unknown>): PermissionCopy {
	const name = stringInput(input, "name");
	const description = stringInput(input, "description");
	const args = Object.fromEntries(
		Object.entries(input).filter(([key, value]) => key !== "script" && (key !== "name" || value !== name)),
	);
	return {
		action: name === null ? "run a workflow" : "run the workflow",
		meta: name,
		...(description === null ? {} : {description}),
		tokenWarning: true,
		...gatedTrail(inputRows(args)),
	};
}

/** A file tool names the file in the title and shows its full path below. */
function fileCopy(action: string, path: string | null): PermissionCopy {
	return path === null ? {action} : {action, meta: path.replace(/^.*[\\/]/, ""), detail: path};
}

/** Upstream's Read range note: the line range, then the page range, comma-joined. */
function readNote(input: Record<string, unknown>): string | null {
	const offset = numberInput(input, "offset");
	const limit = numberInput(input, "limit");
	const pages = stringInput(input, "pages");
	let lines: string | null = null;
	if (offset !== null && limit !== null) {
		lines = limit === 1 ? `Line ${offset}` : `Lines ${offset} to ${offset + limit - 1}`;
	} else if (offset !== null) {
		lines = `From line ${offset}`;
	} else if (limit !== null) {
		lines = `First ${plural(limit, "line")}`;
	}
	const page =
		pages === null || !PAGE_LIST.test(pages)
			? null
			: /^\d+$/.test(pages.trim())
				? `Page ${pages.trim()}`
				: `Pages ${pages.trim()}`;
	return [lines, page].filter((part) => part !== null).join(", ") || null;
}

/** Upstream's `Ch` page list: anything else is drawn as a "Pages" row instead of the note. */
const PAGE_LIST = /^ *\d[\d ,-]{0,39}$/;

/** Upstream's Read rows: a `pages` value that isn't a plain page list, as a bare row. */
function readRows(input: Record<string, unknown>): Pick<PermissionCopy, "rows"> {
	const pages = input["pages"];
	return typeof pages === "string" && pages !== "" && !PAGE_LIST.test(pages) ? {rows: inputRows({pages})} : {};
}

/** Upstream's NotebookEdit notes: what happens to which cell, then its type. */
function notebookNote(input: Record<string, unknown>): string | null {
	const cell = stringInput(input, "cell_id");
	const cellType = stringInput(input, "cell_type");
	const mode = stringInput(input, "edit_mode") ?? "replace";
	let change: string | null = null;
	if (mode === "insert")
		change = cell === null ? "Adds a new cell at the top." : `Adds a new cell after cell ${cell}.`;
	else if (cell !== null) change = mode === "delete" ? `Deletes cell ${cell}.` : `Replaces cell ${cell}.`;
	return (
		[change, cellType === null ? null : `Cell type: ${cellType}.`].filter((part) => part !== null).join(" ") || null
	);
}

/** Upstream's `Mm` map: tools with a dedicated verb and nothing else to name in the title. */
const TOOL_VERBS: Readonly<Record<string, string>> = {
	TaskCreate: "create a task",
	TaskUpdate: "update a task",
	TaskGet: "read a task",
	TaskList: "list its tasks",
	TaskStop: "stop a task",
	TaskOutput: "read a task’s output",
	TodoWrite: "update its to-do list",
	CronDelete: "delete a scheduled prompt",
	CronList: "list its scheduled prompts",
	ScheduleWakeup: "schedule a wake-up",
	SendMessage: "send a message to an agent",
	ListAgents: "list its agents",
	EnterPlanMode: "start planning",
	ReportFindings: "report its findings",
	KillBash: "stop a command",
	KillShell: "stop a command",
	BashOutput: "read a command’s output",
	LS: "list a folder",
	ToolSearch: "load tools",
	REPL: "run code",
	JavaScript: "run code",
};

/** Upstream's `_h`: verb tools whose rows hold Allow behind the loose read gate instead of clamping. */
const GATED_VERB_TOOLS = new Set(["REPL", "JavaScript", "SendMessage", "ScheduleWakeup", "TaskCreate", "TaskUpdate"]);

/** Upstream's `yh`: a SendMessage input without the fields its message summary repeats. */
function sendMessageInput(input: Record<string, unknown>): Record<string, unknown> {
	const summary: Record<string, unknown> = {
		type: "message",
		recipient: input["to"],
		recipient_kind: "name",
		content: input["message"],
	};
	return Object.fromEntries(
		Object.entries(input).filter(([key, value]) => !(key in summary && value === summary[key])),
	);
}

/** Upstream's `bh`: the input without a string description, which the body already shows. */
function withoutDescription(input: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(input).filter(([key, value]) => key !== "description" || typeof value !== "string"),
	);
}

/**
 * Upstream's `jv`: the main key as a leading detail and every other key as rows. A non-string main value
 * stays among the rows.
 */
function withRows(
	input: Record<string, unknown>,
	mainKey?: string,
): Pick<PermissionCopy, "detail" | "detailFirst" | "rows"> {
	const main = mainKey === undefined ? undefined : input[mainKey];
	const detail = typeof main === "string" ? main : undefined;
	const rows = inputRows(
		Object.fromEntries(Object.entries(input).filter(([key]) => detail === undefined || key !== mainKey)),
	);
	return {
		...(detail === undefined ? {} : {detail, detailFirst: true as const}),
		...(rows.length > 0 ? {rows} : {}),
	};
}

/** Rows in the trail panel behind upstream's loose read gate (`b`), when there are any. */
function gatedTrail(rows: PermissionRow[]): Pick<PermissionCopy, "rows" | "rowsTrail" | "rowsGate"> {
	return rows.length > 0 ? {rows, rowsTrail: true, rowsGate: true} : {};
}

/** Rows in the trail panel, clamped to 6 lines and ungated (upstream's `te(P())`). */
function clampedTrail(rows: PermissionRow[]): Pick<PermissionCopy, "rows" | "rowsTrail"> {
	return rows.length > 0 ? {rows: clampRows(rows), rowsTrail: true} : {};
}

/** Upstream's `te` over `jv`: bare rows clamped to 6 lines. */
function clampedBare(copy: PermissionCopy): PermissionCopy {
	return copy.rows === undefined ? copy : {...copy, rows: clampRows(copy.rows)};
}

/** Gates a copy's trail rows when it has rows (upstream spreads `b` whether or not rows exist). */
function gateRows(copy: PermissionCopy): PermissionCopy {
	return copy.rows === undefined ? copy : {...copy, rowsTrail: true, rowsGate: true};
}

/** Upstream's post-pass `N_`: ungated rows beyond the budget move to the trail panel behind the loose gate. */
function withRowsBudget(copy: PermissionCopy): PermissionCopy {
	if (copy.rows === undefined || copy.rows.length === 0 || copy.rowsGate === true || rowsFitBudget(copy.rows)) {
		return copy;
	}
	return {...copy, rowsTrail: true, rowsGate: true};
}

function hostOf(url: string): string | null {
	try {
		const host = new URL(url).hostname;
		return host === "" ? null : host;
	} catch {
		return null;
	}
}

/** Upstream's WebFetch copy: "fetch {host}" with the url leading, and a non-blank prompt as a gated trail row. */
function webFetchCopy(input: Record<string, unknown>): PermissionCopy {
	const url = stringInput(input, "url");
	const host = url === null ? null : hostOf(url);
	const prompt = stringInput(input, "prompt");
	return {
		...(host === null ? {action: "fetch a web page"} : {action: "fetch", meta: host}),
		...(url === null ? {} : {detail: url, detailFirst: true}),
		...gatedTrail(prompt === null ? [] : inputRows({prompt})),
	};
}

/** Upstream's per-tool action, meta and detail (claude.ai/code's permission copy builder). */
function permissionCopy({name, input}: PendingToolUse): PermissionCopy {
	const text = (key: string) => stringInput(input, key);
	switch (name) {
		case "Bash":
		case "BashTool":
			return commandCopy(input, "bash");
		case "PowerShell":
			return commandCopy(input, "powershell");
		case "Read":
			return {
				...fileCopy("read", text("file_path")),
				clampTitle: true,
				...notes([readNote(input)]),
				...readRows(input),
			};
		case "Write":
			return {
				...fileCopy("write", text("file_path")),
				clampTitle: true,
				...(input["content"] === "" ? notes(["Leaves the file empty."]) : fileChangeKind(name, input)),
			};
		case "Edit":
		case "MultiEdit":
			return {
				...fileCopy("edit", text("file_path")),
				clampTitle: true,
				...fileChangeKind(name, input),
				...notes([replacesEveryMatch(input) ? "Replaces every match in the file." : null]),
			};
		case "NotebookEdit":
			return {...fileCopy("edit", text("notebook_path")), ...notes([notebookNote(input)])};
		case "Glob":
			return clampedBare({action: "find files", ...withRows(input, "pattern")});
		case "Grep":
			return clampedBare({action: "search files", ...withRows(input, "pattern")});
		case "WebFetch":
			return webFetchCopy(input);
		case "WebSearch":
			return clampedBare({action: "search the web", ...withRows(input, "query")});
		case "Skill": {
			const skill = text("skill");
			return {action: "run skill", meta: skill === null ? null : `/${skill}`, detail: text("args")};
		}
		case "Task":
		case "Agent": {
			const description = text("description");
			return {
				action: "run an agent",
				...(description === null ? {} : {description}),
				...gatedTrail(inputRows(withoutDescription(input))),
			};
		}
		case "Workflow":
			return workflowCopy(input);
		case "Monitor": {
			const rows = withRows(withoutDescription(input), "command");
			return gateRows(
				rows.detail === undefined
					? {action: "open and watch a connection", ...rows}
					: {action: "run and watch a command", ...rows, detailLang: "bash"},
			);
		}
		case "CronCreate":
			return gateRows({action: "schedule a prompt", ...withRows(input, "prompt")});
		case "EnterWorktree":
			return {
				action: text("path") === null ? "create a worktree" : "move to a worktree",
				...clampedTrail(inputRows(input)),
			};
		case "ExitWorktree":
			return {
				action: text("action") === "remove" ? "delete the worktree and its branch" : "leave the worktree",
				...clampedTrail(inputRows(input)),
			};
		default: {
			const verb = TOOL_VERBS[name];
			if (verb === undefined) return {action: `use ${name}`, ...gatedTrail(inputRows(input))};
			const rows = inputRows(name === "SendMessage" ? sendMessageInput(input) : input);
			return {action: verb, ...(GATED_VERB_TOOLS.has(name) ? gatedTrail(rows) : clampedTrail(rows))};
		}
	}
}

export interface PermissionKeyEvent {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}

/**
 * Upstream's inline card keys: Esc denies, ⌘⏎ allows once and ⇧⌘⏎ grants the persistent option.
 * Digits are dock-only upstream, so the inline card binds none, and ⌘⏎ yields to alt.
 */
export function permissionDecisionForKey(event: PermissionKeyEvent): PermissionDecision | null {
	if (event.altKey) return null;
	if (event.metaKey || event.ctrlKey) {
		if (event.key !== "Enter") return null;
		return event.shiftKey ? "always" : "allow";
	}
	return event.key === "Escape" && !event.shiftKey ? "deny" : null;
}
