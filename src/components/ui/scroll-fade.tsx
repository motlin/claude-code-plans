import type {ComponentPropsWithRef} from "react";

const STRIP_COLOR = "[--scroll-fade-strip-color:var(--epitaxy-transcript-surface,var(--color-surface-1))]";

type ScrollFadeProps = ComponentPropsWithRef<"div"> & Readonly<{topFade?: boolean; bottomFade?: boolean}>;

/**
 * Upstream's ScrollFade (`c4a70913c` export `n`): a vertical scroller whose sticky surface strips fade content
 * in under its top 32px and out over its bottom 48px. The heights are set only where scroll timelines exist,
 * so elsewhere the strips collapse to nothing.
 */
export function ScrollFade({className, children, topFade = true, bottomFade = true, ...rest}: ScrollFadeProps) {
	const rootClass = [
		"overflow-y-auto",
		topFade && "supports-[animation-timeline:scroll()]:[--epitaxy-top-fade-height:32px]",
		bottomFade && "supports-[animation-timeline:scroll()]:[--epitaxy-bottom-fade-height:48px]",
		className,
	]
		.filter(Boolean)
		.join(" ");
	return (
		<div className={rootClass} {...rest}>
			{topFade && (
				<div
					aria-hidden="true"
					data-scroll-fade="top"
					className={`scroll-fade-strip-top [--scroll-fade-size:var(--epitaxy-top-fade-height)] ${STRIP_COLOR}`}
				/>
			)}
			{children}
			{bottomFade && (
				<div
					aria-hidden="true"
					data-scroll-fade="bottom"
					className={`scroll-fade-strip-bottom [--scroll-fade-size:var(--epitaxy-bottom-fade-height)] ${STRIP_COLOR}`}
				/>
			)}
		</div>
	);
}
