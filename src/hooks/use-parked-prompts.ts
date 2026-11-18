import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from "react";

import
{
	dispatchComposerQueue,
	getComposerQueue,
	parkedPrompts,
	type QueuedPrompt,
	useComposerQueueItems,
} from "../lib/composer-queue";
import
{
	PARK_FIRE_SPACING_MS,
	autoSendPlan,
	beginRun,
	parkDecision,
	type ParkDecision,
	parkJitterMs,
	parkPromisedAt,
	type ParkInitiator,
	type ParkRunOutcome,
	type ParkVerdict,
	type ParkWindow,
	settleRun,
	stopForfeits,
	windowFor,
} from "../lib/parked-prompts";
import {limitReached, type UsageSummary} from "../lib/usage";
import type {DeliveryResult} from "./use-composer-queue";

/** Upstream's wake-aware timer (`xr`) never sleeps longer than this, so a sleep or suspend rechecks the deadline. */
const MAX_TIMER_MS = 30_000;

// Upstream's module ledger (`UA`): one window per session, outliving the page that parked.
let windows = new Map<string, ParkWindow>();
/** Sessions whose verdict was ever exceeded (upstream's `sawExceeded` latch). */
const sawExceeded = new Set<string>();
/** Upstream `Dr`: the cross-session fire slot. */
let nextFreeAt = 0;
let ledgerVersion = 0;
const listeners = new Set<() => void>();

function storeWindow(sessionId: string, window: ParkWindow): void
{
	if (windows.get(sessionId) === window) return;
	windows = new Map(windows).set(sessionId, window);
	ledgerVersion += 1;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getLedgerVersion(): number
{
	return ledgerVersion;
}

/** Test seam: forget every window, the exceeded latches and the fire slot. */
export function resetParkedPrompts(): void
{
	windows = new Map();
	sawExceeded.clear();
	nextFreeAt = 0;
	ledgerVersion += 1;
	for (const listener of listeners) listener();
}

function verdictOf(
	usage: UsageSummary | undefined,
	nowMs: number,
):
{
	verdict: ParkVerdict;
	resetsAt?: number;
}
{
	if (usage === undefined)
		return {
			verdict: "unknown",
		};
	const limit = limitReached(usage, nowMs);
	return limit === null
		?
			{
				verdict: "clear",
			}
		:
			{
				verdict: "exceeded",
				resetsAt: limit.resetsAt,
			};
}

export interface ParkedPromptsOptions
{
	sessionId: string;
	/** The statusline's usage; the verdict is read against `Date.now()`, never the fetch time. */
	usage: UsageSummary | undefined;
	/** A turn is running or a sent prompt has not landed (upstream's turn is not `idle`). */
	busy: boolean;
	/** The pane shows a dialog (upstream `autoSendBlocked`). */
	blocked: boolean;
	archived: boolean;
	/** When the user last stopped the response; a new value is upstream's `turn === "stopping"`. */
	interruptedAt: number | null;
	deliver: (text: string) => Promise<DeliveryResult>;
	/** Upstream's `setJitterMs` seam. */
	jitter?: () => number;
}

export interface ParkedPrompts
{
	items: readonly QueuedPrompt[];
	willAutoSend: boolean;
	/** The window's reset (epoch seconds), unless the usage reads clear. */
	windowResetsAt: number | undefined;
	/** A flush is running (upstream `flushBusy`). */
	flushing: boolean;
	/** Upstream `U_`: why a send would park right now (read at call time), or false. */
	decision: () => ParkDecision;
	/** Parks the prompt when upstream would (`p2`); false means send it normally. */
	park: (text: string) => boolean;
	/** Upstream's Send anyway: flush now as the user, past the budget and the floor. */
	sendAnyway: () => void;
}

interface FlushRun
{
	initiator: ParkInitiator;
	dispatched: boolean;
	inFlight: boolean;
}

let nextParkedId = 1;

/**
 * claude.ai/code's parked lane (`aj` scheduler + `y2` flush) over the composer queue: a prompt sent to
 * an idle session while the limit is spent parks instead of sending, and the held prompts auto-send
 * once the window resets (+90 s floor, 2–8 s jitter, 30 min late window, ≤3 machine runs 45 s apart,
 * 12 s apart across sessions), one per idle, until they drain, a send fails or the limit is hit again.
 */
export function useParkedPrompts({
	sessionId,
	usage,
	busy,
	blocked,
	archived,
	interruptedAt,
	deliver,
	jitter = parkJitterMs,
}: ParkedPromptsOptions): ParkedPrompts
{
	const queue = useComposerQueueItems(sessionId);
	const items = parkedPrompts(queue);
	useSyncExternalStore(subscribe, getLedgerVersion, getLedgerVersion);
	const [tick, setTick] = useState(0);
	const bump = useCallback(() =>
	{
		setTick((value) => value + 1);
	}, []);
	const [flushing, setFlushing] = useState(false);
	const flushRef = useRef<FlushRun | null>(null);
	const latest = useRef(
		{
			usage,
			archived,
			items,
			deliver,
			jitter,
		},
	);
	useEffect(() =>
	{
		latest.current =
		{
			usage,
			archived,
			items,
			deliver,
			jitter,
		};
	});

	const now = Date.now();
	const {verdict, resetsAt} = verdictOf(usage, now);
	if (verdict === "exceeded") sawExceeded.add(sessionId);
	const stored = windows.get(sessionId);
	// Upstream's read-only `$A(..., false)`: a window not yet in the ledger plans with no jitter.
	const planWindow = resetsAt === undefined ? stored : windowFor(stored, resetsAt, 0);
	const planContext =
	{
		verdict,
		sawExceeded: sawExceeded.has(sessionId),
		held: items.map((item) => item.parked ?? {}),
		archived,
		blocked,
	};
	const plan =
		items.length === 0 || planWindow === undefined
			? null
			: autoSendPlan(
					planWindow,
					{
						...planContext,
						nowMs: now,
					},
				);
	const windowResetsAt =
		plan !== null && planWindow !== undefined
			? planWindow.resetsAt
			: verdict === "clear" || items.length === 0
				? undefined
				: planWindow?.resetsAt;

	/** Upstream's live `$A(..., true)`: the ledger window for the current verdict, created with jitter. */
	const liveWindow = useCallback(
		(nowMs: number): ParkWindow | undefined =>
		{
			const current = verdictOf(latest.current.usage, nowMs);
			const prev = windows.get(sessionId);
			if (current.resetsAt === undefined) return prev;
			const next = windowFor(prev, current.resetsAt, latest.current.jitter());
			storeWindow(sessionId, next);
			return next;
		},
		[sessionId],
	);

	const finish = useCallback(
		(outcome: ParkRunOutcome) =>
		{
			const run = flushRef.current;
			if (run === null) return;
			flushRef.current = null;
			setFlushing(false);
			const window = windows.get(sessionId);
			if (window !== undefined) storeWindow(sessionId, settleRun(window, run.initiator, outcome, Date.now()));
		},
		[sessionId],
	);

	const startFlush = useCallback(
		(initiator: ParkInitiator) =>
		{
			if (flushRef.current !== null) return;
			const nowMs = Date.now();
			const window = liveWindow(nowMs);
			if (window !== undefined) storeWindow(sessionId, beginRun(window, initiator, nowMs));
			flushRef.current =
			{
				initiator,
				dispatched: false,
				inFlight: false,
			};
			setFlushing(true);
		},
		[liveWindow, sessionId],
	);

	// The flush (upstream `y2`): one held prompt per idle, head first.
	useEffect(() =>
	{
		const run = flushRef.current;
		if (!flushing || run === null || run.inFlight) return;
		const head = items[0];
		if (head === undefined)
		{
			finish("drained");
			return;
		}
		if (archived)
		{
			finish(run.dispatched ? "halted" : "untouched");
			return;
		}
		if (busy)
		{
			// A machine run never sends over a turn it didn't start.
			if (run.initiator === "machine" && !run.dispatched) finish("untouched");
			return;
		}
		if (run.dispatched && limitReached(latest.current.usage ?? emptyUsage, Date.now()) !== null)
		{
			finish("halted");
			return;
		}
		run.inFlight = true;
		dispatchComposerQueue(
			sessionId,
			{
				type: "remove",
				id: head.id,
			},
		);
		void latest.current.deliver(head.text).then((result) =>
		{
			run.inFlight = false;
			if (result === "sent")
			{
				run.dispatched = true;
				if (parkedPrompts(getComposerQueue(sessionId)).length === 0) finish("drained");
				else bump();
				return;
			}
			dispatchComposerQueue(
				sessionId,
				{
					type: "enqueue",
					item: head,
					position: "front",
				},
			);
			// herdr's not-ready is upstream's pending turn: nothing was sent, so the window only waits 45 s.
			finish(result === "not-ready" && !run.dispatched ? "untouched" : "halted");
		});
	}, [archived, bump, busy, finish, flushing, items, sessionId, tick]);

	// A Stop: the auto-sent turn's flush ends as stopped, else upstream `nj` may forfeit the window.
	const seenInterrupt = useRef(interruptedAt);
	useEffect(() =>
	{
		if (interruptedAt === seenInterrupt.current) return;
		seenInterrupt.current = interruptedAt;
		if (interruptedAt === null) return;
		if (flushRef.current !== null)
		{
			finish("stopped");
			return;
		}
		const window = windows.get(sessionId);
		if (window === undefined || latest.current.items.length === 0) return;
		const nowMs = Date.now();
		const promised = parkPromisedAt(window, verdictOf(latest.current.usage, nowMs).verdict, nowMs);
		if (
			stopForfeits(
				window,
				{
					nowMs,
					promisedAt: promised,
				},
			)
		)
		{
			storeWindow(
				sessionId,
				{
					...window,
					forfeit: true,
					clearOk: false,
				},
			);
		}
	}, [finish, interruptedAt, sessionId]);

	// The scheduler (upstream `aj`): wake every ≤30 s until due, then claim the cross-session slot and fire.
	const due = plan?.dueAt ?? null;
	useEffect(() =>
	{
		if (due === null || flushing || busy) return undefined;
		const nowMs = Date.now();
		const window = liveWindow(nowMs);
		if (window === undefined) return undefined;
		const live = autoSendPlan(
			window,
			{
				...planContext,
				nowMs,
			},
		);
		if (live === null) return undefined;
		const wait = live.dueAt > nowMs ? Math.min(live.dueAt - nowMs, MAX_TIMER_MS) : Math.max(0, nextFreeAt - nowMs);
		if (wait > 0)
		{
			const timer = setTimeout(bump, wait);
			const onVisible = () =>
			{
				if (document.visibilityState === "visible") bump();
			};
			document.addEventListener("visibilitychange", onVisible);
			return () =>
			{
				clearTimeout(timer);
				document.removeEventListener("visibilitychange", onVisible);
			};
		}
		nextFreeAt = nowMs + PARK_FIRE_SPACING_MS;
		startFlush("machine");
		return undefined;
		// planContext is rebuilt every render; its inputs are the deps below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [archived, blocked, bump, busy, due, flushing, items, liveWindow, startFlush, tick, verdict]);

	const decision = useCallback(() =>
	{
		const nowMs = Date.now();
		return parkDecision(
			{
				limit: latest.current.usage === undefined ? null : limitReached(latest.current.usage, nowMs),
				heldCount: latest.current.items.length,
				flushing: flushRef.current !== null,
				archived: latest.current.archived,
				nowMs,
			},
		);
	}, []);

	const park = useCallback(
		(text: string) =>
		{
			if (decision() === false) return false;
			const nowMs = Date.now();
			const limit = latest.current.usage === undefined ? null : limitReached(latest.current.usage, nowMs);
			const held = latest.current.items;
			if (limit !== null) sawExceeded.add(sessionId);
			const window = liveWindow(nowMs);
			// Upstream: a new entry inherits the previous entry's window, else the ledger's (`QA`).
			const parkedForResetsAt = held.at(-1)?.parked?.parkedForResetsAt ?? window?.resetsAt;
			dispatchComposerQueue(
				sessionId,
				{
					type: "enqueue",
					item:
					{
						id: `parked-${nextParkedId++}`,
						text,
						parked:
						{
							parkedAtMs: nowMs,
							...(parkedForResetsAt === undefined
								? {}
								:
									{
										parkedForResetsAt,
									}),
						},
					},
				},
			);
			return true;
		},
		[decision, liveWindow, sessionId],
	);

	const sendAnyway = useCallback(() =>
	{
		startFlush("user");
	}, [startFlush]);

	return {
		items,
		willAutoSend: plan !== null,
		windowResetsAt,
		flushing,
		decision,
		park,
		sendAnyway,
	};
}

const emptyUsage: UsageSummary =
{
	fiveHour: null,
	sevenDay: null,
	updatedAt: "",
	scoped: null,
};
