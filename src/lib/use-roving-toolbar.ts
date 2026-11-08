import {type FocusEvent, type KeyboardEvent, useCallback, useRef} from "react";

/**
 * The roving options upstream keeps per toolbar root (`Bj` in claude.ai/code's shared-frame chunk). Only the cds
 * `Toolbar` registers any (all of them, {@link TOOLBAR_ROVING_OPTIONS}); every other roving bar, the message actions
 * bars among them, reads upstream's empty default (`hn = {}`), so every option is off there.
 */
export type RovingToolbarOptions = {
	/** A ResizeObserver moves a stop that became invisible to the next visible item. */
	watchHidden?: boolean;
	/** Soft-disabled switches/checkboxes (`[data-disabled]`) and inert-wrapped items leave the item set. */
	softDisabled?: boolean;
	/** Re-elect on focusin and rove even when a descendant stops an arrow key's propagation. */
	portaledItems?: boolean;
	/** The first item holds the stop until something in the toolbar is focused. */
	firstUntilFocused?: boolean;
	/** A focused text field stands in for the stop it replaced (a rename input), so the stop returns beside it. */
	standInFields?: boolean;
	/** Losing the focused item parks focus on the toolbar root (tabindex 0, every item -1) until blur or pointerdown. */
	restOnLoss?: boolean;
	/**
	 * Drop role and label while the toolbar has never held a focusable descendant (a ghost header), remembering the
	 * label; once one arrives (or a stop is elected) both come back for good.
	 */
	plainWhileEmpty?: boolean;
};

/** Upstream's `tu`: the options the cds `Toolbar` registers for its root. */
export const TOOLBAR_ROVING_OPTIONS = {
	watchHidden: true,
	softDisabled: true,
	portaledItems: true,
	firstUntilFocused: true,
	standInFields: true,
	restOnLoss: true,
	plainWhileEmpty: true,
} as const satisfies Required<RovingToolbarOptions>;

/** Upstream `Uw`: what counts as focusable for plainWhileEmpty (wider than the roving items: fields count). */
export const TOOLBAR_FOCUSABLE_SELECTOR =
	'button, a[href], summary, input:not([type="hidden"]), select, textarea, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role^="menuitem"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"], [role="slider"]';
/** Upstream `qD`: the extra attributes a plainWhileEmpty toolbar observes; batches of only these skip the re-election. */
const PLAIN_ATTRIBUTES = ["aria-label", "aria-hidden"];

export type PlainWhileEmptyState = {held: boolean; label: string | null};

/**
 * Upstream `u8`: the root holds a focusable not hidden by an `[inert]`/`[aria-hidden="true"]` subtree of its own (a
 * hiding ancestor above the root does not count).
 */
export function toolbarHasFocusable(root: Element): boolean {
	return [...root.querySelectorAll(TOOLBAR_FOCUSABLE_SELECTOR)].some((element) => {
		const hidden = element.closest('[inert], [aria-hidden="true"]');
		return hidden === null || hidden === root || !root.contains(hidden);
	});
}

/** Upstream `oS`: latch `held`, then restore role (and the remembered label) or strip both while never held. */
export function applyPlainWhileEmpty(root: Element, state: PlainWhileEmptyState) {
	state.held ||= toolbarHasFocusable(root);
	if (state.held) {
		if (!root.hasAttribute("role")) {
			root.setAttribute("role", "toolbar");
			if (state.label !== null && !root.hasAttribute("aria-label")) root.setAttribute("aria-label", state.label);
		}
	} else {
		state.label = root.getAttribute("aria-label") ?? state.label;
		root.removeAttribute("role");
		root.removeAttribute("aria-label");
	}
}

const ITEM_KIND = 'button:not([disabled]), a[href], [role="button"]';
const CANDIDATES = `${ITEM_KIND}, [tabindex]`;
const FIELD =
	'input:not([type="checkbox"], [type="button"], [type="submit"], [type="reset"], [type="image"]), textarea, select, [role="textbox"], [role="searchbox"], [role="spinbutton"], [role="slider"]';
const COMPOSITE =
	'[role="tablist"], [role="radiogroup"], [role="menubar"], [role="toolbar"], [data-cds="Toolbar"], [contenteditable]:not([contenteditable="false"]), [data-cds="TextInput"], [data-cds="NumberInput"], [data-cds="DateInput"], [data-cds-part="scroll-pager-control"]';
const SOFT_DISABLED = ':is([role="switch"], [role="checkbox"])[data-disabled]:not([data-disabled="false"], button)';
const ROVING_KEY = /^(?:ArrowLeft|ArrowRight|Home|End)$/;
const REASON_WRAPPER = "data-cds-disabled-reason-wrapper";
/**
 * A cds disabled-reason wrapper while it holds a reason. Upstream's renders tabindex 0 then and so joins the set;
 * the local one pre-renders the roving index (-1 unless it is the stop), so it joins by its description instead.
 */
const DESCRIBED_REASON_WRAPPER = `[${REASON_WRAPPER}][aria-describedby]`;

/** Upstream `e9`: inside an `[inert]` subtree of the root (a sheet's inert excepted). */
function insideInert(root: Element, element: Element): boolean {
	const inert = element.closest("[inert]:not([data-cds-sheet-inert])");
	return inert !== null && inert !== root && root.contains(inert);
}

/** Upstream `Qa`: a text field, or inside a composite nested in the root, whose keys are its own. */
function ownsKeys(root: Element, element: Element): boolean {
	const composite = element.closest(COMPOSITE);
	return element.matches(FIELD) || (composite !== null && composite !== root && root.contains(composite));
}

/** Upstream `gY`. */
function isVisible(element: Element): boolean {
	return typeof element.checkVisibility !== "function" || element.checkVisibility({visibilityProperty: true});
}

/** Upstream `C4`: the focused item left the set by becoming disabled. */
function becameDisabled(root: Element, element: Element, {softDisabled = false}: RovingToolbarOptions): boolean {
	return (
		element.matches(":disabled") || (softDisabled && (element.matches(SOFT_DISABLED) || insideInert(root, element)))
	);
}

/** Upstream `Dl`: the toolbar's items in DOM order, keeping only the innermost of nested matches. */
function rovingItems(root: HTMLElement, managed: WeakSet<Element>, {softDisabled = false}: RovingToolbarOptions) {
	const items = [...root.querySelectorAll<HTMLElement>(CANDIDATES)].filter(
		(item) =>
			!item.hasAttribute("data-base-ui-focus-guard") &&
			!ownsKeys(root, item) &&
			item.getAttribute("aria-hidden") !== "true" &&
			!item.matches(":disabled") &&
			!insideInert(root, item) &&
			!(softDisabled && item.matches(SOFT_DISABLED)) &&
			(item.matches(ITEM_KIND) ||
				item.tabIndex >= 0 ||
				managed.has(item) ||
				item.matches(DESCRIBED_REASON_WRAPPER)),
	);
	return items.filter((item) => !items.some((other) => other !== item && item.contains(other)));
}

/**
 * Upstream `h8`: where a stop that left `prev` lands in `next` — the survivor that took its index, else the nearest
 * one before it, clamped to the list.
 */
export function rovingHeir<E>(prev: readonly E[], stop: E, next: readonly E[]): E | undefined {
	const index = prev.indexOf(stop);
	const survivorAt = (at: number) => {
		const element = prev[at];
		return element === undefined ? -1 : next.indexOf(element);
	};
	let before = index - 1;
	while (before >= 0 && survivorAt(before) === -1) before--;
	let after = index + 1;
	while (after < prev.length && survivorAt(after) === -1) after++;
	const last = next.length - 1;
	if (before < 0 && after < prev.length) return next[Math.max(survivorAt(after) - (after - index), 0)];
	const ceiling = after < prev.length ? survivorAt(after) : last;
	return next[Math.min(survivorAt(before) + (index - before), ceiling, last)];
}

/** Upstream `EL`: which side of `from` the heir sits on in `list` (-1 after, 1 before, 0 unknown). */
function heirSide(list: readonly Element[], from: Element | null, heir: Element): number {
	const index = list.indexOf(heir);
	if (index === -1) return 0;
	return index > list.findIndex((item) => item === from) ? -1 : 1;
}

type Park = {
	addedTabindex: boolean;
	onLeft: () => void;
	onBlur: (event: globalThis.FocusEvent) => void;
	onEnd: (() => void) | undefined;
};

/** Upstream `NG`: toolbar roots holding parked focus. */
const parks = new WeakMap<HTMLElement, Park>();
/** Upstream `lv`: roots a roving hook is attached to (only those can park). */
const attached = new WeakSet<HTMLElement>();

/** Upstream `O8`: parked by rest-on-loss with tabindex 0, so Space is swallowed and every item sits at -1. */
function parkedForRest(root: HTMLElement): boolean {
	return parks.get(root)?.onEnd !== undefined && root.tabIndex === 0;
}

/** Upstream `Ry`: end a park, removing only a tabindex it added. */
function unpark(root: HTMLElement) {
	const park = parks.get(root);
	if (park === undefined) return;
	root.removeEventListener("blur", park.onBlur);
	root.removeEventListener("pointerdown", park.onLeft, true);
	if (park.addedTabindex) root.removeAttribute("tabindex");
	parks.delete(root);
	park.onEnd?.();
}

/** Upstream `XU`: park focus on the root; with no `onEnd` the root gets -1 when it had no tabindex, else 0. */
function park(root: HTMLElement, onEnd: (() => void) | undefined): boolean {
	if (!attached.has(root)) return false;
	if (!parks.has(root)) {
		const addedTabindex = !root.hasAttribute("tabindex");
		if (addedTabindex) root.tabIndex = onEnd === undefined ? -1 : 0;
		const onLeft = () => {
			if (root.ownerDocument.activeElement !== root) unpark(root);
		};
		const onBlur = (event: globalThis.FocusEvent) => {
			if (addedTabindex && event.relatedTarget === null) queueMicrotask(onLeft);
			else onLeft();
		};
		root.addEventListener("blur", onBlur);
		root.addEventListener("pointerdown", onLeft, true);
		parks.set(root, {addedTabindex, onLeft, onBlur, onEnd});
	}
	root.focus({preventScroll: true});
	if (root.ownerDocument.activeElement === root) return true;
	unpark(root);
	return false;
}

/** Upstream `Bt`/`G4`: focused without `:focus-visible` (pointer modality) in a focused document. */
function focusedByPointer(element: HTMLElement): boolean {
	if (!element.ownerDocument.hasFocus() || element.ownerDocument.activeElement !== element) return false;
	try {
		return !element.matches(":focus-visible");
	} catch {
		return false;
	}
}

/** Upstream `sE`: an iframe document without focus. */
function unfocusedFrame(doc: Document): boolean {
	const view = doc.defaultView;
	return view !== null && view.top !== view.self && !doc.hasFocus();
}

/** Upstream `KX`/`OE`: the heir is a disabled-reason wrapper that took over from (or just appeared for) the item. */
function handedBack(lost: Element, heir: Element): boolean {
	return heir.hasAttribute(REASON_WRAPPER) && heir.contains(lost);
}

function asElement(target: EventTarget | null): HTMLElement | null {
	return target instanceof HTMLElement ? target : null;
}

type Rest = {rest: Park; heir: HTMLElement; side: number};
type StandIn = {field: HTMLElement; to: HTMLElement; prev: HTMLElement | null; next: HTMLElement | null};

/** Upstream `F3`: the rest record, while it still describes this park and heir. */
function currentRest(rest: Rest | null, park: Park | undefined, heir: HTMLElement | null): Rest | null {
	return rest !== null && rest.rest === park && rest.heir === heir ? rest : null;
}

/** Upstream `RC`'s state and handlers, one per hook instance. */
class Roving {
	root: HTMLElement | null = null;
	lastRoot: HTMLElement | null = null;
	options: RovingToolbarOptions = {};
	stop: HTMLElement | null = null;
	items: HTMLElement[] = [];
	managed = new WeakSet<Element>();
	focusInside = false;
	focusedOnce = false;
	hiddenLeading = new WeakSet<Element>();
	standIn: StandIn | null = null;
	justFocused: EventTarget | null = null;
	rest: Rest | null = null;
	/** Upstream's per-hook `{held, label}`, kept across roots. */
	plain: PlainWhileEmptyState = {held: false, label: null};
	mutations: MutationObserver | null = null;
	resizes: ResizeObserver | null = null;
	listeners: AbortController | null = null;
	portaled: AbortController | null = null;
	forwarding: AbortController | null = null;

	list(root: HTMLElement) {
		return rovingItems(root, this.managed, this.options);
	}

	/** Upstream `b`: make `stop` the tab stop over `items` (none while parked for rest). */
	assign(items: HTMLElement[], stop: HTMLElement) {
		this.stop = stop;
		this.items = items;
		const root = this.root;
		this.plain.held = true;
		if (root !== null && this.options.plainWhileEmpty === true) applyPlainWhileEmpty(root, this.plain);
		const holder = root !== null && parkedForRest(root) ? null : stop;
		for (const item of items) {
			this.managed.add(item);
			const tabIndex = item === holder ? 0 : -1;
			if (item.getAttribute("tabindex") !== String(tabIndex)) item.tabIndex = tabIndex;
		}
		const resizes = this.resizes;
		if (resizes !== null && root !== null) {
			resizes.disconnect();
			resizes.observe(root);
			resizes.observe(stop);
			for (const item of items) if (this.hiddenLeading.has(item)) resizes.observe(item);
		}
	}

	/** Upstream `x`: a resize may have hidden the stop (watchHidden). */
	onResize(root: HTMLElement) {
		const stop = this.stop;
		const firstUntilFocused = this.options.firstUntilFocused === true;
		if (stop === null || (!(firstUntilFocused && !this.focusedOnce) && isVisible(stop))) return;
		const items = this.list(root);
		const firstVisible = items.find(isVisible);
		const leading = items.slice(0, firstVisible ? items.indexOf(firstVisible) : undefined);
		for (const item of leading) if (!this.hiddenLeading.has(item)) this.resizes?.observe(item);
		this.hiddenLeading = new WeakSet(leading);
		if (firstVisible === undefined) return;
		const active = root.ownerDocument.activeElement;
		if (!root.contains(active) && active?.matches("body") === false) this.focusedOnce = false;
		const heir =
			firstUntilFocused && !this.focusedOnce
				? firstVisible
				: rovingHeir(this.items, stop, items.filter(isVisible));
		if (heir === undefined || heir === stop) return;
		const rest = currentRest(this.rest, parks.get(root), stop);
		if (rest !== null) this.rest = {...rest, heir, side: heirSide(this.items, stop, heir) || rest.side};
		this.assign(items, heir);
	}

	/** Upstream `S`: the rest park ended; re-elect from where focus went. */
	onParkEnd = () => {
		const root = this.root;
		if (root === null || this.stop === null) return;
		const items = this.list(root);
		const active = root.ownerDocument.activeElement;
		this.focusedOnce = root.contains(active);
		this.assign(
			items,
			items.find((item) => item === active) ?? items.find((item) => !this.hiddenLeading.has(item)) ?? this.stop,
		);
	};

	/** Upstream `C`: re-elect the stop after the item set may have changed, and rescue lost focus. */
	sync(root: HTMLElement) {
		const items = this.list(root);
		const [first] = items;
		const stop = this.stop;
		const doc = root.ownerDocument;
		const options = this.options;
		if (first === undefined) {
			this.stop = null;
			this.items = items;
			this.focusedOnce = false;
			this.standIn = null;
			this.rest = null;
			this.resizes?.disconnect();
			const active = doc.activeElement;
			if (
				options.restOnLoss === true &&
				stop !== null &&
				this.focusInside &&
				!unfocusedFrame(doc) &&
				(active === null || active === doc.body || (active === stop && becameDisabled(root, stop, options)))
			) {
				this.restOrBlur(root, active === stop ? stop : null);
			}
		} else {
			const lost = stop !== null && !items.includes(stop);
			const active = asElement(doc.activeElement);
			const prev = this.items;
			const standIn = this.standIn?.to === stop ? this.standIn : null;
			const fieldStays = standIn !== null && root.contains(standIn.field);
			const prevIndex = standIn?.prev ? items.indexOf(standIn.prev) : null;
			const nextIndex = standIn?.next ? items.indexOf(standIn.next) : null;
			const returned =
				standIn === null || fieldStays || lost || prevIndex === -1 || nextIndex === -1
					? undefined
					: items.slice((prevIndex ?? -1) + 1, nextIndex ?? undefined).find((item) => !prev.includes(item));
			const target = stop === null ? first : lost ? (rovingHeir(prev, stop, items) ?? first) : (returned ?? stop);
			const field = fieldStays ? standIn.field : lost && options.standInFields === true ? active : null;
			this.standIn = null;
			if (field !== null && root.contains(field) && ownsKeys(root, field)) {
				const index = items.findIndex(
					(item) => field.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING,
				);
				const next = items[index] ?? null;
				const before = index === 0 ? null : (items.at(index === -1 ? -1 : index - 1) ?? null);
				if (fieldStays || (field === this.justFocused && (target === next || target === before))) {
					this.standIn = {field, to: target, prev: before, next};
				}
			}
			if (lost && !this.focusInside && prev.includes(target)) this.focusedOnce = false;
			const firstUntil = options.firstUntilFocused === true && !this.focusedOnce;
			const elected =
				stop === null || (firstUntil && !(lost && this.resizes !== null))
					? (items.find((item) => !this.hiddenLeading.has(item)) ?? first)
					: target;
			const holding = stop === null ? items.find((item) => item === active) : undefined;
			this.assign(items, holding ?? elected);
			if (
				lost &&
				this.focusInside &&
				!unfocusedFrame(doc) &&
				(active === null ||
					active === doc.body ||
					active === root ||
					(active === stop && becameDisabled(root, stop, options)))
			) {
				const heir = isVisible(elected) ? elected : rovingHeir(items, elected, items.filter(isVisible));
				if (heir !== undefined && heir !== elected) this.assign(items, heir);
				const alreadyParked = active === root && parks.has(root);
				const side = currentRest(this.rest, parks.get(root), stop)?.side ?? 0;
				const claimed =
					heir !== undefined &&
					(handedBack(stop, heir) || (heir.hasAttribute(REASON_WRAPPER) && !prev.includes(heir)));
				if (options.restOnLoss === true && !claimed) {
					this.restOrBlur(root, active === stop ? stop : null);
				} else if (!alreadyParked && heir !== undefined) {
					heir.focus({preventScroll: true});
					if (
						!handedBack(stop, heir) &&
						focusedByPointer(heir) &&
						!park(root, options.restOnLoss === true ? this.onParkEnd : undefined)
					) {
						heir.blur();
					}
				}
				const parked = parks.get(root);
				const now = this.stop;
				this.rest =
					parked === undefined || now === null
						? null
						: {
								rest: parked,
								heir: now,
								side:
									now === elected ? heirSide(prev, stop, now) || side : heirSide(items, elected, now),
							};
			}
		}
		this.focusInside = root.contains(doc.activeElement);
		if (parks.has(root) && doc.activeElement !== root) unpark(root);
		if (this.stop !== null && parkedForRest(root)) this.assign(items, this.stop);
		if (this.focusInside) this.focusedOnce = true;
	}

	/** Upstream `AK`: park for rest, else blur the lost item that still holds focus. */
	restOrBlur(root: HTMLElement, lostFocused: HTMLElement | null) {
		if (!park(root, this.onParkEnd) && lostFocused !== null) lostFocused.blur();
	}

	/** Upstream `w`: attach to (or detach from) a root. */
	attach(root: HTMLElement | null) {
		this.mutations?.disconnect();
		this.mutations = null;
		this.resizes?.disconnect();
		this.resizes = null;
		this.listeners?.abort();
		this.listeners = null;
		this.root = root;
		if (root === null) return;
		if (root !== this.lastRoot) {
			this.lastRoot = root;
			this.stop = null;
			this.items = [];
			this.focusInside = false;
			this.focusedOnce = false;
			this.standIn = null;
			this.rest = null;
			this.hiddenLeading = new WeakSet();
		}
		attached.add(root);
		const listeners = new AbortController();
		this.listeners = listeners;
		const {signal} = listeners;
		root.addEventListener(
			"focusin",
			(event) => {
				if (event.target !== root && this.options.restOnLoss === true) unpark(root);
				if (event.target !== root) this.rest = null;
				this.focusInside = true;
				this.focusedOnce = true;
				if (this.options.standInFields !== true) return;
				if (event.target !== this.standIn?.field) this.standIn = null;
				const {target} = event;
				this.justFocused = target;
				queueMicrotask(() => {
					if (this.justFocused === target) this.justFocused = null;
				});
			},
			{signal},
		);
		root.addEventListener(
			"focusout",
			(event) => {
				const next = asElement(event.relatedTarget);
				if (next !== null) {
					this.focusInside = root.contains(next);
					return;
				}
				const left = asElement(event.target);
				queueMicrotask(() => {
					if (this.root !== root) return;
					if (left !== null && this.list(root).includes(left)) {
						this.focusInside = root.contains(root.ownerDocument.activeElement);
					} else {
						this.sync(root);
					}
				});
			},
			{signal},
		);
		const view = root.ownerDocument.defaultView;
		const Observer = view?.ResizeObserver;
		if (view !== null && typeof Observer === "function" && this.options.watchHidden === true) {
			let frame = 0;
			this.resizes = new Observer(() => {
				view.cancelAnimationFrame(frame);
				frame = view.requestAnimationFrame(() => {
					this.onResize(root);
				});
			});
			signal.addEventListener("abort", () => {
				view.cancelAnimationFrame(frame);
			});
		}
		this.sync(root);
		if (typeof MutationObserver === "undefined") return;
		const plain = this.options.plainWhileEmpty === true;
		this.mutations = new MutationObserver((records) => {
			if (!records.every((record) => PLAIN_ATTRIBUTES.includes(record.attributeName ?? ""))) this.sync(root);
			if (plain && this.root === root) applyPlainWhileEmpty(root, this.plain);
		});
		this.mutations.observe(root, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [
				"disabled",
				"inert",
				...(this.options.softDisabled === true ? ["data-disabled"] : []),
				...(plain ? PLAIN_ATTRIBUTES : []),
			],
		});
		if (plain) {
			queueMicrotask(() => {
				if (this.root === root) applyPlainWhileEmpty(root, this.plain);
			});
		}
	}

	/** Upstream `T`: a focused item becomes the stop. */
	onFocus = (event: {target: EventTarget | null}) => {
		const root = this.root;
		if (root === null) return;
		const target = asElement(event.target);
		if (target === null || target === this.stop) return;
		const items = this.list(root);
		if (items.includes(target)) this.assign(items, target);
	};

	/** Upstream `E`: arrows, Home and End over the visible items. */
	onKeyDown = (event: {
		defaultPrevented: boolean;
		altKey: boolean;
		ctrlKey: boolean;
		metaKey: boolean;
		key: string;
		target: EventTarget | null;
		preventDefault: () => void;
	}) => {
		const root = this.root;
		const target = asElement(event.target);
		if (
			root === null ||
			target === null ||
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			!root.contains(target) ||
			ownsKeys(root, target)
		) {
			return;
		}
		const items = this.list(root);
		const visible = items.filter(isVisible);
		const active = root.ownerDocument.activeElement;
		const current = items.findIndex((item) => item === active);
		const step = (from: number, direction: number) =>
			items
				.map((_, k) => items[(from + direction * (k + 1) + items.length * (k + 1)) % items.length])
				.find((item) => item !== undefined && visible.includes(item));
		const fromRoot = (direction: number) => {
			const heir = parks.has(root) ? this.stop : null;
			const index = heir === null ? -1 : items.indexOf(heir);
			const sameSide = currentRest(this.rest, parks.get(root), heir)?.side === direction;
			if (heir === null || index === -1) return visible[0];
			return !sameSide && visible.includes(heir) ? heir : step(index, direction);
		};
		const move = (direction: number) => (current === -1 ? fromRoot(direction) : step(current, direction));
		const forward = root.ownerDocument.defaultView?.getComputedStyle(root).direction === "rtl" ? -1 : 1;
		let next: HTMLElement | undefined;
		switch (event.key) {
			case "ArrowRight":
				next = move(forward);
				break;
			case "ArrowLeft":
				next = move(-forward);
				break;
			case "Home":
				next = visible[0];
				break;
			case "End":
				next = visible.at(-1);
				break;
			case " ":
				if (target === root && parkedForRest(root)) event.preventDefault();
				return;
			default:
				return;
		}
		if (next === undefined) return;
		event.preventDefault();
		this.assign(items, next);
		next.focus({focusVisible: true});
	};

	/** Upstream `k`: attach, plus portaled-item forwarding when that option is on. */
	ref(root: HTMLElement | null, options: RovingToolbarOptions) {
		if (root !== null) this.options = options;
		this.attach(root);
		this.portaled?.abort();
		this.portaled = null;
		if (root === null || options.portaledItems !== true) return;
		const doc = root.ownerDocument;
		const portaled = new AbortController();
		this.portaled = portaled;
		const {signal} = portaled;
		root.addEventListener("focusin", this.onFocus, {signal});
		const forward = (event: globalThis.KeyboardEvent) => {
			if (root.contains(doc.activeElement)) this.onKeyDown(event);
		};
		doc.addEventListener(
			"keydown",
			(event) => {
				// oxlint-disable-next-line typescript/no-deprecated -- upstream reads it to tell a stopped bubble apart
				if (!event.cancelBubble) forward(event);
			},
			{signal},
		);
		const stopForwarding = () => this.forwarding?.abort();
		const onPathKeyDown = (event: Event) => {
			if (!(event instanceof KeyboardEvent)) return;
			// oxlint-disable-next-line typescript/no-deprecated -- upstream reads it to tell a stopped bubble apart
			if (event.cancelBubble) {
				stopForwarding();
				forward(event);
			} else if (event.currentTarget === root) {
				stopForwarding();
			}
		};
		root.addEventListener(
			"keydown",
			(event) => {
				stopForwarding();
				if (!ROVING_KEY.test(event.key)) return;
				this.forwarding = new AbortController();
				const path = event.composedPath();
				for (const node of path.slice(0, path.indexOf(root) + 1)) {
					node.addEventListener("keydown", onPathKeyDown, {signal: this.forwarding.signal});
				}
			},
			{capture: true, signal},
		);
	}
}

/**
 * Upstream's cds roving toolbar hook (`RC` in claude.ai/code's shared-frame chunk): the toolbar is one tab stop,
 * ArrowRight/ArrowLeft move over the visible items and wrap (mirrored in RTL), Home and End jump to the ends, and
 * modifier combinations, cancelled keys and keys owned by a field or nested composite are left alone. When the stop
 * leaves, its neighbour inherits it; when the focused item is lost, focus moves to that heir (or, under pointer
 * modality, parks silently on the root). Pass {@link TOOLBAR_ROVING_OPTIONS} for the cds `Toolbar` behaviours;
 * message actions bars pass nothing, as upstream's do. Spread the returned props onto the `role="toolbar"` element.
 */
export function useRovingToolbar<T extends HTMLElement = HTMLDivElement>(options: RovingToolbarOptions = {}) {
	const roving = useRef<Roving | null>(null);
	roving.current ??= new Roving();
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const ref = useCallback((element: T | null) => {
		roving.current?.ref(element, optionsRef.current);
	}, []);
	const onFocus = useCallback((event: FocusEvent<T>) => {
		roving.current?.onFocus(event);
	}, []);
	const onKeyDown = useCallback((event: KeyboardEvent<T>) => {
		roving.current?.onKeyDown(event);
	}, []);

	return {ref, onFocus, onKeyDown};
}
