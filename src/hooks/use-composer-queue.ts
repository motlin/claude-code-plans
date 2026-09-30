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
	deliver: (text: string) => Promise<DeliveryResult>;
	/** Interrupt the current response (Esc) so a "Send now" prompt goes next. */
	interrupt: () => void;
	retryMs?: number;
}

export interface ComposerQueue {
	items: readonly QueuedPrompt[];
	enqueue: (text: string) => void;
	remove: (id: string) => void;
	/** Move a queued prompt to the head and interrupt the response so it sends next. */
	sendNow: (id: string) => void;
	/** Queue a new prompt at the head and interrupt the response so it sends next. */
	sendNowText: (text: string) => void;
}

/**
 * The per-session composer queue: prompts wait while the session is busy and
 * flush one at a time, each on the next idle. A prompt herdr rejects as not
 * ready returns to the head of the queue and retries.
 */
export function useComposerQueue({
	sessionId,
	busy,
	deliver,
	interrupt,
	retryMs = QUEUE_RETRY_MS,
}: ComposerQueueOptions): ComposerQueue {
	const items = useComposerQueueItems(sessionId);
	const [flushing, setFlushing] = useState(false);
	const [waiting, setWaiting] = useState(false);

	useEffect(() => {
		if (!waiting) return;
		const timer = setTimeout(() => setWaiting(false), retryMs);
		return () => clearTimeout(timer);
	}, [retryMs, waiting]);

	useEffect(() => {
		if (flushing || waiting) return;
		const next = nextQueuedPrompt(items, busy);
		if (next === null) return;
		setFlushing(true);
		dispatchComposerQueue(sessionId, {type: "remove", id: next.id});
		void deliver(next.text).then((result) => {
			setFlushing(false);
			if (result !== "not-ready") return;
			dispatchComposerQueue(sessionId, {type: "enqueue", item: next, position: "front"});
			setWaiting(true);
		});
	}, [busy, deliver, flushing, items, sessionId, waiting]);

	const enqueue = useCallback(
		(text: string) => dispatchComposerQueue(sessionId, {type: "enqueue", item: newQueuedPrompt(text)}),
		[sessionId],
	);
	const remove = useCallback((id: string) => dispatchComposerQueue(sessionId, {type: "remove", id}), [sessionId]);
	const sendNow = useCallback(
		(id: string) => {
			dispatchComposerQueue(sessionId, {type: "reorder", id, toIndex: 0});
			if (busy) interrupt();
		},
		[busy, interrupt, sessionId],
	);
	const sendNowText = useCallback(
		(text: string) => {
			dispatchComposerQueue(sessionId, {
				type: "enqueue",
				item: newQueuedPrompt(text),
				position: "front",
			});
			if (busy) interrupt();
		},
		[busy, interrupt, sessionId],
	);

	return {items, enqueue, remove, sendNow, sendNowText};
}
