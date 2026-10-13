import {useEffect, useRef, useState, type ReactNode} from "react";

const ACTIVE_ROW = "a[data-row-main-button][data-selected='focused']";

/** Scroll `scroller` the least distance that shows all of `row`, as `block: "nearest"` does. */
function revealRow(scroller: HTMLElement, row: HTMLElement): void {
	const view = scroller.getBoundingClientRect();
	const rect = row.getBoundingClientRect();
	if (rect.top < view.top) scroller.scrollTop -= view.top - rect.top;
	else if (rect.bottom > view.bottom) scroller.scrollTop += rect.bottom - view.bottom;
}

/**
 * The sidebar's scrolling region (upstream `.dframe-nav-scroll`). Once scrolled
 * away from the top it sets `data-scrolled`, which fades the top 12px out. Like
 * upstream, it scrolls the open session's row into view when that session
 * changes, waiting for the row if the list has not rendered it yet.
 */
export function NavScroll({activeKey = null, children}: {activeKey?: string | null; children: ReactNode}) {
	const [scrolled, setScrolled] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const scroller = ref.current;
		if (scroller === null || activeKey === null) return undefined;
		const reveal = (): boolean => {
			const row = scroller.querySelector<HTMLElement>(ACTIVE_ROW);
			if (row === null) return false;
			revealRow(scroller, row);
			return true;
		};
		if (reveal()) return undefined;
		const observer = new MutationObserver(() => {
			if (reveal()) observer.disconnect();
		});
		observer.observe(scroller, {childList: true, subtree: true, attributeFilter: ["data-selected"]});
		return () => {
			observer.disconnect();
		};
	}, [activeKey]);

	return (
		<div
			ref={ref}
			data-testid="nav-scroll"
			data-scrolled={scrolled ? "" : undefined}
			onScroll={(event) => {
				setScrolled(event.currentTarget.scrollTop > 0);
			}}
			className="relative -ml-1 -mr-2 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pl-1 [scrollbar-gutter:stable] [scrollbar-width:thin] data-[scrolled]:[mask-image:linear-gradient(transparent_0px,#000_12px)]"
		>
			{children}
		</div>
	);
}
