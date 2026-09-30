import {hmrDispose, hmrPersist} from "./hmr-persist";
import type {HookBackgroundTaskPayload} from "./hook-events";
import {isRunningBackgroundTask} from "./session-state";
import type {Subagent} from "./subagents";
import {toSubagentSessionId} from "./subagents";

export interface LiveSubagentNode {
	agentId: string;
	sessionId: string;
	parentAgentId: string | null;
	agentType: string;
	description: string;
	startedAt: string;
	endedAt: string | null;
}

/**
 * A session can legitimately fan out into dozens of agents, but retaining more
 * than 100 live/recent nodes makes the tree hard to use and permits one runaway
 * session to consume the process-wide store. The cap is per root session so a
 * noisy session cannot evict another session's nodes.
 */
export const MAX_LIVE_SUBAGENTS_PER_SESSION = 100;
export const ENDED_SUBAGENT_TTL_MS = 5 * 60 * 1000;
/**
 * A running node with no agent-scoped hook for this long is presumed lost (a
 * dropped SubagentStop, or a server restart mid-run) and is ended so it cannot
 * pin the root session as working forever.
 */
export const STALE_RUNNING_SUBAGENT_MS = 10 * 60 * 1000;
const LIVE_SUBAGENT_SWEEP_INTERVAL_MS = 60 * 1000;

let sweepTimer: ReturnType<typeof setInterval> | null = null;

hmrDispose(stopLiveSubagentSweep);

function canonicalAgentId(agentId: string): string {
	return toSubagentSessionId(agentId);
}

function getStore(): Map<string, LiveSubagentNode> {
	return hmrPersist("liveSubagentStore", () => new Map<string, LiveSubagentNode>());
}

/** Last agent-scoped hook time per canonical agent id; kept off the wire node. */
function getActivity(): Map<string, number> {
	return hmrPersist("liveSubagentActivity", () => new Map<string, number>());
}

function enforceSessionCap(target: Map<string, LiveSubagentNode>, sessionId: string): void {
	const sessionNodes = [...target.values()]
		.filter((node) => node.sessionId === sessionId)
		.sort((left, right) => left.startedAt.localeCompare(right.startedAt));

	while (sessionNodes.length > MAX_LIVE_SUBAGENTS_PER_SESSION) {
		const oldestEndedIndex = sessionNodes.findIndex((node) => node.endedAt !== null);
		const removeIndex = oldestEndedIndex === -1 ? 0 : oldestEndedIndex;
		const [removed] = sessionNodes.splice(removeIndex, 1);
		if (removed) target.delete(removed.agentId);
	}
}

/**
 * Record a captured `SubagentStart`. Captured hooks establish that
 * `parentSessionId` is the spawning transcript's id while `agentId` is the raw
 * child id. A nested spawn therefore joins to an existing live node after
 * canonicalizing both ids; otherwise the spawning session is the root.
 */
export function recordLiveSubagentStart(
	target: Map<string, LiveSubagentNode>,
	input: {
		parentSessionId: string;
		agentId: string;
		agentType: string;
		description: string;
	},
	now: number = Date.now(),
): LiveSubagentNode | null {
	if (input.agentId === "") return null;

	const agentId = canonicalAgentId(input.agentId);
	const parent = target.get(canonicalAgentId(input.parentSessionId));
	const node: LiveSubagentNode = {
		agentId,
		sessionId: parent?.sessionId ?? input.parentSessionId,
		parentAgentId: parent?.agentId ?? null,
		agentType: input.agentType,
		description: input.description,
		startedAt: new Date(now).toISOString(),
		endedAt: null,
	};
	target.set(agentId, node);
	enforceSessionCap(target, node.sessionId);
	return node;
}

/** Mark the node addressed by a raw or canonical subagent session id as ended. */
export function recordLiveSubagentStop(
	target: Map<string, LiveSubagentNode>,
	agentSessionId: string,
	now: number = Date.now(),
): LiveSubagentNode | null {
	const agentId = canonicalAgentId(agentSessionId);
	const node = target.get(agentId);
	if (!node) return null;
	if (node.endedAt !== null) return node;
	const ended = {...node, endedAt: new Date(now).toISOString()};
	target.set(agentId, ended);
	return ended;
}

/**
 * Close every still-running descendant when the parent session emits `Stop`,
 * except `keepIds` (agents the Stop still lists as running background tasks).
 * Cancelled agents emit no `SubagentStop`, so this is their terminal census.
 */
export function reconcileLiveSubagents(
	target: Map<string, LiveSubagentNode>,
	sessionId: string,
	now: number = Date.now(),
	keepIds: ReadonlySet<string> = new Set(),
): LiveSubagentNode[] {
	const endedAt = new Date(now).toISOString();
	const reconciled: LiveSubagentNode[] = [];
	for (const node of target.values()) {
		if (node.sessionId !== sessionId || node.endedAt !== null) continue;
		if (keepIds.has(node.agentId)) continue;
		const ended = {...node, endedAt};
		target.set(node.agentId, ended);
		reconciled.push(ended);
	}
	return reconciled;
}

/**
 * Live node ids of `sessionId` that a Stop's `background_tasks` still lists as
 * running agents. A task matches a node by its id or by agent type plus
 * description. When any running agent task cannot be matched, every live node
 * of the session is kept, because ending a still-running agent is worse than
 * leaving a finished one open until its SubagentStop or the stale sweep.
 */
export function runningBackgroundAgentIds(
	target: Map<string, LiveSubagentNode>,
	sessionId: string,
	backgroundTasks: readonly HookBackgroundTaskPayload[],
): Set<string> {
	const liveNodes = [...target.values()].filter((node) => node.sessionId === sessionId && node.endedAt === null);
	const runningAgentTasks = backgroundTasks.filter(
		(task) => task.type === "local_agent" && isRunningBackgroundTask(task),
	);
	const keepIds = new Set<string>();
	for (const task of runningAgentTasks) {
		const match =
			liveNodes.find((node) => node.agentId === canonicalAgentId(task.id)) ??
			liveNodes.find((node) => node.agentType === task.agentType && node.description === task.description);
		if (!match) return new Set(liveNodes.map((node) => node.agentId));
		keepIds.add(match.agentId);
	}
	return keepIds;
}

/** Record an agent-scoped hook for the node addressed by a raw or canonical id. */
export function touchLiveSubagent(activity: Map<string, number>, agentId: string, now: number = Date.now()): void {
	activity.set(canonicalAgentId(agentId), now);
}

/**
 * End running nodes whose last agent-scoped hook (or start, when none was
 * seen) is more than `STALE_RUNNING_SUBAGENT_MS` old.
 */
export function endStaleLiveSubagents(
	target: Map<string, LiveSubagentNode>,
	activity: ReadonlyMap<string, number>,
	now: number = Date.now(),
): LiveSubagentNode[] {
	const endedAt = new Date(now).toISOString();
	const ended: LiveSubagentNode[] = [];
	for (const node of target.values()) {
		if (node.endedAt !== null) continue;
		const lastActivity = activity.get(node.agentId) ?? Date.parse(node.startedAt);
		if (now - lastActivity <= STALE_RUNNING_SUBAGENT_MS) continue;
		const endedNode = {...node, endedAt};
		target.set(node.agentId, endedNode);
		ended.push(endedNode);
	}
	return ended;
}

/** Remove ended nodes after the five-minute grace period; running nodes stay. */
export function sweepLiveSubagents(target: Map<string, LiveSubagentNode>, now: number = Date.now()): void {
	const cutoff = now - ENDED_SUBAGENT_TTL_MS;
	for (const [agentId, node] of target) {
		if (node.endedAt !== null && new Date(node.endedAt).getTime() < cutoff) {
			target.delete(agentId);
		}
	}
}

export function getLiveSubagentNodes(): LiveSubagentNode[] {
	return [...getStore().values()];
}

export function clearLiveSubagents(): void {
	getStore().clear();
	getActivity().clear();
}

export function addLiveSubagent(input: {
	parentSessionId: string;
	agentId: string;
	agentType: string;
	description: string;
}): LiveSubagentNode | null {
	return recordLiveSubagentStart(getStore(), input);
}

export function endLiveSubagent(agentSessionId: string): LiveSubagentNode | null {
	return recordLiveSubagentStop(getStore(), agentSessionId);
}

export function reconcileStoredLiveSubagents(
	sessionId: string,
	backgroundTasks: readonly HookBackgroundTaskPayload[] = [],
): LiveSubagentNode[] {
	const store = getStore();
	const keepIds = runningBackgroundAgentIds(store, sessionId, backgroundTasks);
	return reconcileLiveSubagents(store, sessionId, Date.now(), keepIds);
}

export function touchStoredLiveSubagent(agentId: string): void {
	touchLiveSubagent(getActivity(), agentId);
}

function sweepStoredLiveSubagents(onStaleEnded: (node: LiveSubagentNode) => void): void {
	const store = getStore();
	const activity = getActivity();
	for (const node of endStaleLiveSubagents(store, activity)) onStaleEnded(node);
	sweepLiveSubagents(store);
	for (const agentId of activity.keys()) {
		if (!store.has(agentId)) activity.delete(agentId);
	}
}

/** `onStaleEnded` receives each running node the stale sweep ends. */
export function startLiveSubagentSweep(onStaleEnded: (node: LiveSubagentNode) => void): void {
	stopLiveSubagentSweep();
	sweepTimer = setInterval(() => sweepStoredLiveSubagents(onStaleEnded), LIVE_SUBAGENT_SWEEP_INTERVAL_MS);
}

export function stopLiveSubagentSweep(): void {
	if (sweepTimer) clearInterval(sweepTimer);
	sweepTimer = null;
}

/**
 * Merge ephemeral nodes into indexed JSONL rows. Indexed rows overwrite live
 * projections with the same canonical id because they contain richer metadata.
 */
export function mergeLiveSubagents(indexedAgents: Subagent[], liveNodes: LiveSubagentNode[]): Subagent[] {
	const projectId = indexedAgents[0]?.projectId ?? "";
	const merged = new Map<string, Subagent>();

	for (const node of liveNodes) {
		merged.set(node.agentId, {
			id: node.agentId,
			sessionId: node.sessionId,
			projectId,
			parentAgentId: node.parentAgentId,
			agentType: node.agentType || null,
			attributionAgent: null,
			slug: null,
			description: node.description || null,
			model: null,
			startedAt: node.startedAt,
			finishedAt: node.endedAt,
		});
	}
	for (const agent of indexedAgents) {
		merged.set(canonicalAgentId(agent.id), agent);
	}

	return [...merged.values()];
}
