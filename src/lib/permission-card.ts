import {findLastPendingToolUse, type PendingToolUse} from "./approval-dock";
import type {PendingElicitation} from "./domain-event-payload-schemas";
import {asRecord} from "./narrow";
import {PERMISSION_PROMPT_NOTIFICATION} from "./permission-prompt";
import type {PermissionDialogDecision, PersistentAllowKind} from "./permission-suggestions";
import {markerEventsFromRecords} from "./working-marker";

export type PermissionDecision = PermissionDialogDecision;

export interface PermissionNotification {
	id: string;
	sessionId: string;
	notificationType: string;
	message: string;
	/** The dialog's persistent allow option, from the PermissionRequest hook; absent when it has none. */
	persistentAllow?: PersistentAllowKind | undefined;
}

/**
 * Upstream's card title: "Allow Claude to <action> <meta>?" for a tool call, or
 * the notification's own text when no call in the transcript describes it.
 */
export type PermissionTitle = {action: string; meta: string | null} | {heading: string};

export interface PendingPermission {
	notificationId: string;
	title: PermissionTitle;
	/** The block under the title: the command, the full path, the skill args, or the input as JSON. */
	detail: string | null;
	/** Upstream's footnote under the detail: a Bash command run outside the sandbox or in the background. */
	detailNote?: string;
	/** A Workflow's description line. */
	description?: string;
	/** Upstream's "Dynamic workflows … tasks pane." callout. */
	tokenWarning?: true;
	persistentAllow?: PersistentAllowKind;
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

/** The main thread's unanswered tool call, unless a later turn end (Stop or interrupt) closed it. */
function findWaitingToolUse(records: readonly unknown[]): PendingToolUse | null {
	const toolUse = findLastPendingToolUse(records);
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
}

/**
 * The session is blocked on a tool permission prompt: its last tool call is
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
}: PermissionSignals): string | null {
	const prompted = awaitingPermission || findPermissionNotification(sessionId, notifications) !== undefined;
	return prompted ? (findWaitingToolUse(records)?.id ?? null) : null;
}

/**
 * The tool permission prompt to dock for this session: the hook state holds a
 * `permission_prompt` notification, described by the transcript's pending
 * tool call when there is one. A live session falls back to the notification
 * text (a subagent's call is not in the main thread); an inactive one shows
 * the card only while it is awaiting permission.
 */
export function findPendingPermission({
	sessionId,
	isActive,
	notifications,
	records,
	awaitingPermission = false,
}: PermissionSignals & {isActive: boolean}): PendingPermission | null {
	const notification = findPermissionNotification(sessionId, notifications);
	if (notification === undefined) {
		// Without a notification only the waiting call can describe the prompt.
		const waiting = awaitingPermission ? findWaitingToolUse(records) : null;
		return waiting === null ? null : permissionFor(waiting.id, waiting);
	}
	const toolUse = isActive ? findLastPendingToolUse(records) : findWaitingToolUse(records);
	if (toolUse === null) {
		return isActive
			? withPersistentAllow(
					{notificationId: notification.id, title: {heading: notification.message}, detail: null},
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
	return notification.persistentAllow === undefined
		? permission
		: {...permission, persistentAllow: notification.persistentAllow};
}

function permissionFor(notificationId: string, toolUse: PendingToolUse): PendingPermission {
	const {action, meta = null, detail = null, ...extras} = permissionCopy(toolUse);
	return {notificationId, title: {action, meta}, detail, ...extras};
}

interface PermissionCopy {
	action: string;
	meta?: string | null;
	detail?: string | null;
	detailNote?: string;
	description?: string;
	tokenWarning?: true;
}

/** Upstream's Bash copy: the sandbox and background notes, and no meta when a noted command's description repeats it. */
function commandCopy(input: Record<string, unknown>): PermissionCopy {
	const command = stringInput(input, "command");
	const description = stringInput(input, "description");
	const detailNote = [
		input["dangerouslyDisableSandbox"] === true ? "Runs outside Claude's sandbox." : null,
		input["run_in_background"] === true ? "Keeps running in the background." : null,
	]
		.filter((note) => note !== null)
		.join(" ");
	if (detailNote === "") return {action: "run", meta: description, detail: command};
	return {action: "run", meta: description === command ? null : description, detail: command, detailNote};
}

function workflowCopy(input: Record<string, unknown>): PermissionCopy {
	const description = stringInput(input, "description");
	return {
		action: "run a workflow",
		meta: stringInput(input, "name"),
		...(description === null ? {} : {description}),
		tokenWarning: true,
	};
}

/** A file tool names the file in the title and shows its full path below. */
function fileCopy(action: string, path: string | null): PermissionCopy {
	return path === null ? {action} : {action, meta: path.replace(/^.*[\\/]/, ""), detail: path};
}

/** Upstream's per-tool action, meta and detail (claude.ai/code's permission copy builder). */
function permissionCopy({name, input}: PendingToolUse): PermissionCopy {
	const text = (key: string) => stringInput(input, key);
	switch (name) {
		case "Bash":
		case "PowerShell":
			return commandCopy(input);
		case "Read":
			return fileCopy("read", text("file_path"));
		case "Write":
			return fileCopy("write", text("file_path"));
		case "Edit":
		case "MultiEdit":
			return fileCopy("edit", text("file_path"));
		case "NotebookEdit":
			return fileCopy("edit", text("notebook_path"));
		case "Grep":
		case "Glob":
			return {action: "search", meta: text("pattern")};
		case "WebSearch":
			return {action: "search the web", meta: text("query")};
		case "Skill": {
			const skill = text("skill");
			return {action: "run skill", meta: skill === null ? null : `/${skill}`, detail: text("args")};
		}
		case "Task":
		case "Agent":
			return {action: "run an agent", meta: text("description")};
		case "Workflow":
			return workflowCopy(input);
		default:
			return {action: `use ${name}`, detail: JSON.stringify(input, null, 2)};
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
