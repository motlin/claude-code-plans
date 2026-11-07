import {type ReactNode, useLayoutEffect, useRef} from "react";
import {HOME_COLUMN} from "./home-column";

/**
 * Upstream's /code chat-card titlebar: a 32px row whose muted 13px "New session" h1 starts after
 * the sidebar toggle's clearance on a phone or collapsed desktop.
 */
export function HomeTitlebar() {
	return (
		<header className="flex h-8 shrink-0 items-center ps-[var(--tile-title-start,0px)] pe-12">
			<h1 className="truncate ps-2.5 text-[13px]/[19px] font-medium text-ink-muted">New session</h1>
		</header>
	);
}

/**
 * Upstream's /code landing shell: the "New session" titlebar, then a scrolling body and a bottom
 * dock in an 840px centered column with 32px/40px gutters (16px/24px once the tile is ≤560px).
 */
export function HomePage({children, dock}: Readonly<{children?: ReactNode; dock?: ReactNode}>) {
	const bodyRef = useRef<HTMLDivElement>(null);
	useLandingOverflows(bodyRef);
	return (
		<div className="@container/tile-slot flex h-full min-h-0 flex-col">
			<HomeTitlebar />
			<div className={`flex min-h-0 flex-1 flex-col ${HOME_COLUMN}`}>
				<div
					ref={bodyRef}
					data-home-body
					data-scroll-restoration-id="main"
					className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto u-hidden-scrollbar scroll-py-(--scroll-fade-size) data-[landing-overflows]:scroll-fade-y"
				>
					{children}
				</div>
			</div>
			{dock === undefined ? null : <div className={`shrink-0 ${HOME_COLUMN}`}>{dock}</div>}
		</div>
	);
}

/**
 * Upstream's landing column (`qw`, attribute `oB`): `data-landing-overflows` while the column is taller than
 * its viewport, so `scroll-fade-y` (and its mask) applies only then. The `+ 1` and the ResizeObserver match
 * upstream's code-view setter (`scrollHeight > clientHeight + 1`).
 */
function useLandingOverflows(ref: Readonly<{current: HTMLDivElement | null}>) {
	useLayoutEffect(() => {
		const element = ref.current;
		if (element === null || typeof ResizeObserver === "undefined") return undefined;
		const sync = () => {
			element.toggleAttribute("data-landing-overflows", element.scrollHeight > element.clientHeight + 1);
		};
		sync();
		const observer = new ResizeObserver(sync);
		observer.observe(element);
		if (element.firstElementChild !== null) observer.observe(element.firstElementChild);
		return () => {
			observer.disconnect();
		};
	}, [ref]);
}
