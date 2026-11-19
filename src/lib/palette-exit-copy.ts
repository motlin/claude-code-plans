/**
 * Upstream's palette exit copy (`km`, installed by `Am` and played by the shell's `KN` snapshot): on every close the
 * live palette vanishes on the closing frame and an inert clone of it (plus its scrim) fades out in its place. When an
 * overlay was noted as opening (`overlay-open-note`), the scrim waits in its own layer and hands off to that overlay's
 * backdrop instead of fading over the page.
 */
import {isAnotherOverlayOpen} from "./overlay";
import {takeOverlayOpeningNote} from "./overlay-open-note";
import {isMotionReduced} from "./reduced-motion";

export const PALETTE_EXIT_COPY_ATTR = "data-palette-exit-copy";
export const PALETTE_EXIT_SCALE = 0.98;
export const PALETTE_EXIT_MAX_ELEMENTS = 750;
export const PALETTE_EXIT_DURATION_FALLBACK_MS = 200;
export const PALETTE_EXIT_EASE_FALLBACK = "cubic-bezier(0.165, 0.84, 0.44, 1)";
/** Upstream `hm`: how long past the noted open the scrim waits for the incoming backdrop. */
const HANDOFF_SLACK_MS = 400;

/**
 * Local stand-in for upstream's cloned `[data-cds-portal]` layer: Base UI portals the palette's backdrop and popup to
 * `document.body` as z-50 siblings, so the copy gets a fresh full-screen layer at the same stacking level.
 */
const LAYER_CLASS = "fixed inset-0 z-50 pointer-events-none";
/** The local recede scales the card inside the popup rather than the popup itself (upstream `--cp-recede-scale`). */
const RECEDE_CARD_SELECTOR = "[data-palette-recede-card]";

const STRIPPED_ATTRS = [
	"id",
	"role",
	"tabindex",
	"aria-modal",
	"aria-labelledby",
	"aria-describedby",
	"data-cds",
	"data-cds-overlay",
	"data-cds-portal",
	"data-open",
	"data-popup-open",
	"data-starting-style",
	"data-ending-style",
	"data-command-palette",
] as const;
const EMBED_SELECTOR = "iframe,webview,video,audio,canvas,object,embed";
const SCRUBBED_ATTRS = [
	"id",
	"name",
	"for",
	"form",
	"autofocus",
	"contenteditable",
	"tabindex",
	"data-testid",
] as const;
const POPUP_SELECTOR =
	'[data-popup-open],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="combobox"][aria-expanded="true"]';
const POPUP_ATTRS = ["role", "data-popup-open", "data-open", "aria-expanded"] as const;
const FROZEN_STYLE: Readonly<Record<string, string>> =
{
	animation: "none",
	transition: "none",
};

export interface PaletteExitCopy
{
	play: () => void;
	remove: () => void;
}

function setStyles(element: HTMLElement, styles: Readonly<Record<string, string>>): void
{
	for (const [name, value] of Object.entries(styles)) element.style.setProperty(name, value);
}

/** Upstream `Cm`: drops the attributes that make the copy look like a live dialog. */
export function stripCopyAttrs(element: Element): void
{
	for (const name of STRIPPED_ATTRS) element.removeAttribute(name);
}

/** Upstream `wm`: empties embeds and removes ids, form wiring and popup roles from the whole copy. */
export function scrubCopy(root: Element): void
{
	const doc = root.ownerDocument;
	for (const embed of Array.from(root.querySelectorAll(EMBED_SELECTOR)))
	{
		const placeholder = doc.createElement("div");
		placeholder.className = embed.getAttribute("class") ?? "";
		const style = embed.getAttribute("style");
		if (style !== null) placeholder.setAttribute("style", style);
		embed.replaceWith(placeholder);
	}
	const scrubbedSelector = SCRUBBED_ATTRS.map((name) => `[${name}]`).join(",");
	for (const element of Array.from(root.querySelectorAll(scrubbedSelector)))
	{
		const inSvg = element.closest("svg") !== null;
		for (const name of SCRUBBED_ATTRS)
		{
			if (!(inSvg && name === "id")) element.removeAttribute(name);
		}
	}
	for (const element of Array.from(root.querySelectorAll(POPUP_SELECTOR)))
	{
		for (const name of POPUP_ATTRS) element.removeAttribute(name);
	}
}

/** Upstream `Tm`: from the last child up, drops copy children whose live top is at or below `bottom`. */
export function pruneBelow(live: Element, copy: Element, bottom: number): void
{
	for (let index = live.children.length - 1; index >= 0; index--)
	{
		const liveChild = live.children[index];
		const copyChild = copy.children[index];
		if (liveChild === undefined) continue;
		if (liveChild.getBoundingClientRect().top < bottom)
		{
			if (copyChild !== undefined) pruneBelow(liveChild, copyChild, bottom);
			return;
		}
		copyChild?.remove();
	}
}

/** Upstream `Em`: freezes every scrolled or overflowing scroller in the copy at its live scroll position. */
export function freezeScroll(live: HTMLElement, copy: HTMLElement): void
{
	const view = live.ownerDocument.defaultView;
	const pairs: [HTMLElement, HTMLElement][] = [];
	for (const scroller of Array.from(live.querySelectorAll<HTMLElement>('[class*="overflow-"]')))
	{
		if (
			scroller.scrollTop === 0 &&
			scroller.scrollLeft === 0 &&
			scroller.scrollHeight - scroller.clientHeight <= 1
		)
		{
			continue;
		}
		const path: number[] = [];
		for (let node: HTMLElement = scroller; node !== live && node.parentElement !== null; node = node.parentElement)
		{
			path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
		}
		const twin = path.reduce<Element | undefined>((node, index) => node?.children[index], copy);
		if (twin instanceof HTMLElement) pairs.push([scroller, twin]);
	}
	for (const [scroller, twin] of pairs)
	{
		if (!copy.contains(twin)) continue;
		if (scroller.scrollTop !== 0 || scroller.scrollHeight - scroller.clientHeight > 1)
		{
			const box = scroller.getBoundingClientRect();
			pruneBelow(scroller, twin, box.bottom);
			setStyles(
				twin,
				{
					height: `${box.height}px`,
					"min-height": `${box.height}px`,
					"scrollbar-color": "transparent transparent",
				},
			);
		}
		const {scrollTop, scrollLeft} = scroller;
		if (scrollTop === 0 && scrollLeft === 0) continue;
		Array.from(scroller.children).forEach((child, index) =>
		{
			const twinChild = twin.children[index];
			if (twinChild instanceof HTMLElement && view?.getComputedStyle(child).position !== "sticky")
			{
				twinChild.style.setProperty("translate", `${-scrollLeft}px ${-scrollTop}px`);
			}
		});
	}
}

/** Upstream `Om`: carries the current opacity of every running animation onto its clone. */
function copyRunningOpacities(live: HTMLElement, copy: HTMLElement): void
{
	const view = live.ownerDocument.defaultView;
	const animations = live.getAnimations(
		{
			subtree: true,
		},
	);
	if (view === null || animations.length === 0) return;
	const liveNodes = Array.from(live.querySelectorAll("*"));
	const copyNodes = Array.from(copy.querySelectorAll<HTMLElement>("*"));
	if (liveNodes.length !== copyNodes.length) return;
	const indexes = new Map(liveNodes.map((node, index) => [node, index]));
	for (const {effect} of animations)
	{
		const target =
			effect !== null && "target" in effect && effect.target instanceof view.Element ? effect.target : null;
		const index = target === null ? undefined : indexes.get(target);
		const twin = index === undefined ? undefined : copyNodes[index];
		if (target !== null && twin !== undefined) twin.style.opacity = view.getComputedStyle(target).opacity;
	}
}

/** Upstream `Mo`: a CSS duration token (`ms` or `s`) in milliseconds, 0 when unset or unparsable. */
function durationMs(style: CSSStyleDeclaration, name: string): number
{
	const value = style.getPropertyValue(name).trim();
	const match = /^(-?[\d.]+)(ms|s)$/.exec(value);
	if (match === null) return 0;
	const amount = Number(match[1]);
	return match[2] === "s" ? amount * 1000 : amount;
}

function isScaled(view: Window, element: Element | null): boolean
{
	if (element === null) return false;
	const scale = view.getComputedStyle(element).getPropertyValue("scale");
	return (
		(scale !== "" && scale !== "none" && scale !== "1") ||
		element.getAnimations().some((animation) => animation.playState === "running")
	);
}

/** The open backdrops a hand-off could follow: not the scrim, not the closing palette's, not another exit copy's. */
function incomingBackdrops(doc: Document, scrim: Element | null, livePortal: Element): Element[]
{
	return Array.from(doc.querySelectorAll(".bg-backdrop[data-open]")).filter(
		(backdrop) =>
			backdrop !== scrim &&
			!livePortal.contains(backdrop) &&
			backdrop.closest(`[${PALETTE_EXIT_COPY_ATTR}]`) === null,
	);
}

/**
 * Upstream `km`: snapshots the live popup (still open) into an inert copy appended to `document.body`, or returns
 * `null` when no exit should play (reduced motion, receded or mid-animation, too large, zero-size).
 */
export function makePaletteExitCopy(popup: HTMLElement): PaletteExitCopy | null
{
	const note = takeOverlayOpeningNote();
	const doc = popup.ownerDocument;
	const view = doc.defaultView;
	if (view === null || typeof popup.animate !== "function" || isMotionReduced(doc)) return null;
	const computed = view.getComputedStyle(popup);
	const duration = durationMs(computed, "--cds-dur-base") || PALETTE_EXIT_DURATION_FALLBACK_MS;
	const easing = computed.getPropertyValue("--cds-ease-out").trim() || PALETTE_EXIT_EASE_FALLBACK;
	const livePortal = popup.parentElement;
	const box = popup.getBoundingClientRect();
	if (
		isScaled(view, popup) ||
		isScaled(view, popup.querySelector(RECEDE_CARD_SELECTOR)) ||
		livePortal === null ||
		popup.getElementsByTagName("*").length > PALETTE_EXIT_MAX_ELEMENTS ||
		box.width < 1 ||
		box.height < 1
	)
	{
		return null;
	}

	const newLayer = () =>
	{
		const layer = doc.createElement("div");
		layer.className = LAYER_CLASS;
		layer.setAttribute(PALETTE_EXIT_COPY_ATTR, "");
		layer.setAttribute("aria-hidden", "true");
		layer.setAttribute("inert", "");
		layer.style.pointerEvents = "none";
		return layer;
	};
	const layer = newLayer();
	// Upstream hands off only into an empty `#portal-root`; locally every overlay portals to body, so "empty" means no
	// other open overlay (the overlay-open marker).
	const handoff = note !== null && !isAnotherOverlayOpen(popup);
	const liveBackdrop = livePortal.querySelector(":scope > .bg-backdrop");
	let scrim: HTMLElement | null = null;
	let scrimLayer: HTMLElement | null = null;
	const scrimClone = liveBackdrop?.cloneNode(false);
	if (scrimClone instanceof view.HTMLElement)
	{
		scrim = scrimClone;
		stripCopyAttrs(scrim);
		scrim.classList.remove("draggable-none");
		setStyles(
			scrim,
			{
				...FROZEN_STYLE,
				opacity: "1",
			},
		);
		if (handoff)
		{
			scrimLayer = newLayer();
			scrimLayer.append(scrim);
		}
		else
		{
			layer.append(scrim);
		}
	}

	const panel = popup.cloneNode(true);
	if (!(panel instanceof view.HTMLElement)) return null;
	copyRunningOpacities(popup, panel);
	freezeScroll(popup, panel);
	stripCopyAttrs(panel);
	scrubCopy(panel);
	for (const element of [panel, ...Array.from(panel.querySelectorAll<HTMLElement>("*"))])
	{
		setStyles(element, FROZEN_STYLE);
		element.classList.remove("draggable-none");
	}
	setStyles(
		panel,
		{
			position: "fixed",
			left: `${box.left}px`,
			top: `${box.top}px`,
			width: `${box.width}px`,
			height: `${box.height}px`,
			"max-width": "none",
			"max-height": "none",
			margin: "0",
			transform: "none",
			translate: "none",
			"will-change": "scale, opacity",
		},
	);
	layer.append(panel);

	let live:
	{
		layer: HTMLElement;
		scrimLayer: HTMLElement | null;
		panel: HTMLElement;
		scrim: HTMLElement | null;
	} | null =
	{
		layer,
		scrimLayer,
		panel,
		scrim,
	};
	let frame = 0;
	// Cancel only a frame this copy queued: the safety timer path never queues one, and a torn-down window may no
	// longer carry cancelAnimationFrame.
	const cancelFrame = () =>
	{
		if (frame !== 0) view.cancelAnimationFrame(frame);
		frame = 0;
	};
	const removeAll = () =>
	{
		view.clearTimeout(safety);
		cancelFrame();
		live?.layer.remove();
		live?.scrimLayer?.remove();
		live = null;
	};
	let panelDone = false;
	let scrimDone = scrimLayer === null;
	const panelFinished = () =>
	{
		live?.layer.remove();
		panelDone = true;
		if (scrimDone) removeAll();
	};
	const scrimFinished = () =>
	{
		cancelFrame();
		live?.scrimLayer?.remove();
		scrimDone = true;
		if (panelDone) removeAll();
	};
	const handoffMs = scrimLayer !== null && note !== null ? note + HANDOFF_SLACK_MS : 0;

	doc.body.append(layer);
	// Local stand-in for prepending into `#portal-root`: ahead of the panel layer, so the incoming dialog's portal
	// (appended to body later) stacks above it.
	if (scrimLayer !== null) doc.body.insertBefore(scrimLayer, layer);
	const safety = view.setTimeout(removeAll, (scrimLayer === null ? 0 : handoffMs + duration) + duration + 400);
	const timing: KeyframeAnimationOptions =
	{
		duration,
		easing,
		fill: "forwards",
	};
	const fadeScrim = () =>
	{
		const fading = live?.scrim;
		if (fading === null || fading === undefined) return;
		cancelFrame();
		fading
			.animate(
				[
					{
						opacity: Number(fading.style.opacity) || 0,
					},
					{
						opacity: 0,
					},
				],
				timing,
			)
			.finished.then(scrimFinished, scrimFinished);
	};
	const followIncoming = (deadline: number) =>
	{
		let seen = false;
		let last = 0;
		const step = () =>
		{
			const following = live?.scrim;
			if (following === undefined || following === null) return;
			const incoming = incomingBackdrops(doc, following, livePortal);
			const [first] = incoming;
			const now = view.performance.now();
			if (first === undefined)
			{
				if (now >= deadline || seen)
				{
					fadeScrim();
					return;
				}
			}
			else
			{
				seen = true;
				const opacity = Number(view.getComputedStyle(first).opacity) || 0;
				if (opacity < last - 0.01 || now >= deadline + duration)
				{
					fadeScrim();
					return;
				}
				last = opacity;
				following.style.opacity = String(Math.max(0, 1 - opacity));
				if (opacity >= 0.99)
				{
					scrimFinished();
					return;
				}
			}
			frame = view.requestAnimationFrame(step);
		};
		step();
	};

	return {
		play: () =>
		{
			if (live === null) return;
			try
			{
				if (live.scrimLayer === null)
				{
					live.scrim?.animate(
						[
							{
								opacity: 1,
							},
							{
								opacity: 0,
							},
						],
						timing,
					);
				}
				const exit = live.panel.animate(
					[
						{
							opacity: 1,
							scale: 1,
						},
						{
							opacity: 0,
							scale: PALETTE_EXIT_SCALE,
						},
					],
					timing,
				);
				if (live.scrimLayer === null)
				{
					exit.finished.then(removeAll, removeAll);
					return;
				}
				exit.finished.then(panelFinished, panelFinished);
				followIncoming(view.performance.now() + handoffMs);
			}
			catch
			{
				removeAll();
			}
		},
		remove: removeAll,
	};
}
