import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";

import {
	DEFAULT_STEP_PX,
	type FoldGeometry,
	type FoldState,
	foldPass,
	MAX_PASSES,
	overflowShortfall,
} from "../lib/titlebar-fold";

/** Marks the title whose natural and visible widths drive the fold. */
const TITLEBAR_TITLE_ATTRIBUTE = "data-titlebar-title";
/** Marks the inline pane toggles' group, whose first toggle sizes one fold step. */
export const TITLEBAR_TOGGLES_ATTRIBUTE = "data-titlebar-toggles";

/** Upstream `Jt`'s geometry read: the row's children, gaps, overflow, title widths and step size. */
function readFoldGeometry(root: HTMLElement, title: HTMLElement, previousStep: number): FoldGeometry | null {
	if (title.clientWidth === 0) return null;
	const view = root.ownerDocument.defaultView ?? window;
	const children = Array.from(root.children).filter((child): child is HTMLElement => {
		if (!(child instanceof view.HTMLElement)) return false;
		const style = view.getComputedStyle(child);
		return style.position !== "absolute" && style.display !== "none";
	});
	const measured = children.map((child) => ({child, rect: child.getBoundingClientRect()}));
	const rects = measured.map(({rect}) => rect);
	const rootStyle = view.getComputedStyle(root);
	const rtl = rootStyle.direction === "rtl";
	const start = (rect: DOMRect) => (rtl ? -rect.right : rect.left);
	const end = (rect: DOMRect) => (rtl ? -rect.left : rect.right);
	let freePx = 0;
	let otherPx = 0;
	let leadEnd: number | undefined;
	let previous: DOMRect | undefined;
	for (const {child, rect} of measured) {
		if (previous !== undefined) freePx += Math.max(0, start(rect) - end(previous));
		previous = rect;
		if (child.contains(title)) leadEnd = end(rect);
		else otherPx += rect.width;
	}
	const paddingEnd = Number.parseFloat(rootStyle.paddingInlineEnd) || 0;
	const rootLeft = root.getBoundingClientRect().left + root.clientLeft;
	const last = rtl
		? rects.reduce<DOMRect | undefined>(
				(best, rect) => (best === undefined || end(rect) > end(best) ? rect : best),
				undefined,
			)
		: rects.at(-1);
	const shortfallPx = overflowShortfall({
		titleEnd: end(title.getBoundingClientRect()),
		leadEnd,
		lastEnd: last === undefined ? undefined : end(last),
		rowEnd: rtl ? -(rootLeft + paddingEnd) : rootLeft + root.clientWidth - paddingEnd,
	});
	let stepPx = previousStep;
	const first = root.querySelector(`[${TITLEBAR_TOGGLES_ATTRIBUTE}]`)?.firstElementChild;
	if (first instanceof view.HTMLElement && first.parentElement !== null) {
		stepPx = first.offsetWidth + (Number.parseFloat(view.getComputedStyle(first.parentElement).columnGap) || 0);
	}
	return {
		freePx,
		otherPx,
		shortfallPx,
		titleClientPx: title.clientWidth,
		titleNaturalPx: title.scrollWidth,
		rootPx: root.clientWidth,
		stepPx,
	};
}

const REST: FoldState = {hidden: 0, compact: false, pillBudgetAtCollapse: -Infinity, compactedThisBurst: false};

/**
 * Upstream's measured titlebar fold (`Jt`): a ResizeObserver reads the row,
 * compacts the origin pills once the title truncates with no free space, then
 * hides trail buttons one step at a time while the title would drop under
 * 100px, re-measuring after each change up to 8 passes.
 */
export function useTitlebarFold(maxHidden: number) {
	const ref = useRef<HTMLDivElement>(null);
	const [result, setResult] = useState({hiddenCount: 0, pillsCompact: false});
	const fold = useRef(REST);
	const step = useRef(DEFAULT_STEP_PX);
	const passes = useRef(0);

	const measure = useCallback((): boolean => {
		const root = ref.current;
		const title = root?.querySelector<HTMLElement>(`[${TITLEBAR_TITLE_ATTRIBUTE}]`);
		if (root == null || title == null) return false;
		const geometry = readFoldGeometry(root, title, step.current);
		if (geometry === null) return false;
		step.current = geometry.stepPx;
		const previous = fold.current;
		const next = foldPass(geometry, previous, maxHidden);
		fold.current = next;
		if (next.hidden === previous.hidden && next.compact === previous.compact) return false;
		setResult({hiddenCount: next.hidden, pillsCompact: next.compact});
		return true;
	}, [maxHidden]);

	useLayoutEffect(() => {
		passes.current += 1;
		if (passes.current > MAX_PASSES || !measure()) {
			passes.current = 0;
			fold.current = {...fold.current, compactedThisBurst: false};
		}
	}, [result, measure]);

	useEffect(() => {
		const root = ref.current;
		if (root === null || typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(() => {
			measure();
		});
		const targets = [
			root,
			...Array.from(root.children),
			root.querySelector(`[${TITLEBAR_TOGGLES_ATTRIBUTE}]`),
			root.querySelector(`[${TITLEBAR_TITLE_ATTRIBUTE}]`),
		];
		for (const target of targets) if (target !== null) observer.observe(target);
		return () => {
			observer.disconnect();
		};
	}, [measure]);

	return {ref, ...result};
}
