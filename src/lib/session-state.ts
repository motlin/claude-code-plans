import {z} from "zod";
import type {HookEvent} from "./hook-events";

export type ActivityState = "idle" | "working" | "waiting" | "unknown";

export type SessionSummaryState = ActivityState | "ended";

export function isLiveSessionState(state: SessionSummaryState): state is ActivityState {
	return state !== "ended";
}

export type DisplayState = ActivityState | "review";

export type WaitHeat = "" | "warm" | "hot";

const WAIT_WARM_MS = 10 * 60 * 1000;
const WAIT_HOT_MS = 30 * 60 * 1000;

export const STATE_RANK: Record<DisplayState, number> = {
	waiting: 0,
	review: 1,
	working: 2,
	idle: 3,
	unknown: 4,
};

export function displayState(state: ActivityState, hasUnseenWork: boolean): DisplayState {
	return state === "idle" && hasUnseenWork ? "review" : state;
}

export interface UrgencySortableSession {
	state: DisplayState;
	lastModified: number;
}

export interface StableSortableSession {
	sessionId: string;
	createdAt: number;
}

export function compareByUrgency(first: UrgencySortableSession, second: UrgencySortableSession): number {
	return STATE_RANK[first.state] - STATE_RANK[second.state] || second.lastModified - first.lastModified;
}

/** Keep stable mode independent from changing activity timestamps. */
export function compareByStableCreation(first: StableSortableSession, second: StableSortableSession): number {
	return first.createdAt - second.createdAt || first.sessionId.localeCompare(second.sessionId);
}

export function waitHeat(displayState: DisplayState, blockedSince: string | null, now: number): WaitHeat {
	if (displayState !== "waiting" || blockedSince === null) return "";

	const elapsed = now - Date.parse(blockedSince);
	if (elapsed >= WAIT_HOT_MS) return "hot";
	if (elapsed >= WAIT_WARM_MS) return "warm";
	return "";
}

export function stateForEvent(event: HookEvent): ActivityState | null {
	switch (event.hook_event_name) {
		case "UserPromptSubmit":
			return "working";
		case "PreToolUse":
			return event.tool_name === "AskUserQuestion" || event.tool_name === "ExitPlanMode" ? "waiting" : "working";
		case "PostToolUse":
		case "PostToolUseFailure":
		case "MessageDisplay":
			return "working";
		case "PreCompact":
			return event.trigger === "manual" ? "working" : null;
		case "PostCompact":
			return event.reason === "manual" ? "idle" : null;
		case "Stop":
		case "SessionEnd":
			return "idle";
		default:
			return null;
	}
}

export const SessionBucketSchema = z.enum(["blocked", "review", "working", "done"]);
export type SessionBucket = z.infer<typeof SessionBucketSchema>;

/** Upstream claude.ai/code row icon kinds (`.status-dot[data-kind]` plus the PR glyph and idle ring). */
export const SessionStateKindSchema = z.enum(["awaiting", "running", "ready", "error", "pr", "idle"]);
export type SessionStateKind = z.infer<typeof SessionStateKindSchema>;

const DISPLAY_STATE_KINDS = {
	waiting: "awaiting",
	working: "running",
	review: "ready",
	idle: "idle",
	unknown: "idle",
} as const satisfies Record<DisplayState, SessionStateKind>;

export function sessionStateKind(state: DisplayState): SessionStateKind {
	return DISPLAY_STATE_KINDS[state];
}

export const SessionBucketReasonSchema = z.enum([
	"ended",
	"pending-input",
	"waiting",
	"error",
	"main-working",
	"live-agents",
	"background-tasks",
	"subagent-activity",
	"herdr-working",
	"recent-file",
	"pull-request",
	"unseen",
	"idle",
	"stale-file",
]);
export type SessionBucketReason = z.infer<typeof SessionBucketReasonSchema>;

export const PullRequestStateSchema = z.enum(["open", "draft", "merged", "closed"]);
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;

export interface SessionBucketSignals {
	/** Main-thread state from hooks without `agent_id`; "ended" after SessionEnd or timeout. */
	mainState: SessionSummaryState;
	/** A pending approval / question / permission prompt from S or any of its subagents. */
	pendingInput: boolean;
	unseenError: boolean;
	liveAgentCount: number;
	/** Entries from the last Stop's `background_tasks`. */
	backgroundTasks: readonly {status: string}[];
	lastSubagentActivityAt: number | null;
	herdrStatus: string | null;
	prState: PullRequestState | null;
	unseen: boolean;
	/** Transcript mtime, consulted only for fs-only (`unknown`) sessions. */
	fileMtime: number;
	now: number;
}

export interface SessionBucketResolution {
	bucket: SessionBucket;
	reason: SessionBucketReason;
}

/** Subagent hooks and fs-only transcript writes count as live for this long. */
const RECENT_ACTIVITY_MS = 60 * 1000;
const TERMINAL_BACKGROUND_TASK_STATUSES = new Set(["completed", "failed", "killed"]);

export function isRunningBackgroundTask(task: {status: string}): boolean {
	return !TERMINAL_BACKGROUND_TASK_STATUSES.has(task.status);
}

/**
 * Pure mapping from a root session's signals to its display bucket. Unlike
 * upstream, running subagents and background tasks keep a session Working
 * after the main turn has stopped.
 */
export function resolveSessionBucket(signals: SessionBucketSignals): SessionBucketResolution {
	const {mainState, now} = signals;
	if (mainState === "ended" && !signals.pendingInput) return {bucket: "done", reason: "ended"};
	if (signals.pendingInput) return {bucket: "blocked", reason: "pending-input"};
	if (mainState === "waiting") return {bucket: "blocked", reason: "waiting"};
	if (signals.unseenError) return {bucket: "blocked", reason: "error"};

	if (mainState === "working") return {bucket: "working", reason: "main-working"};
	if (signals.liveAgentCount > 0) return {bucket: "working", reason: "live-agents"};
	if (signals.backgroundTasks.some(isRunningBackgroundTask)) {
		return {bucket: "working", reason: "background-tasks"};
	}
	if (signals.lastSubagentActivityAt !== null && now - signals.lastSubagentActivityAt < RECENT_ACTIVITY_MS) {
		return {bucket: "working", reason: "subagent-activity"};
	}
	if (signals.herdrStatus === "working") return {bucket: "working", reason: "herdr-working"};
	if (mainState === "unknown") {
		return now - signals.fileMtime < RECENT_ACTIVITY_MS
			? {bucket: "working", reason: "recent-file"}
			: {bucket: "done", reason: "stale-file"};
	}

	if (signals.prState === "open" || signals.prState === "draft") {
		return {bucket: "review", reason: "pull-request"};
	}
	if (signals.unseen) return {bucket: "review", reason: "unseen"};
	return {bucket: "done", reason: "idle"};
}

export interface SessionRowIconInput {
	bucket: SessionBucket;
	/** The local unseen flag, which leads the server bucket after a manual toggle. */
	unseen: boolean;
	/** The server's durable unseen flag behind `bucket`. */
	serverUnseen: boolean;
	prStatus: {state: PullRequestState} | undefined;
	showPrStatus: boolean;
}

/**
 * Upstream claude.ai/code `rowStatus`: live states win, then a merged/closed PR, then the
 * unread ready dot, then any PR glyph, else the idle ring. A review row the server did not flag
 * unseen (an open PR) stays ready when the PR glyph is hidden.
 */
export function sessionRowIconKind({
	bucket,
	unseen,
	serverUnseen,
	prStatus,
	showPrStatus,
}: SessionRowIconInput): SessionStateKind {
	if (bucket === "blocked") return "awaiting";
	if (bucket === "working") return "running";
	const pr = showPrStatus ? prStatus : undefined;
	if (pr !== undefined && (pr.state === "merged" || pr.state === "closed")) return "pr";
	if (unseen) return "ready";
	if (pr !== undefined) return "pr";
	return bucket === "review" && !serverUnseen ? "ready" : "idle";
}
