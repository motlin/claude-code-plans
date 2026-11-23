import {findMainToolUses, jsonEqual} from "./approval-dock";
import {asRecord} from "./narrow";
import type {PermissionAskEntry} from "./permission-ask";
import {permissionQueue} from "./permission-queue";

/** One pending request a session's approval cluster can draw: upstream's `requestsBySession` entry. */
export interface QueuedApproval
{
	/** The card's key, unique across kinds (`permission:…`, `plan:…`, `question:…`). */
	id: string;
	kind: "tool" | "elicitation" | "question" | "plan" | "hook-question";
	/** The "Also waiting" row's label: the tool name (a question's is AskUserQuestion), or `use {server}` for an elicitation. */
	name: string;
	/** A tool or question request's input, which names its "Also waiting" row like the transcript's running label. */
	input?: Record<string, unknown>;
	/** The transcript's tool_use id for the call a tool request asks about, when its record is on disk. */
	toolUseId?: string;
	createdAt: number;
	outOfTurn?: boolean;
}

export interface ApprovalQueue
{
	head: QueuedApproval | null;
	queued: QueuedApproval[];
	/** Upstream's `queueDepth`: every other pending request, whatever its kind. */
	queueDepth: number;
}

/**
 * Upstream's `Ls` (pending, oldest first), `Ek` (the head: the first in-turn request, else the first) and `ES` (the
 * rest stay queued behind it, in order).
 */
export function approvalQueue(items: readonly QueuedApproval[]): ApprovalQueue
{
	const pending = items.toSorted((a, b) => a.createdAt - b.createdAt);
	const head = pending.find((item) => item.outOfTurn !== true) ?? pending[0] ?? null;
	return {
		head,
		queued: pending.filter((item) => item !== head),
		queueDepth: Math.max(0, pending.length - 1),
	};
}

/** The shared empty set while fewer than two requests are pending (upstream `jS`). */
export const EMPTY_QUEUED_IDS: ReadonlySet<string> = Object.freeze(new Set<string>());

/** Upstream's `RC`: every queued request's id and tool_use id, so the transcript can drop their lone rows. */
export function queuedRequestIds(queue: ApprovalQueue): ReadonlySet<string>
{
	if (queue.queued.length === 0) return EMPTY_QUEUED_IDS;
	return new Set(
		queue.queued.flatMap((item) => (item.toolUseId === undefined ? [item.id] : [item.id, item.toolUseId])),
	);
}

/**
 * Upstream's `BC`: a call still waiting (running or awaiting approval) whose request is queued behind the head; its
 * lone transcript row gives way to the "Also waiting" list.
 */
export function isQueuedBehindHead(queuedIds: ReadonlySet<string>, toolUseId: string, pending: boolean): boolean
{
	return pending && queuedIds.has(toolUseId);
}

/** Tools whose ask draws its own card (the question or plan card) instead of the permission card. */
const OWN_CARD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** A verdict elicitation, drawn as a permission card: its answer key, server and arrival. */
export interface QueuedElicitation
{
	key: string;
	serverName: string;
	receivedAt: number;
}

function toolInput(input: unknown): Record<string, unknown>
{
	return asRecord(input) ?? {};
}

/**
 * The session's approval queue (upstream `mS`/`ES`), from the cards this page can draw and the CLI's open asks. Only
 * a drawable card can head it: the permission card (the head tool ask's), the oldest verdict elicitation, the plan
 * card, or a question card. Every other request (a parallel tool ask, a later elicitation) waits behind it. A
 * card's age is its ask's arrival; one no ask dates (asked before this server started) sorts first.
 */
export function sessionApprovalQueue({
	asks,
	records,
	permissionKey,
	elicitations,
	planId,
	hookQuestionId,
	transcriptQuestionId,
}: {
	asks: readonly PermissionAskEntry[];
	records: readonly unknown[];
	/** The drawn permission card's answer key, or null when none is drawn (none pending, or answered here). */
	permissionKey: string | null;
	/** The pending verdict elicitations, oldest first. */
	elicitations: readonly QueuedElicitation[];
	planId: string | null;
	hookQuestionId: string | null;
	transcriptQuestionId: string | null;
}): ApprovalQueue
{
	const {head: headAsk, queued: queuedAsks} = permissionQueue(asks, records);
	const live = headAsk === null ? [] : [headAsk, ...queuedAsks];
	const askedAt = (toolName: string) => live.find((ask) => ask.toolName === toolName)?.receivedAt ?? 0;
	const questionAsk = live.find((ask) => ask.toolName === "AskUserQuestion");
	const toolAsks = live.filter((ask) => !OWN_CARD_TOOLS.has(ask.toolName));
	// Each main-thread ask names the first unanswered call it describes that no earlier ask claimed.
	const openCalls = findMainToolUses(records)
		.filter((use) => !use.answered)
		.map((use) => use.call);
	const claimed = new Set<string>();
	const toolUseIdOf = (
		ask: PermissionAskEntry,
	):
	{
		toolUseId?: string;
	} =>
	{
		if (ask.agentId !== null) return {};
		const call = openCalls.find(
			(open) => !claimed.has(open.id) && open.name === ask.toolName && jsonEqual(open.input, ask.toolInput),
		);
		if (call === undefined) return {};
		claimed.add(call.id);
		return {
			toolUseId: call.id,
		};
	};
	const drawable: QueuedApproval[] = [];
	const waiting: QueuedApproval[] = [];
	// The permission card is the head tool ask's dialog; without a drawn card that ask is being answered or not yet shown.
	const [cardAsk, ...otherToolAsks] = toolAsks;
	if (permissionKey !== null)
	{
		drawable.push(
			cardAsk === undefined
				?
					{
						id: `permission:${permissionKey}`,
						kind: "tool",
						name: "Tool",
						createdAt: 0,
					}
				:
					{
						id: `permission:${permissionKey}`,
						kind: "tool",
						name: cardAsk.toolName,
						input: toolInput(cardAsk.toolInput),
						...toolUseIdOf(cardAsk),
						createdAt: cardAsk.receivedAt,
					},
		);
	}
	for (const [index, ask] of otherToolAsks.entries())
	{
		waiting.push(
			{
				id: `ask:${ask.receivedAt}:${index + 1}`,
				kind: "tool",
				name: ask.toolName,
				input: toolInput(ask.toolInput),
				...toolUseIdOf(ask),
				createdAt: ask.receivedAt,
			},
		);
	}
	// Only the oldest verdict elicitation draws its card; the CLI shows one dialog at a time.
	for (const [index, elicitation] of elicitations.entries())
	{
		(index === 0 ? drawable : waiting).push(
			{
				id: `elicitation:${elicitation.key}`,
				kind: "elicitation",
				name: `use ${elicitation.serverName}`,
				createdAt: elicitation.receivedAt,
			},
		);
	}
	if (planId !== null)
	{
		drawable.push(
			{
				id: `plan:${planId}`,
				kind: "plan",
				name: "ExitPlanMode",
				createdAt: askedAt("ExitPlanMode"),
			},
		);
	}
	for (const [id, kind] of [
		[hookQuestionId, "hook-question"],
		[transcriptQuestionId, "question"],
	] as const)
	{
		// The hook's copy and the transcript's record of one question are one request.
		if (id === null || (kind === "question" && id === hookQuestionId)) continue;
		drawable.push(
			{
				id: `question:${id}`,
				kind,
				name: "AskUserQuestion",
				...(questionAsk === undefined
					? {}
					:
						{
							input: toolInput(questionAsk.toolInput),
						}),
				createdAt: questionAsk?.receivedAt ?? 0,
			},
		);
	}
	const {head} = approvalQueue(drawable);
	const all = [...drawable, ...waiting].toSorted((a, b) => a.createdAt - b.createdAt);
	return {
		head,
		queued: all.filter((item) => item !== head),
		queueDepth: Math.max(0, all.length - 1),
	};
}
