import {findLastPendingToolUse, type PendingToolUse} from "./approval-dock";
import {markerEventsFromRecords} from "./working-marker";

/** The Notification hook's `notification_type` for a CLI tool-permission prompt. */
export const PERMISSION_PROMPT_NOTIFICATION = "permission_prompt";

export type PermissionDecision = "allow" | "deny";

/** Keys sent into the live pane: "1" picks the CLI's "Yes", Esc declines. */
export const PERMISSION_DECISION_KEYS = {
	allow: "1",
	deny: "esc",
} as const satisfies Record<PermissionDecision, string>;

export interface PermissionNotification {
	id: string;
	sessionId: string;
	notificationType: string;
	message: string;
}

export interface PendingPermission {
	notificationId: string;
	title: string;
	command: string | null;
}

/** Tools with their own docked card, which never show the permission card. */
const OWN_CARD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

const PRIMARY_INPUT_KEYS = ["command", "file_path", "notebook_path", "url", "pattern", "path"];

function stringInput(input: Record<string, unknown>, key: string): string | null {
	const value = input[key];
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

function primaryInput(input: Record<string, unknown>): string | null {
	for (const key of PRIMARY_INPUT_KEYS) {
		const value = stringInput(input, key);
		if (value !== null) return value;
	}
	return null;
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
}

/**
 * The session is blocked on a tool permission prompt: its last tool call is
 * unanswered and the hook state still holds a `permission_prompt`
 * notification. Upstream treats this as live however old the transcript is.
 */
export function isAwaitingPermission({sessionId, notifications, records}: PermissionSignals): boolean {
	return findPermissionNotification(sessionId, notifications) !== undefined && findWaitingToolUse(records) !== null;
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
}: PermissionSignals & {isActive: boolean}): PendingPermission | null {
	const notification = findPermissionNotification(sessionId, notifications);
	if (notification === undefined) return null;
	const toolUse = isActive ? findLastPendingToolUse(records) : findWaitingToolUse(records);
	if (toolUse === null) {
		return isActive ? {notificationId: notification.id, title: notification.message, command: null} : null;
	}
	if (OWN_CARD_TOOLS.has(toolUse.name)) return null;
	if (toolUse.name === "Bash") {
		const description = stringInput(toolUse.input, "description");
		return {
			notificationId: notification.id,
			title: `Allow Claude to run ${description ?? "this command"}?`,
			command: stringInput(toolUse.input, "command"),
		};
	}
	return {
		notificationId: notification.id,
		title: `Allow Claude to use ${toolUse.name}?`,
		command: primaryInput(toolUse.input),
	};
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
