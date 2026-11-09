import {useCallback, useEffect, useRef, useState} from "react";

import {
	dispatchComposerQueue,
	newQueuedPrompt,
	nextQueuedPrompt,
	type QueuedPrompt,
	useComposerQueueItems,
} from "../lib/composer-queue";
import {announce, markLanded} from "../lib/landed-store";

/** How a prompt delivery ended; `not-ready` is herdr's 409 agent_not_ready. */
export type DeliveryResult = "sent" | "not-ready" | "failed";

/** Upstream's toast when a queued message's Send now (`promoteQueued`) fails. */
export const SEND_NOW_FAILED_MESSAGE = "Couldn’t send the message now. It’s still in the queue.";

/** A not-ready delivery goes back to the head of the queue and retries after this delay. */
const QUEUE_RETRY_MS = 1000;

const NO_IDS: ReadonlySet<string> = new Set();

export interface ComposerQueueOptions {
	sessionId: string;
	/** The live pane is working or a sent prompt has not reached the transcript yet. */
	busy: boolean;
	/** The pane shows a question or permission dialog, which holds even a mid-turn prompt. */
	dialogOpen?: boolean;
	/** Delivers a queued prompt; a mid-turn one (sent over a skipped question) says so. */
	deliver: (text: string, options?: {midTurn: true}) => Promise<DeliveryResult>;
	/** Interrupt the current response (Esc) so a "Send now" prompt goes next; settles with the request. */
	interrupt: () => Promise<void>;
	/** The Send now interrupt rejected; the prompt stays queued (upstream toasts {@link SEND_NOW_FAILED_MESSAGE}). */
	onSendNowFailed?: () => void;
	retryMs?: number;
}

export interface ComposerQueue {
	items: readonly QueuedPrompt[];
	/** Prompts whose Send now was accepted and that are still queued: upstream's ✓ "Sent" rows. */
	acceptedIds: ReadonlySet<string>;
	/** Queue at the back, or a mid-turn prompt at the head to go as soon as no dialog is open. */
	enqueue: (text: string, options?: {midTurn: true}) => void;
	remove: (id: string) => void;
	/** Upstream's "Clear all": drop every queued prompt at once. */
	clear: () => void;
	/** Move a queued prompt to the head and interrupt the response so it sends next; settles with the interrupt. */
	sendNow: (id: string) => Promise<void>;
}

/**
 * The per-session composer queue: prompts wait while the session is busy and
 * flush one at a time, each on the next idle. A prompt herdr rejects as not
 * ready returns to the head of the queue and retries.
 */
export function useComposerQueue({
	sessionId,
	busy,
	dialogOpen = false,
	deliver,
	interrupt,
	onSendNowFailed,
	retryMs = QUEUE_RETRY_MS,
}: ComposerQueueOptions): ComposerQueue {
	const items = useComposerQueueItems(sessionId);
	const itemsRef = useRef(items);
	useEffect(() => {
		itemsRef.current = items;
	}, [items]);
	// Prompts Send now promoted mid-turn: each flashes as "landed" once it is delivered.
	const promotedRef = useRef(new Set<string>());
	const [acceptedIds, setAcceptedIds] = useState<ReadonlySet<string>>(NO_IDS);
	const dropAccepted = useCallback((id: string | null) => {
		setAcceptedIds((current) => {
			if (id === null) return current.size === 0 ? current : NO_IDS;
			if (!current.has(id)) return current;
			const next = new Set(current);
			next.delete(id);
			return next;
		});
	}, []);
	const [flushing, setFlushing] = useState(false);
	const [waiting, setWaiting] = useState(false);

	useEffect(() => {
		if (!waiting) return undefined;
		const timer = setTimeout(() => {
			setWaiting(false);
		}, retryMs);
		return () => {
			clearTimeout(timer);
		};
	}, [retryMs, waiting]);

	useEffect(() => {
		if (flushing || waiting) return;
		const next = nextQueuedPrompt(items, busy, dialogOpen);
		if (next === null) return;
		setFlushing(true);
		dispatchComposerQueue(sessionId, {type: "remove", id: next.id});
		const delivery = next.midTurn === true ? deliver(next.text, {midTurn: true}) : deliver(next.text);
		void delivery.then((result) => {
			setFlushing(false);
			if (result !== "not-ready") dropAccepted(next.id);
			if (result !== "not-ready" && promotedRef.current.delete(next.id) && result === "sent") {
				markLanded(next.text);
				announce(sessionId, "read");
			}
			if (result !== "not-ready") return;
			dispatchComposerQueue(sessionId, {type: "enqueue", item: next, position: "front"});
			setWaiting(true);
		});
	}, [busy, deliver, dialogOpen, dropAccepted, flushing, items, sessionId, waiting]);

	const enqueue = useCallback(
		(text: string, options?: {midTurn: true}) => {
			dispatchComposerQueue(
				sessionId,
				options?.midTurn === true
					? {type: "enqueue", item: newQueuedPrompt(text, {midTurn: true}), position: "front"}
					: {type: "enqueue", item: newQueuedPrompt(text)},
			);
		},
		[sessionId],
	);
	const remove = useCallback(
		(id: string) => {
			dispatchComposerQueue(sessionId, {type: "remove", id});
			dropAccepted(id);
		},
		[dropAccepted, sessionId],
	);
	const clear = useCallback(() => {
		dispatchComposerQueue(sessionId, {type: "clear"});
		dropAccepted(null);
	}, [dropAccepted, sessionId]);
	// Upstream `markAccepted`: the row shows ✓ Sent and the session announces "Sent".
	const accept = useCallback(
		(id: string) => {
			announce(sessionId, "sent");
			// The pane may have gone idle and delivered it before the interrupt request settled.
			if (!itemsRef.current.some((item) => item.id === id)) return;
			setAcceptedIds((current) => new Set(current).add(id));
		},
		[sessionId],
	);
	const sendNow = useCallback(
		async (id: string) => {
			const previousIndex = items.findIndex((item) => item.id === id);
			dispatchComposerQueue(sessionId, {type: "reorder", id, toIndex: 0});
			// An idle Send now starts a new turn, which upstream never flashes as read mid-turn.
			if (!busy) {
				accept(id);
				return;
			}
			promotedRef.current.add(id);
			try {
				await interrupt();
				accept(id);
			} catch {
				// Upstream clears pending and reorders only on success, so undo both.
				promotedRef.current.delete(id);
				if (previousIndex >= 0) dispatchComposerQueue(sessionId, {type: "reorder", id, toIndex: previousIndex});
				onSendNowFailed?.();
			}
		},
		[accept, busy, interrupt, items, onSendNowFailed, sessionId],
	);
	return {items, acceptedIds, enqueue, remove, clear, sendNow};
}
