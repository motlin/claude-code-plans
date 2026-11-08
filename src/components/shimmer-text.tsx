import {
	type CSSProperties,
	type ReactNode,
	type Ref,
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import {FIZZY_LAKE_TYPE} from "../lib/fizzy-lake";

export type ShimmerVariant = "default" | "secondary" | "muted" | "strong";

/** Upstream `rg`: the clone needs glyph-clipped masks, which the CSS gates with the same `@supports`. */
const COMPOSITED_QUERY = "(-webkit-mask-clip: text) and (-webkit-app-region: drag)";

function supportsComposited(): boolean {
	return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports(COMPOSITED_QUERY);
}

const noSubscription = () => () => {};

/*
 * Upstream `Ur()` reads `supportsComposited` through useSyncExternalStore. Its server snapshot is
 * false; local renders the server pass composited so the SSR markup keeps its clone, and the
 * client corrects it on hydration.
 */
function useCompositedSupport(): boolean {
	return useSyncExternalStore(noSubscription, supportsComposited, () => true);
}

const COMPOSITED_DISPLAYS = new Set(["block", "inline-block", "flow-root", "list-item"]);
const CLAMP_WALK_DEPTH = 16;
const CLAMP_WALK_BLOCKS = new Set(["block", "flow-root", "list-item"]);
const CLAMP_WALK_PASS = new Set(["contents", "inline"]);

function lineClamped(style: CSSStyleDeclaration): boolean {
	return style.getPropertyValue("-webkit-line-clamp") !== "none";
}

/**
 * Upstream `Ka`: the clone only lines up with the text in a box of its own that no line clamp
 * cuts, so a bare inline span or a span inside a `line-clamp-*` box runs in fallback.
 */
function fitsComposited(element: HTMLElement): boolean {
	const view = element.ownerDocument.defaultView;
	if (!view) return false;
	const style = view.getComputedStyle(element);
	if (!COMPOSITED_DISPLAYS.has(style.display) || lineClamped(style)) return false;
	let ancestor = element.parentElement;
	for (let depth = 0; ancestor && depth < CLAMP_WALK_DEPTH; depth++) {
		const ancestorStyle = view.getComputedStyle(ancestor);
		if (lineClamped(ancestorStyle)) return false;
		if (!CLAMP_WALK_BLOCKS.has(ancestorStyle.display) && !CLAMP_WALK_PASS.has(ancestorStyle.display)) break;
		ancestor = ancestor.parentElement;
	}
	return true;
}

/** Upstream `QU`: an emoji glyph, which a primary-ink clone would paint over. */
const EMOJI = /\p{Emoji_Presentation}(?!︎)|\p{Emoji}️/u;

function ownText(element: HTMLElement, clone: HTMLElement | null): string {
	let text = "";
	for (const node of element.childNodes) if (node !== clone) text += node.textContent ?? "";
	return text;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
	if (typeof ref === "function") ref(value);
	else if (ref) ref.current = value;
}

function modeStyle(
	mode: "composited" | "fallback" | "inactive",
	delay: number | undefined,
	paused: boolean,
): CSSProperties | undefined {
	if (mode === "inactive" || (delay === undefined && !paused)) return undefined;
	if (mode === "fallback")
		return {
			...(delay === undefined ? {} : {animationDelay: `${delay}ms`}),
			...(paused ? {animationPlayState: "paused"} : {}),
		};
	return {
		...(delay === undefined ? {} : {"--cds-shimmer-text-delay": `${delay}ms`}),
		...(paused ? {"--cds-shimmer-text-play-state": "paused"} : {}),
	};
}

/**
 * Upstream's cds ShimmerText (`xa`): an in-flight label whose band sweeps across the glyphs on a
 * 3s held loop (`[data-cds=ShimmerText]` rules in globals.css).
 * - composited: the text in the variant's ink, plus an aria-hidden, inert clone masked to the
 *   glyphs whose `::after` carries the band.
 * - fallback (no glyph masks, an inline span, or a line-clamped box): no clone; the span itself
 *   sweeps a background-clip gradient, marked `data-shimmer-mode="fallback"`.
 * - inactive (`active={false}`): the span stays mounted with only its className.
 * `variant` picks the ink (default primary, secondary, muted, or the strong bell band), `delay`
 * (ms, usually `shimmerPhaseDelay()`) offsets the band, and `paused` holds it.
 */
export function ShimmerText({
	children,
	className,
	id,
	dir,
	active = true,
	variant = "default",
	delay,
	paused = false,
	ref,
}: {
	children: ReactNode;
	className?: string;
	id?: string;
	dir?: string;
	active?: boolean;
	variant?: ShimmerVariant;
	delay?: number;
	paused?: boolean;
	/** The row-cut observer's ref, for a label that fades when it overflows. */
	ref?: Ref<HTMLSpanElement> | undefined;
}) {
	const supported = useCompositedSupport();
	const spanRef = useRef<HTMLSpanElement | null>(null);
	const cloneRef = useRef<HTMLSpanElement | null>(null);
	const [fits, setFits] = useState(true);
	const setSpan = useCallback(
		(element: HTMLSpanElement | null) => {
			spanRef.current = element;
			assignRef(ref, element);
		},
		[ref],
	);

	useEffect(() => {
		const element = spanRef.current;
		if (!active || !supported || !element) return undefined;
		const Observer = element.ownerDocument.defaultView?.ResizeObserver;
		if (!Observer) {
			setFits(false);
			return undefined;
		}
		const observer = new Observer(() => {
			observer.disconnect();
			setFits(fitsComposited(element));
		});
		observer.observe(element);
		if (cloneRef.current) observer.observe(cloneRef.current);
		return () => {
			observer.disconnect();
		};
	}, [active, supported, className]);

	const composited = active && supported && fits;
	const mode = active ? (composited ? "composited" : "fallback") : "inactive";
	const copiesInks = composited && variant === "strong" && FIZZY_LAKE_TYPE;
	const [hasEmoji, setHasEmoji] = useState(false);
	useEffect(() => {
		const element = spanRef.current;
		if (!copiesInks || !element) return;
		setHasEmoji(EMOJI.test(ownText(element, cloneRef.current)));
	}, [copiesInks, children]);

	return (
		<span
			ref={setSpan}
			id={id}
			dir={dir}
			data-cds="ShimmerText"
			data-shimmering={active ? "true" : "false"}
			data-variant={variant === "default" ? undefined : variant}
			data-shimmer-mode={mode === "fallback" ? "fallback" : undefined}
			data-cds-shimmer-copy-inks={copiesInks && !hasEmoji ? "" : undefined}
			className={
				mode === "composited" ? (className === undefined ? "relative" : `relative ${className}`) : className
			}
			style={modeStyle(mode, delay, paused)}
		>
			{children}
			{mode === "composited" && (
				<span ref={cloneRef} data-cds-shimmer-clone="" aria-hidden="true" data-find-omitted="" inert>
					{children}
				</span>
			)}
		</span>
	);
}
