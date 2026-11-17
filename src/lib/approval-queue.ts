import {asRecord} from "./narrow";
import type {PermissionAskEntry} from "./permission-ask";
import {permissionQueue} from "./permission-queue";

/** One pending request a session's approval cluster can draw: upstream's `requestsBySession` entry. */
export interface QueuedApproval
{
	/** The card's key, unique across kinds (`permission:…`, `plan:…`, `question:…`). */
	id: string;
	kind: "tool" | "elicitation" | "question" | "plan" | "hook-question";
	/** The "Also waiting" row's label: the tool name, `use {server}` for an elicitation, or "Question". */
	name: string;
	/** A tool request's input, which names its "Also waiting" row like the transcript's running label. */
	input?: Record<string, unknown>;
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
	const toolAsks = live.filter((ask) => !OWN_CARD_TOOLS.has(ask.toolName));
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
				name: "Question",
				createdAt: askedAt("AskUserQuestion"),
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
