import {type ReactNode, useEffect, useRef, useState} from "react";

import {findScrollContainer, toObserverRoot} from "./scroll-container";

/**
 * claude.ai/code's compact list-page header (Scheduled tasks, Artifacts, Projects): a 24/32 serif
 * title at y=32 (y=48 below sm, past the sidebar trigger), then a row with the tabs on the left and the toolbar right-aligned on it.
 *
 * With `sticky`, it renders upstream's cds Page header band: an `h-0` sentinel, then a
 * `sticky top-0 bg-page` band (z 20) holding the content-width `box` (with `pb-6`) and a
 * `data-cds-part=fade` strip that hangs 32px below it. The strip stays invisible until the
 * sentinel scrolls out of the scroller, i.e. until the band pins over scrolled content. The sentinel
 * (and so the band) rises over RootTopRow's empty 36px (48px phone) spacer and pads it back, so pinned it keeps the
 * whitespace upstream's 64px title row has above the title instead of pinning the title flush at the top.
 */
export function CodePageHeader({
	title,
	subtitle,
	tabs,
	toolbar,
	sticky,
	children,
}: {
	title: string;
	/** A 13px muted caption under the title, such as a list's item count. */
	subtitle?: ReactNode;
	tabs?: ReactNode;
	toolbar?: ReactNode;
	/** Pin the header with a scroll fade; `box` is the content-width wrapper's classes. */
	sticky?: {box: string};
	/** Extras under the header, such as a live status line. */
	children?: ReactNode;
}) {
	const header = (
		<header className={sticky === undefined ? "flex flex-col pb-4 sm:-mt-1" : "flex flex-col sm:-mt-1"}>
			<h1 className="min-w-0 font-voice text-[24px]/[32px] font-medium text-primary">{title}</h1>
			{subtitle !== undefined && <p className="mt-1 text-[13px] text-t6">{subtitle}</p>}
			{(tabs !== undefined || toolbar !== undefined) && (
				<div className="mt-5 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
					{tabs}
					{toolbar !== undefined && (
						<div className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
							{toolbar}
						</div>
					)}
				</div>
			)}
			{children}
		</header>
	);
	if (sticky === undefined) return header;
	return <StickyBand box={sticky.box}>{header}</StickyBand>;
}

/** Upstream's `page-fade-t` strip; `transition-[opacity,visibility]` runs at the default 150ms (upstream's duration-fast). */
const FADE_CLASS = "page-fade-t absolute inset-x-0 -bottom-8 h-8 transition-[opacity,visibility]";

function StickyBand({box, children}: {box: string; children: ReactNode}) {
	const sentinelRef = useRef<HTMLDivElement>(null);
	const [scrolled, setScrolled] = useState(false);
	useEffect(() => {
		const sentinel = sentinelRef.current;
		if (sentinel === null || typeof IntersectionObserver === "undefined") return undefined;
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries.at(-1);
				if (entry !== undefined) setScrolled(!entry.isIntersecting);
			},
			{root: toObserverRoot(findScrollContainer(sentinel))},
		);
		observer.observe(sentinel);
		return () => {
			observer.disconnect();
		};
	}, []);
	return (
		<>
			<div ref={sentinelRef} className="h-0 -mt-9 max-sm:-mt-12" />
			<div className="sticky top-0 bg-page" style={{zIndex: 20}}>
				<div className={`${box} pt-9 max-sm:pt-12 pb-6`}>{children}</div>
				<div
					aria-hidden="true"
					data-cds-part="fade"
					className={`${FADE_CLASS} ${scrolled ? "visible opacity-100" : "invisible opacity-0"}`}
				/>
			</div>
		</>
	);
}
