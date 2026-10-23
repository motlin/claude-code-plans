import {findLastPendingToolUse, type PendingToolUse} from "./approval-dock";
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

/** Upstream's card keys: 1 or Esc deny, 2 or ⌘⏎ allow once. */
export function permissionDecisionForKey(event: PermissionKeyEvent): PermissionDecision | null {
	if (event.altKey || event.shiftKey) return null;
	if (event.metaKey || event.ctrlKey) return event.key === "Enter" ? "allow" : null;
	switch (event.key) {
		case "1":
		case "Escape":
			return "deny";
		case "2":
			return "allow";
		default:
			return null;
	}
}
