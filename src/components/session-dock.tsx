import {ArrowDown} from "lucide-react";
import {useCallback, useEffect, useRef, useState, type ReactNode, type RefObject} from "react";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import {findScrollContainer} from "./transcript-history-loader";

/** How far above the end the reader must be before the pill appears. */
const AWAY_FROM_BOTTOM_PIXELS = 100;

function useScrollToBottom(anchorRef: RefObject<HTMLElement | null>) {
	const [awayFromBottom, setAwayFromBottom] = useState(false);
	const scrollerRef = useRef<Element | null>(null);

	useEffect(() => {
		const scroller = findScrollContainer(anchorRef.current);
		scrollerRef.current = scroller;
		function check() {
			const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
			setAwayFromBottom(distance > AWAY_FROM_BOTTOM_PIXELS);
		}
		check();
		scroller.addEventListener("scroll", check, {passive: true});
		window.addEventListener("resize", check, {passive: true});
		return () => {
			scroller.removeEventListener("scroll", check);
			window.removeEventListener("resize", check);
			scrollerRef.current = null;
		};
	}, [anchorRef]);

	const scrollToBottom = useCallback(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		scroller.scrollTo({top: scroller.scrollHeight, behavior: "smooth"});
	}, []);

	return {awayFromBottom, scrollToBottom};
}

/**
 * The bottom of the chat tile, modelled on claude.ai/code's composer dock: one
 * column on the transcript's measure holding the scroll-to-bottom pill and the
 * composer. The circular 36px pill has no tooltip and
 * sits 32px above the dock, centered, and fades in once the reader is away from
 * the end of the transcript.
 */
export function SessionDock({anchorRef, children}: {anchorRef: RefObject<HTMLElement | null>; children?: ReactNode}) {
	const {awayFromBottom, scrollToBottom} = useScrollToBottom(anchorRef);

	return (
		<div className={`${CHAT_COLUMN_CLASS} relative flex flex-col gap-1.5`}>
			<button
				type="button"
				aria-label="Scroll to bottom"
				aria-hidden={awayFromBottom ? undefined : true}
				inert={!awayFromBottom}
				tabIndex={awayFromBottom ? 0 : -1}
				onClick={scrollToBottom}
				className={`absolute -top-8 left-1/2 -translate-x-1/2 z-[1] inline-flex size-9 items-center justify-center rounded-full bg-surface-3 p-1 text-secondary shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(0_0_0/0.05)] cursor-pointer transition-opacity duration-150 ${
					awayFromBottom ? "opacity-100" : "opacity-0 pointer-events-none"
				}`}
			>
				<ArrowDown className="size-5" aria-hidden="true" />
			</button>
			{children}
		</div>
	);
}
