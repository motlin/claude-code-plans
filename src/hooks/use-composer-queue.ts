import {useCallback, useEffect, useState} from "react";

import {
	dispatchComposerQueue,
	newQueuedPrompt,
	nextQueuedPrompt,
	type QueuedPrompt,
	useComposerQueueItems,
} from "../lib/composer-queue";

/** How a prompt delivery ended; `not-ready` is herdr's 409 agent_not_ready. */
export type DeliveryResult = "sent" | "not-ready" | "failed";

/** A not-ready delivery goes back to the head of the queue and retries after this delay. */
const QUEUE_RETRY_MS = 1000;

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
	retryMs?: number;
}

export interface ComposerQueue {
	items: readonly QueuedPrompt[];
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
	retryMs = QUEUE_RETRY_MS,
}: ComposerQueueOptions): ComposerQueue {
	const items = useComposerQueueItems(sessionId);
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
			if (result !== "not-ready") return;
			dispatchComposerQueue(sessionId, {type: "enqueue", item: next, position: "front"});
			setWaiting(true);
		});
	}, [busy, deliver, dialogOpen, flushing, items, sessionId, waiting]);

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
		},
		[sessionId],
	);
	const clear = useCallback(() => {
		dispatchComposerQueue(sessionId, {type: "clear"});
	}, [sessionId]);
	const sendNow = useCallback(
		async (id: string) => {
			dispatchComposerQueue(sessionId, {type: "reorder", id, toIndex: 0});
			if (busy) await interrupt();
		},
		[busy, interrupt, sessionId],
	);
	return {items, enqueue, remove, clear, sendNow};
}
