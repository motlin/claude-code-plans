import {useEffect, useRef, useState, type ReactNode} from "react";

const ACTIVE_ROW = "a[data-row-main-button][data-selected='focused']";

/** Scroll `scroller` the least distance that shows all of `row`, as `block: "nearest"` does. */
function revealRow(scroller: HTMLElement, row: HTMLElement): void
{
	const view = scroller.getBoundingClientRect();
	const rect = row.getBoundingClientRect();
	if (rect.top < view.top) scroller.scrollTop -= view.top - rect.top;
	else if (rect.bottom > view.bottom) scroller.scrollTop += rect.bottom - view.bottom;
}

/**
 * The sidebar's scrolling region (upstream `.dframe-nav-scroll`). Once scrolled
 * away from the top it sets `data-scrolled` on its parent `.df-nav-scroll-box`, whose
 * ::after draws upstream's 1px hairline under the header. Its right padding
 * tops the measured scrollbar lane up to 8px, as upstream's does. Like
 * upstream, it scrolls the open session's row into view when that session
 * changes, waiting for the row if the list has not rendered it yet.
 */
export function NavScroll({activeKey = null, children}: {activeKey?: string | null; children: ReactNode})
{
	const [scrolled, setScrolled] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() =>
	{
		const scroller = ref.current;
		if (scroller === null || activeKey === null) return undefined;
		const reveal = (): boolean =>
		{
			const row = scroller.querySelector<HTMLElement>(ACTIVE_ROW);
			if (row === null) return false;
			revealRow(scroller, row);
			return true;
		};
		if (reveal()) return undefined;
		const observer = new MutationObserver(() =>
		{
			if (reveal()) observer.disconnect();
		});
		observer.observe(
			scroller,
			{
				childList: true,
				subtree: true,
				attributeFilter: ["data-selected"],
			},
		);
		return () =>
		{
			observer.disconnect();
		};
	}, [activeKey]);

	useEffect(() =>
	{
		const scroller = ref.current;
		if (scroller === null) return undefined;
		// Upstream measures the scrollbar's width so the right padding only tops it up to 8px.
		const measure = (): void =>
		{
			scroller.style.setProperty("--df-nav-scrollbar-lane", `${scroller.offsetWidth - scroller.clientWidth}px`);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(measure);
		observer.observe(scroller);
		return () =>
		{
			observer.disconnect();
		};
	}, []);

	useEffect(() =>
	{
		ref.current?.parentElement?.toggleAttribute("data-scrolled", scrolled);
	}, [scrolled]);

	return (
		<div
			ref={ref}
			data-testid="nav-scroll"
			onScroll={(event) =>
			{
				// Upstream `L$`: `l(scrollTop > 2)`.
				setScrolled(event.currentTarget.scrollTop > 2);
			}}
			className="relative -ml-1 -mr-2 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pl-1 pb-2 pe-[max(0px,calc(8px-var(--df-nav-scrollbar-lane,0px)))] scroll-pt-1 [scrollbar-gutter:stable] [scrollbar-width:thin]"
		>
			{children}
		</div>
	);
}
