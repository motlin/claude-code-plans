/**
 * Upstream's turn-mark outlet (cb6930dae `Qd` outlet members, `pf`, `vf`, `yf`): while a docked approval card or a live
 * plan box holds the transcript tail, the in-flight row that holds the turn mark is carried out of the transcript and
 * drawn in an outlet below the card.
 */

import type {PermissionWait, WorkingMarkerState} from "./working-marker";

/** Upstream `_f`: how long a close waits (at most) before listeners hear of it. */
export const OUTLET_LATE_NOTICE_MS = 250;
/** Upstream `Yd`: a reopen this soon after a close counts toward the loop streak. */
export const REOPEN_WINDOW_MS = 50;
/** Upstream `Zd`: the streak resets after this long. */
export const REOPEN_STREAK_MS = 5000;
/** Upstream `Xd`: reopens in one streak that count as a render loop. */
export const REOPEN_LOOP_COUNT = 30;

const REOPEN_LOOP_MESSAGE =
	"Claude Code transcript: turn-mark outlet removed and re-added 30 times in 5 s (likely a render loop; nothing fell back)";

export type MarkedRowSlot = "card" | "plan" | false;

/**
 * Upstream `Vt` (`busyLineBelowTailSlot && isResponding`): a shown card holds the transcript tail only while the turn
 * responds. A turn parked on the card ("waiting") is not responding, so its row stays above the card.
 */
export function cardHoldsTranscriptTail({
	cardShown,
	status,
}: {
	cardShown: boolean;
	status: WorkingMarkerState["status"];
}): boolean
{
	return cardShown && status !== "idle" && status !== "waiting";
}

/** Upstream `pf`: where the marked row goes while something holds the transcript tail. */
export function markedRowBelowTailSlot({
	cardHoldsTail,
	planHoldsLoader,
	heldRedialReported,
}: {
	cardHoldsTail: boolean;
	planHoldsLoader: boolean;
	heldRedialReported: boolean;
}): MarkedRowSlot
{
	if (cardHoldsTail) return planHoldsLoader ? false : "card";
	return planHoldsLoader && !heldRedialReported ? "plan" : false;
}

/** Upstream `vf`: run `tell` on the next frame or after 250ms, whichever comes first; returns a canceller. */
function lateNotice(el: Element, tell: () => void): () => void
{
	const win = el.ownerDocument.defaultView ?? window;
	let done = false;
	let frame = 0;
	const cancel = () =>
	{
		done = true;
		if (typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(frame);
		win.clearTimeout(timer);
	};
	const fire = () =>
	{
		if (done) return;
		cancel();
		tell();
	};
	const timer = win.setTimeout(fire, OUTLET_LATE_NOTICE_MS);
	if (typeof win.requestAnimationFrame === "function") frame = win.requestAnimationFrame(fire);
	return cancel;
}

type MoveBeforeParent = Node &
{
	moveBefore?: (node: Node, child: Node | null) => void;
};

/**
 * Upstream `yf`: move `node` to the end of `parent`, with `moveBefore` when available (keeps focus, animations and
 * iframes), else `appendChild` plus a focus restore when focus fell to the body.
 */
export function moveInto(node: Node, parent: Node): void
{
	if (node.parentNode === parent) return;
	const doc = node.ownerDocument ?? document;
	const focused = doc.activeElement;
	const hadFocus = focused !== null && node.contains(focused);
	const moveBefore = (parent as MoveBeforeParent).moveBefore;
	if (moveBefore && node.isConnected && parent.isConnected)
	{
		try
		{
			moveBefore.call(parent, node, null);
			return;
		}
		catch
		{
			// Fall back to appendChild below.
		}
	}
	parent.appendChild(node);
	if (hadFocus && focused instanceof HTMLElement)
	{
		queueMicrotask(() =>
		{
			const now = doc.activeElement;
			if ((now === null || now === doc.body) && node.contains(focused))
				focused.focus(
					{
						preventScroll: true,
					},
				);
		});
	}
}

export interface OpenOutlet
{
	el: HTMLElement;
}

/** Upstream `tf`: a row holds the mark while in flight, unless the line yields; a held claim outlasts the live turn. */
export function markClaimHolds({
	hasStore,
	inFlight,
	yields,
	heldBefore,
	turnLive,
}: Readonly<
{
	hasStore: boolean;
	inFlight: boolean;
	yields: boolean;
	heldBefore: boolean;
	turnLive: boolean;
}>): boolean
{
	return hasStore && inFlight && !yields && (heldBefore || turnLive);
}

/** The call whose words a row hands to the line: its clock starts at `startedAt` (ms). */
export interface SaidCall
{
	id: string;
	startedAt: number | null;
}

/** Upstream's `words`/`wordsUnspoken`/`wordsCall`/`callWordsEndedAt`: what the line shows while it holds the mark. */
export interface MarkWords
{
	words: string | undefined;
	unspoken: boolean;
	call: SaidCall | undefined;
	callWordsEndedAt: number | undefined;
}

interface Said
{
	words: string;
	unspoken: boolean;
	call: SaidCall | undefined;
}

/** Upstream's `noteWaiting` keeps the last 31 waits plus the new one. */
const MAX_WAITS = 32;

/** Upstream `Qd`'s outlet members: one per session. */
export class TurnMarkOutletStore
{
	private open: OpenOutlet | null = null;
	private readonly carried = new Map<Element, () => Element | null>();
	private readonly outletListeners = new Set<() => void>();
	private lastCloseAt = 0;
	private reopenStreak = 0;
	private reopenStreakFrom = 0;
	private reopenLoopReported = false;
	private cancelLateOutletNotice: (() => void) | null = null;
	private outletClaims: string[] = [];
	private underPlan = false;
	private readonly holders = new Set<string>();
	private readonly yielders = new Set<string>();
	private readonly said = new Map<string, Said>();
	private readonly markListeners = new Set<() => void>();
	private shownWords: MarkWords =
	{
		words: undefined,
		unspoken: false,
		call: undefined,
		callWordsEndedAt: undefined,
	};
	private waitList: readonly PermissionWait[] = [];

	readonly outlet = (): OpenOutlet | null => this.open;
	readonly outletOwner = (): string | undefined => this.outletClaims.at(-1);
	readonly outletUnderPlan = (): boolean => this.underPlan;
	/** Upstream `held`: whether any row holds the turn mark. */
	readonly held = (): boolean => this.holders.size > 0;
	/** Upstream `yields`: whether the working line has taken the mark, so no row may claim it. */
	readonly yields = (): boolean => this.yielders.size > 0;
	readonly markWords = (): MarkWords => this.shownWords;
	readonly waits = (): readonly PermissionWait[] => this.waitList;

	readonly subscribeMark = (listener: () => void): (() => void) =>
	{
		this.markListeners.add(listener);
		return () =>
		{
			this.markListeners.delete(listener);
		};
	};

	private tellMarkListeners(): void
	{
		for (const listener of this.markListeners) listener();
	}

	private enter(set: Set<string>, id: string): () => void
	{
		const was = set.size > 0;
		set.add(id);
		if (!was) this.tellMarkListeners();
		return () =>
		{
			if (set.delete(id) && set.size === 0) this.tellMarkListeners();
		};
	}

	/** Upstream `hold`: register a row that holds the mark. */
	hold(id: string): () => void
	{
		return this.enter(this.holders, id);
	}

	/** Upstream `yieldFor`: the working line takes the mark; rows lose it and say their words instead. */
	yieldFor(id: string): () => void
	{
		return this.enter(this.yielders, id);
	}

	/** Upstream `showNewestSaid`. */
	private showNewestSaid(): void
	{
		const newest = [...this.said.values()].at(-1);
		const callWordsEndedAt =
			newest === undefined && this.shownWords.call !== undefined ? Date.now() : this.shownWords.callWordsEndedAt;
		this.shownWords =
		{
			words: newest?.words,
			unspoken: newest?.unspoken ?? false,
			call: newest?.call,
			callWordsEndedAt,
		};
		this.tellMarkListeners();
	}

	/** Upstream `say`: a row that cannot hold the mark hands its running words to the line; the newest sayer shows. */
	say(id: string, words: string, unspoken: boolean, call: SaidCall | undefined): () => void
	{
		this.said.delete(id);
		this.said.set(
			id,
			{
				words,
				unspoken,
				call,
			},
		);
		this.showNewestSaid();
		return () =>
		{
			this.said.delete(id);
			this.showNewestSaid();
		};
	}

	/** Upstream `noteWaiting`: open a permission wait at `min(start, now)`, or close the open one now. */
	noteWaiting(waiting: boolean, start?: number): void
	{
		const last = this.waitList.at(-1);
		const open = last?.to === null;
		if (waiting && !open)
		{
			const now = Date.now();
			this.waitList = [
				...this.waitList.slice(-(MAX_WAITS - 1)),
				{
					from: Math.min(start ?? now, now),
					to: null,
				},
			];
		}
		else if (!waiting && open)
		{
			this.waitList = [
				...this.waitList.slice(0, -1),
				{
					from: last.from,
					to: Date.now(),
				},
			];
			this.tellMarkListeners();
		}
	}

	/** Upstream `forgetSession`: drop the waits and the post-call clock hold. */
	forgetSession(): void
	{
		this.waitList = [];
		this.shownWords =
		{
			...this.shownWords,
			callWordsEndedAt: undefined,
		};
		this.tellMarkListeners();
	}

	readonly subscribeOutlet = (listener: () => void): (() => void) =>
	{
		this.outletListeners.add(listener);
		return () =>
		{
			this.outletListeners.delete(listener);
		};
	};

	readonly carry = (box: Element, getHome: () => Element | null): (() => void) =>
	{
		this.carried.set(box, getHome);
		return () =>
		{
			this.carried.delete(box);
		};
	};

	private readonly tellOutletListeners = (): void =>
	{
		this.cancelLateOutletNotice?.();
		this.cancelLateOutletNotice = null;
		for (const listener of this.outletListeners) listener();
	};

	private tellOutletListenersUnlessClosing(): void
	{
		if (this.cancelLateOutletNotice === null) this.tellOutletListeners();
	}

	private countReopen(): void
	{
		if (this.reopenLoopReported) return;
		const now = Date.now();
		if (this.lastCloseAt === 0 || now - this.lastCloseAt > REOPEN_WINDOW_MS)
		{
			this.reopenStreak = 0;
			return;
		}
		if (this.reopenStreak === 0 || now - this.reopenStreakFrom > REOPEN_STREAK_MS)
		{
			this.reopenStreak = 0;
			this.reopenStreakFrom = now;
		}
		this.reopenStreak += 1;
		if (this.reopenStreak >= REOPEN_LOOP_COUNT)
		{
			this.reopenLoopReported = true;
			console.warn(REOPEN_LOOP_MESSAGE);
		}
	}

	private sendCarriedRowsHome(): void
	{
		for (const [box, getHome] of this.carried)
		{
			const home = getHome();
			if (box.parentNode === this.open?.el && home !== null) moveInto(box, home);
		}
	}

	openOutlet(el: HTMLElement): void
	{
		if (el === this.open?.el) return;
		this.countReopen();
		this.sendCarriedRowsHome();
		this.open =
		{
			el,
		};
		this.tellOutletListeners();
	}

	closeOutlet(el: HTMLElement): void
	{
		if (el !== this.open?.el) return;
		this.sendCarriedRowsHome();
		this.open = null;
		this.lastCloseAt = Date.now();
		this.cancelLateOutletNotice ??= lateNotice(el, this.tellOutletListeners);
	}

	cancelPendingClose(): void
	{
		this.cancelLateOutletNotice?.();
		this.cancelLateOutletNotice = null;
	}

	claimOutlet(id: string): () => void
	{
		this.outletClaims.push(id);
		this.tellOutletListenersUnlessClosing();
		return () =>
		{
			this.outletClaims = this.outletClaims.filter((claim) => claim !== id);
			this.tellOutletListenersUnlessClosing();
		};
	}

	setOutletUnderPlan(underPlan: boolean): void
	{
		if (underPlan === this.underPlan) return;
		this.underPlan = underPlan;
		this.tellOutletListenersUnlessClosing();
	}
}
