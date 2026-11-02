/**
 * F6 / ⇧F6 landmark focus cycling, like claude.ai/code's focus_next_region /
 * focus_previous_region. Regions are marked with `data-focus-region` and
 * cycle in upstream's region order (document order within a name); the
 * innermost region holding focus is current. A region focuses its
 * `data-focus-region-entry` descendant when it has one (the composer's
 * prompt), otherwise the region element itself.
 */

export const FOCUS_REGION_ATTR = "data-focus-region";
export const FOCUS_REGION_ENTRY_ATTR = "data-focus-region-entry";

export type FocusRegionDirection = "next" | "previous";

/**
 * Upstream's region vocabulary `ve` in reading order, mapped onto the local
 * regions: `side-chat` is its sidePanel, `session-details` its sessionDetails
 * and `pane` its terminal/tile. `notifications` goes last, as upstream pushes it.
 */
const REGION_ORDER = [
	"navigation",
	"header",
	"main",
	"question",
	"composer",
	"side-chat",
	"session-details",
	"pane",
	"notifications",
];

/** Regions F6 skips unless focus is already inside one, like upstream's `ye`. */
const SKIP_UNLESS_CURRENT = new Set(["question"]);

function regionRank(region: HTMLElement): number
{
	const rank = REGION_ORDER.indexOf(region.getAttribute(FOCUS_REGION_ATTR) ?? "");
	return rank === -1 ? REGION_ORDER.length : rank;
}

/** Whether a region (or any landing target) is shown: not hidden, inert or aria-hidden. */
export function isAvailable(region: HTMLElement): boolean
{
	if (region.closest('[hidden],[inert],[aria-hidden="true"]') !== null) return false;
	return typeof region.checkVisibility === "function" ? region.checkVisibility() : true;
}

const FOCUS_REGION_LANDING_ATTR = "data-focus-region-landing";
const AROUND_ATTR = "data-focus-region-around";
const INSIDE_ATTR = "data-focus-region-inside";
const POSITIONED = new Set(["relative", "absolute", "fixed", "sticky"]);
const MODIFIER_KEYS = new Set([
	"Alt",
	"AltGraph",
	"CapsLock",
	"Control",
	"Fn",
	"FnLock",
	"Hyper",
	"Meta",
	"NumLock",
	"OS",
	"ScrollLock",
	"Shift",
	"Super",
	"Symbol",
	"SymbolLock",
]);

/** The clear function of each document's live landing; a new landing clears the old one first. */
const liveLandings = new WeakMap<Document, () => void>();

type LandOptions =
{
	/** False lands without a landing ring, for stops that draw their own focus-visible ring (upstream's `ring:!1`). */
	ring?: boolean;
	/** The element that draws the ring when it isn't the focused element (the composer card around its prompt). */
	ringOn?: HTMLElement;
	/** Clear on the next non-modifier keydown or beforeinput, for text-entry landings. */
	clearOnInput?: boolean;
};

/**
 * Upstream's focus-region landing `U()`: focus the target (programmatically
 * focusable only for the landing) and mark the ring element
 * `data-focus-region-landing` — `"overlay"` when it is positioned, so the CSS
 * draws the focus shadow as an inset ::after, else `""` for a plain box-shadow.
 * The ring clears when focus moves elsewhere (except into an unrelated dialog),
 * on pointerdown on the ring element, or on input for `clearOnInput` landings.
 */
function landFocus(target: HTMLElement, {ring = true, ringOn = target, clearOnInput = false}: LandOptions = {}): void
{
	const doc = target.ownerDocument;
	const view = doc.defaultView;
	liveLandings.get(doc)?.();

	let addedTabIndex = !target.hasAttribute("tabindex") && target.tabIndex < 0;
	const tabIndexObserver = view === null ? undefined : new view.MutationObserver(() => (addedTabIndex = false));
	if (addedTabIndex)
	{
		target.setAttribute("tabindex", "-1");
		tabIndexObserver?.observe(
			target,
			{
				attributeFilter: ["tabindex"],
			},
		);
	}
	if (ring)
	{
		const position = view?.getComputedStyle(ringOn).position ?? "";
		ringOn.setAttribute(FOCUS_REGION_LANDING_ATTR, POSITIONED.has(position) ? "overlay" : "");
		if (ringOn !== target)
		{
			ringOn.setAttribute(AROUND_ATTR, "");
			target.setAttribute(INSIDE_ATTR, "");
		}
	}
	target.focus(
		{
			preventScroll: true,
			focusVisible: true,
		},
	);

	const onKeyDown = (event: KeyboardEvent) =>
	{
		if (!MODIFIER_KEYS.has(event.key)) clear();
	};
	const onFocusMoved = (next: EventTarget | null) =>
	{
		if (next === target) return;
		const dialog =
			next instanceof Element ? next.closest('[role="dialog"], [role="alertdialog"], [data-cds="Toast"]') : null;
		if (dialog !== null && !dialog.contains(ringOn) && !ringOn.contains(dialog)) return;
		clear();
	};
	const onFocusIn = (event: FocusEvent) =>
	{
		onFocusMoved(event.target);
	};
	const onBlur = () =>
	{
		onFocusMoved(doc.activeElement);
	};
	function clear()
	{
		if (addedTabIndex && (tabIndexObserver?.takeRecords().length ?? 0) === 0) target.removeAttribute("tabindex");
		tabIndexObserver?.disconnect();
		ringOn.removeAttribute(FOCUS_REGION_LANDING_ATTR);
		ringOn.removeAttribute(AROUND_ATTR);
		target.removeAttribute(INSIDE_ATTR);
		doc.removeEventListener("focusin", onFocusIn, true);
		view?.removeEventListener("blur", onBlur);
		ringOn.removeEventListener("pointerdown", clear);
		target.removeEventListener("keydown", onKeyDown);
		target.removeEventListener("beforeinput", clear);
		if (liveLandings.get(doc) === clear) liveLandings.delete(doc);
	}

	if (doc.activeElement !== target)
	{
		clear();
		return;
	}
	doc.addEventListener("focusin", onFocusIn, true);
	view?.addEventListener("blur", onBlur);
	ringOn.addEventListener("pointerdown", clear);
	if (clearOnInput)
	{
		target.addEventListener("keydown", onKeyDown);
		target.addEventListener("beforeinput", clear);
	}
	liveLandings.set(doc, clear);
}

function focusRegion(
	region: HTMLElement,
	{
		ring = true,
	}:
	{
		ring?: boolean;
	} = {},
): void
{
	const entry = [...region.querySelectorAll<HTMLElement>(`[${FOCUS_REGION_ENTRY_ATTR}]`)].find(
		(candidate) => candidate.closest(`[${FOCUS_REGION_ATTR}]`) === region,
	);
	if (entry !== undefined)
	{
		// The composer's ring goes on its card, as upstream rings `[data-cds="ChatComposer"] > *`.
		const card = entry.closest<HTMLElement>("[data-composer-card]");
		landFocus(
			entry,
			{
				ring,
				ringOn: card !== null && region.contains(card) ? card : entry,
				clearOnInput: true,
			},
		);
		return;
	}
	// A button stop (the session title, the collapsed sidebar's Show sidebar) shows its own focus-visible ring.
	landFocus(
		region,
		{
			ring: ring && !region.matches("button"),
		},
	);
}

/**
 * Move focus to the next or previous available region; false when there is none.
 * Like upstream's F6 `er()`/`ze()`: stops go in {@link REGION_ORDER}, `main`
 * drops out when a header stop exists, and a question is only a stop while
 * focus is inside it.
 */
export function cycleFocusRegion(root: Document, direction: FocusRegionDirection): boolean
{
	const available = [...root.querySelectorAll<HTMLElement>(`[${FOCUS_REGION_ATTR}]`)].filter(isAvailable);
	const hasHeader = available.some((region) => region.getAttribute(FOCUS_REGION_ATTR) === "header");
	const active = root.activeElement;
	const current = active?.closest<HTMLElement>(`[${FOCUS_REGION_ATTR}]`) ?? null;
	const regions = available
		.filter((region) =>
		{
			const name = region.getAttribute(FOCUS_REGION_ATTR) ?? "";
			if (name === "main" && hasHeader) return false;
			return region === current || !SKIP_UNLESS_CURRENT.has(name);
		})
		.toSorted((a, b) => regionRank(a) - regionRank(b));
	if (regions.length === 0) return false;
	const index = current === null ? -1 : regions.indexOf(current);
	const step = direction === "next" ? 1 : -1;
	const start = index === -1 ? (direction === "next" ? -1 : regions.length) : index;
	const target = regions[(start + step + regions.length) % regions.length];
	if (target === undefined) return false;
	focusRegion(target);
	return true;
}

/** The landmarks upstream's jump bangs land on: !jn, !jm and !ji. */
export type JumpRegionName = "navigation" | "main" | "composer";

/**
 * Focus the first available region with this name (its entry when it has one); false when there is none.
 * `ring: false` lands without the landing ring, like upstream's `G(name, {asRow: false})` composer focus.
 */
export function focusRegionByName(
	root: Document,
	name: JumpRegionName,
	options:
	{
		ring?: boolean;
	} = {},
): boolean
{
	const region = [...root.querySelectorAll<HTMLElement>(`[${FOCUS_REGION_ATTR}="${name}"]`)].find(isAvailable);
	if (region === undefined) return false;
	focusRegion(region, options);
	return true;
}

const QUESTION_REGION_SELECTOR = `[${FOCUS_REGION_ATTR}="question"]`;
const WAITING_CARD_SELECTOR = "[data-approval-card-root]";

/**
 * Upstream's `ht()`: once keyboard focus is inside a waiting card, watch its
 * container; when the card disconnects (answered, swapped for its receipt)
 * and focus fell to the body, no pointer was used meanwhile, the window is
 * active and no other waiting card remains in the container, focus the
 * composer without a ring, so the next keys go to the prompt. Returns the disarm.
 */
function armAnsweredCardRefocus(card: HTMLElement): () => void
{
	const doc = card.ownerDocument;
	const view = doc.defaultView;
	const container = card.closest<HTMLElement>('[role="article"]') ?? doc.body;
	if (view === null)
		return () =>
		{
		};
	let pointerUsed = false;
	const observer = new view.MutationObserver(() =>
	{
		if (card.isConnected) return;
		disarm();
		const active = doc.activeElement;
		if (
			!pointerUsed &&
			(active === null || active === doc.body) &&
			doc.hasFocus() &&
			container.querySelector(WAITING_CARD_SELECTOR) === null
		)
			focusRegionByName(
				doc,
				"composer",
				{
					ring: false,
				},
			);
	});
	const onPointerDown = () =>
	{
		pointerUsed = true;
	};
	const onClick = () =>
	{
		if (pointerUsed) disarm();
	};
	function disarm()
	{
		observer.disconnect();
		doc.removeEventListener("pointerdown", onPointerDown, true);
		doc.removeEventListener("click", onClick, true);
	}
	observer.observe(
		container,
		{
			childList: true,
			subtree: true,
		},
	);
	doc.addEventListener("pointerdown", onPointerDown, true);
	doc.addEventListener("click", onClick, true);
	return disarm;
}

/**
 * Arm {@link armAnsweredCardRefocus} whenever focus enters a question card
 * by keyboard (F6 / jump landing, Tab, the card's own focus), re-arming per
 * card as upstream's question region does. A focus that a pointerdown caused
 * does not arm. Returns the uninstall.
 */
export function watchAnsweredCards(doc: Document): () => void
{
	let armed:
	{
		card: HTMLElement;
		disarm: () => void;
	} | null = null;
	let pointerPressed = false;
	const onPointerDown = () =>
	{
		pointerPressed = true;
	};
	const onKeyDown = () =>
	{
		pointerPressed = false;
	};
	const onFocusIn = (event: FocusEvent) =>
	{
		const fromPointer = pointerPressed;
		pointerPressed = false;
		const card =
			event.target instanceof Element ? event.target.closest<HTMLElement>(QUESTION_REGION_SELECTOR) : null;
		if (card === null || card === armed?.card || fromPointer) return;
		armed?.disarm();
		armed =
		{
			card,
			disarm: armAnsweredCardRefocus(card),
		};
	};
	doc.addEventListener("pointerdown", onPointerDown, true);
	doc.addEventListener("keydown", onKeyDown, true);
	doc.addEventListener("focusin", onFocusIn, true);
	return () =>
	{
		armed?.disarm();
		doc.removeEventListener("pointerdown", onPointerDown, true);
		doc.removeEventListener("keydown", onKeyDown, true);
		doc.removeEventListener("focusin", onFocusIn, true);
	};
}
