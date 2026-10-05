import {useState, type ReactNode} from "react";

/**
 * The sidebar's scrolling region (upstream `.dframe-nav-scroll`). Once scrolled
 * away from the top it sets `data-scrolled`, which fades the top 12px out.
 */
export function NavScroll({children}: {children: ReactNode}) {
	const [scrolled, setScrolled] = useState(false);

	return (
		<div
			data-testid="nav-scroll"
			data-scrolled={scrolled ? "" : undefined}
			onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
			className="relative -ml-1 -mr-2 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pl-1 [scrollbar-gutter:stable] [scrollbar-width:thin] data-[scrolled]:[mask-image:linear-gradient(transparent_0px,#000_12px)]"
		>
			{children}
		</div>
	);
}
