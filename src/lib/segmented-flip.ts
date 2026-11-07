import {isMotionReduced} from "./reduced-motion";

/*
 * Ports of upstream's cds SegmentedControl thumb helpers (shared-frame bundle): `LL` measures the
 * checked radio in the group's unscaled px, `kO` applies the rect to the thumb as a transform-only
 * FLIP. See .llm/upstream-sync/features/segmented-control-flip-thumb.md.
 */

export interface ThumbRect {
	left: number;
	width: number;
}

/** Upstream `Vf`: the group's untransformed border-box width. */
function unscaledWidth(group: HTMLElement): number {
	const style = getComputedStyle(group);
	const width = parseFloat(style.width);
	if (style.boxSizing !== "content-box") return width;
	return (
		width +
		parseFloat(style.paddingLeft) +
		parseFloat(style.paddingRight) +
		parseFloat(style.borderLeftWidth) +
		parseFloat(style.borderRightWidth)
	);
}

/** Upstream `ag`: the group's on-screen width and whether an ancestor transform scales it. */
export function groupScale(group: HTMLElement): {scale: number; scaled: boolean; width: number} {
	const width = group.getBoundingClientRect().width;
	const ratio = width / unscaledWidth(group);
	const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
	return {scale, scaled: scale !== 1, width};
}

/**
 * Upstream `LL`: the radio's group-relative rect with each edge rounded to device pixels, divided by the
 * group's scale so the thumb is placed in unscaled px under the dialog's open zoom. Upstream falls back to
 * offsetLeft when unscaled; locally icon-only radios sit in a positioned Tooltip wrapper, so the rect path
 * is kept at scale 1 too.
 */
export function measureThumbRect(radio: HTMLElement, group: HTMLElement): ThumbRect {
	const dpr = window.devicePixelRatio || 1;
	const round = (value: number) => Math.round(value * dpr) / dpr;
	const {scale} = groupScale(group);
	const groupRect = group.getBoundingClientRect();
	const radioRect = radio.getBoundingClientRect();
	const left = round(radioRect.left) - round(groupRect.left);
	const width = round(radioRect.right) - round(radioRect.left);
	return {left: left / scale, width: width / scale};
}

function cssDurationMs(style: CSSStyleDeclaration, name: string): number {
	const value = style.getPropertyValue(name).trim();
	const unit = value.endsWith("ms") ? 1 : value.endsWith("s") ? 1000 : 0;
	return Math.max(0, parseFloat(value) * unit) || 0;
}

function animations(element: HTMLElement): Animation[] {
	return typeof element.getAnimations === "function" ? element.getAnimations() : [];
}

function canAnimate(element: HTMLElement): boolean {
	return typeof element.animate === "function" && typeof element.getAnimations === "function";
}

/**
 * Upstream `kO`: reads (current visual rect, tokens) now and returns the write. A null or zero-width rect
 * hides the thumb and clears the `data-flip-at` cache; an unchanged rect is a no-op. Otherwise the thumb
 * jumps to its new width/translateX and, unless this is the first measure, reduced motion is on, or a
 * correction (resize re-measure) lands with no animation running, animates transform alone from where it
 * was drawn: `translateX(prev) scaleX(prevW/newW)` → `translateX(new) scaleX(1)` about origin-left.
 */
export function applyThumb(
	thumb: HTMLElement,
	group: HTMLElement,
	rect: ThumbRect | null,
	{correction = false}: {correction?: boolean} = {},
): () => void {
	if (rect === null || rect.width <= 0) {
		const running = animations(thumb);
		return () => {
			for (const animation of running) animation.cancel();
			thumb.style.visibility = "";
			thumb.style.willChange = "";
			delete thumb.dataset["flipAt"];
		};
	}
	const flipAt = `${rect.left},${rect.width}`;
	const previous = thumb.dataset["flipAt"];
	if (previous === flipAt) return () => {};
	const from = thumb.getBoundingClientRect();
	const groupLeft = group.getBoundingClientRect().left;
	const style = getComputedStyle(thumb);
	const duration = cssDurationMs(style, "--cds-dur-base");
	const easing = style.getPropertyValue("--cds-ease-snap").trim() || "linear";
	const translucent = /^rgba\(|\//.test(style.backgroundColor);
	const running = animations(thumb);
	const snapCorrection = correction && !running.some((animation) => animation.playState === "running");
	return () => {
		for (const animation of running) animation.cancel();
		thumb.dataset["flipAt"] = flipAt;
		thumb.style.width = `${rect.width}px`;
		thumb.style.transform = `translateX(${rect.left}px)`;
		thumb.style.visibility = "inherit";
		if (!translucent) thumb.style.willChange = "";
		if (previous === undefined || !canAnimate(thumb) || isMotionReduced() || snapCorrection) return;
		try {
			thumb.animate(
				{
					transform: [
						`translateX(${from.left - groupLeft}px) scaleX(${from.width / rect.width})`,
						`translateX(${rect.left}px) scaleX(1)`,
					],
				},
				{duration, easing},
			);
			if (duration > 0) thumb.style.willChange = translucent ? "transform" : "";
		} catch {
			// Upstream swallows WAAPI failures; the thumb is already at its new position.
		}
	};
}
