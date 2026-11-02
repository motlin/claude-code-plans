/**
 * Upstream's turn-mark outlet (cb6930dae `Qd` outlet members, `pf`, `vf`, `yf`): while a docked approval card or a live
 * plan box holds the transcript tail, the in-flight row that holds the turn mark is carried out of the transcript and
 * drawn in an outlet below the card.
 */

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

	readonly outlet = (): OpenOutlet | null => this.open;
	readonly outletOwner = (): string | undefined => this.outletClaims.at(-1);
	readonly outletUnderPlan = (): boolean => this.underPlan;

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
