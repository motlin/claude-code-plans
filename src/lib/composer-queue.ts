import {useSyncExternalStore} from "react";
import {assertNever} from "./assert-never";

/**
 * Prompts typed while the live pane is working, per session and in memory
 * only. The session page flushes them one at a time as the session goes idle,
 * like claude.ai/code's frontend queue.
 */

export interface QueuedPrompt {
	id: string;
	text: string;
	/** Sent over a skipped question: delivered as soon as no dialog is open, even mid-turn. */
	midTurn?: true;
}

export type ComposerQueueAction =
	| {type: "enqueue"; item: QueuedPrompt; position?: "back" | "front"}
	| {type: "edit"; id: string; text: string}
	| {type: "remove"; id: string}
	| {type: "clear"}
	| {type: "reorder"; id: string; toIndex: number};

export function composerQueueReducer(
	queue: readonly QueuedPrompt[],
	action: ComposerQueueAction,
): readonly QueuedPrompt[] {
	switch (action.type) {
		case "enqueue":
			return action.position === "front" ? [action.item, ...queue] : [...queue, action.item];
		case "edit":
			return queue.map((item) => (item.id === action.id ? {...item, text: action.text} : item));
		case "remove":
			return queue.filter((item) => item.id !== action.id);
		case "clear":
			return [];
		case "reorder": {
			const item = queue.find((candidate) => candidate.id === action.id);
			if (item === undefined) return queue;
			const rest = queue.filter((candidate) => candidate.id !== action.id);
			const index = Math.max(0, Math.min(action.toIndex, rest.length));
			return [...rest.slice(0, index), item, ...rest.slice(index)];
		}
		default:
			return assertNever(action);
	}
}

/**
 * The prompt to send next: the head of the queue, once the session is idle, or
 * a mid-turn head as soon as the pane shows no dialog.
 */
export function nextQueuedPrompt(
	queue: readonly QueuedPrompt[],
	busy: boolean,
	dialogOpen = false,
): QueuedPrompt | null {
	const head = queue[0] ?? null;
	if (head === null) return null;
	return (head.midTurn === true ? dialogOpen : busy) ? null : head;
}

export function queuedStatusText(count: number): string {
	return `${count} ${count === 1 ? "message" : "messages"} queued. Will send after the current response.`;
}

/** Upstream's flattened one-line preview: whitespace collapsed, "…" when nothing is left. */
export function queuedPreview(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat === "" ? "…" : flat;
}

const EMPTY: readonly QueuedPrompt[] = [];

let queues = new Map<string, readonly QueuedPrompt[]>();
const listeners = new Set<() => void>();
let nextId = 1;

export function newQueuedPrompt(text: string, {midTurn = false}: {midTurn?: boolean} = {}): QueuedPrompt {
	const item: QueuedPrompt = {id: `queued-${nextId++}`, text};
	if (midTurn) item.midTurn = true;
	return item;
}

function getComposerQueue(sessionId: string): readonly QueuedPrompt[] {
	return queues.get(sessionId) ?? EMPTY;
}

export function dispatchComposerQueue(sessionId: string, action: ComposerQueueAction): void {
	const next = composerQueueReducer(getComposerQueue(sessionId), action);
	queues = new Map(queues);
	if (next.length === 0) queues.delete(sessionId);
	else queues.set(sessionId, next);
	for (const listener of listeners) listener();
}

/** Sessions whose queued-message band the reader expanded; survives the band unmounting. */
const expandedBands = new Set<string>();

export function queueBandExpanded(sessionId: string): boolean {
	return expandedBands.has(sessionId);
}

export function setQueueBandExpanded(sessionId: string, expanded: boolean): void {
	if (expanded) expandedBands.add(sessionId);
	else expandedBands.delete(sessionId);
}

export function clearComposerQueues(): void {
	queues = new Map();
	expandedBands.clear();
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useComposerQueueItems(sessionId: string): readonly QueuedPrompt[] {
	return useSyncExternalStore(
		subscribe,
		() => getComposerQueue(sessionId),
		() => EMPTY,
	);
}
