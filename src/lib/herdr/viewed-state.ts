import type {HerdrPaneLink} from "./panes";

type HerdrAttentionStatus = "blocked" | "done" | "working" | "idle" | "unknown";

interface AgentStatusPart {
	agent: string | null;
	status: string;
}

interface TrackedPane {
	sessionId: string;
	terminalId: string;
}

type Write = void | Promise<void>;

export interface HerdrViewedStateTrackerDependencies {
	isSessionVisible: (sessionId: string) => boolean;
	linkTerminal: (terminalId: string, sessionId: string) => Write;
	pruneTerminalLinks: (sessionId: string, activeTerminalIds: string[]) => Write;
	markSessionCompletionUnreviewed: (sessionId: string) => Write;
	markTerminalUnviewed: (terminalId: string, sessionId: string) => Write;
	markTerminalViewed: (terminalId: string, sessionId: string) => Write;
}

function completionStatus(status: string): string {
	return status === "done" ? "idle" : status;
}

/** Match herdr's completion rule while accounting for its derived `done` wire status. */
export function isCompletionTransitionParts(previous: AgentStatusPart, next: AgentStatusPart): boolean {
	const previousStatus = completionStatus(previous.status);
	const nextStatus = completionStatus(next.status);
	if (nextStatus !== "idle") return false;
	if (previousStatus === "working" || previousStatus === "blocked") return true;
	return (
		previousStatus === "unknown" && previous.agent !== null && next.agent !== null && previous.agent === next.agent
	);
}

const ATTENTION_RANK: Readonly<Record<HerdrAttentionStatus, number>> = {
	blocked: 0,
	done: 1,
	working: 2,
	idle: 3,
	unknown: 4,
};

function knownAttentionStatus(status: string): HerdrAttentionStatus {
	return status in ATTENTION_RANK ? (status as HerdrAttentionStatus) : "unknown";
}

/** Copy herdr's workspace ordering, where completed work outranks active work. */
export function compareHerdrAttention(
	left: Pick<HerdrPaneLink, "agentStatus">,
	right: Pick<HerdrPaneLink, "agentStatus">,
): number {
	return (
		ATTENTION_RANK[knownAttentionStatus(left.agentStatus)] - ATTENTION_RANK[knownAttentionStatus(right.agentStatus)]
	);
}

/**
 * In-memory transition state updates synchronously; the DB writes each call implies run in call order on a serial
 * queue, so a write that waits out a busy lock can never land after a later write. Each returned promise settles when
 * that call's writes finish and rejects with the first failure; the queue moves on regardless.
 */
export function createHerdrViewedStateTracker(dependencies: HerdrViewedStateTrackerDependencies): {
	syncPanes: (panes: HerdrPaneLink[]) => Promise<void>;
	handleStatusEvent: (data: Record<string, unknown>) => Promise<void>;
} {
	const panesByPaneId = new Map<string, TrackedPane>();
	const statusByTerminalId = new Map<string, AgentStatusPart>();
	let writeQueue: Promise<void> = Promise.resolve();

	const enqueueWrites = (writes: Array<() => Write>): Promise<void> => {
		if (writes.length === 0) return Promise.resolve();
		const run = writeQueue.then(async () => {
			for (const write of writes) await write();
		});
		writeQueue = run.catch(() => {});
		return run;
	};

	const syncPanes = (panes: HerdrPaneLink[]): Promise<void> => {
		panesByPaneId.clear();
		const writes: Array<() => Write> = [];
		const terminalIdsBySessionId = new Map<string, string[]>();
		for (const pane of panes) {
			panesByPaneId.set(pane.paneId, {
				sessionId: pane.sessionId,
				terminalId: pane.terminalId,
			});
			statusByTerminalId.set(pane.terminalId, {
				status: pane.agentStatus,
				agent: pane.agent,
			});
			// A snapshot can follow a herdr restart, which resets its server-side
			// `seen` bit. Seed transition state, but never manufacture a viewed edge.
			writes.push(() => dependencies.linkTerminal(pane.terminalId, pane.sessionId));
			const terminalIds = terminalIdsBySessionId.get(pane.sessionId);
			if (terminalIds) terminalIds.push(pane.terminalId);
			else terminalIdsBySessionId.set(pane.sessionId, [pane.terminalId]);
		}
		for (const [sessionId, terminalIds] of terminalIdsBySessionId) {
			writes.push(() => dependencies.pruneTerminalLinks(sessionId, terminalIds));
		}
		return enqueueWrites(writes);
	};

	const handleStatusEvent = (data: Record<string, unknown>): Promise<void> => {
		const paneId = data["pane_id"];
		const agentStatus = data["agent_status"];
		const agent = data["agent"];
		if (
			typeof paneId !== "string" ||
			typeof agentStatus !== "string" ||
			(agent !== undefined && agent !== null && typeof agent !== "string")
		) {
			return Promise.resolve();
		}

		const pane = panesByPaneId.get(paneId);
		if (!pane) return Promise.resolve();

		const next: AgentStatusPart = {
			status: agentStatus,
			agent: typeof agent === "string" ? agent : null,
		};
		const previous = statusByTerminalId.get(pane.terminalId);
		statusByTerminalId.set(pane.terminalId, next);
		if (!previous) return Promise.resolve();

		const {terminalId, sessionId} = pane;
		const writes: Array<() => Write> = [];
		if (previous.status === "done" && next.status === "idle") {
			writes.push(() => dependencies.markTerminalViewed(terminalId, sessionId));
		}

		if (isCompletionTransitionParts(previous, next)) {
			writes.push(() => dependencies.markTerminalUnviewed(terminalId, sessionId));
			if (!dependencies.isSessionVisible(sessionId)) {
				writes.push(() => dependencies.markSessionCompletionUnreviewed(sessionId));
			}
		}
		return enqueueWrites(writes);
	};

	return {syncPanes, handleStatusEvent};
}
