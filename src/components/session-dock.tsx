import {ArrowDown, ChevronDown} from "lucide-react";
import {useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject} from "react";
import {findScrollContainer} from "./scroll-container";
import {SESSION_DOCK_COLUMN_CLASS} from "./dock-tokens";

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

	const scrollToBottom = useCallback((event: MouseEvent<HTMLButtonElement>) => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		// The pill becomes inert near the end. Move its focus first so that change
		// does not interrupt the browser's smooth scroll or drop keyboard context.
		if (scroller instanceof HTMLElement && document.activeElement === event.currentTarget) {
			if (!scroller.hasAttribute("tabindex")) scroller.tabIndex = -1;
			scroller.focus({preventScroll: true});
		}
		scroller.scrollTo({top: scroller.scrollHeight, behavior: "smooth"});
	}, []);

	/** Upstream's needs-input pill scrolls to the waiting question card rather than the end. */
	const scrollToRequest = useCallback(
		(event: MouseEvent<HTMLButtonElement>) => {
			const card = scrollerRef.current?.querySelector('[data-approval-presentation="card"]');
			if (card === null || card === undefined) scrollToBottom(event);
			else card.scrollIntoView({behavior: "smooth", block: "center"});
		},
		[scrollToBottom],
	);

	return {awayFromBottom, scrollToBottom, scrollToRequest};
}

const FADE = "transition-opacity duration-150";

/**
 * The bottom of the chat tile, modelled on claude.ai/code's composer dock: one
 * column on the transcript's measure holding the scroll-to-bottom pill and the
 * composer. The circular 36px pill is upstream's translucent blurred button
 * (dark oklab(.243 0 0/.8), 0.5px white/10 border, 8px blur, a luminosity-
 * blended arrow) with no tooltip. It sits 20px above the dock, centered, and fades in once the reader is away from
 * the end of the transcript. While a question waits it is upstream's 24px
 * "Needs your input" pill instead, which scrolls to the question's card.
 */
export function SessionDock({
	anchorRef,
	needsInput = false,
	children,
}: {
	anchorRef: RefObject<HTMLElement | null>;
	/** A question card waits for the reader's answer. */
	needsInput?: boolean;
	children?: ReactNode;
}) {
	const {awayFromBottom, scrollToBottom, scrollToRequest} = useScrollToBottom(anchorRef);

	if (needsInput) {
		return (
			<div className={SESSION_DOCK_COLUMN_CLASS}>
				<button
					type="button"
					aria-label="Needs your input. Scroll to the request"
					aria-hidden={awayFromBottom ? undefined : true}
					inert={!awayFromBottom}
					tabIndex={awayFromBottom ? 0 : -1}
					onClick={scrollToRequest}
					className={`absolute -top-8 left-1/2 z-[1] inline-flex h-6 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded bg-surface-3 px-1.5 text-secondary shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(0_0_0/0.05)] ${FADE} ${
						awayFromBottom ? "opacity-100" : "pointer-events-none opacity-0"
					}`}
				>
					<span aria-hidden="true" className="size-[6px] shrink-0 rounded-full bg-fill-accent" />
					<span className="text-footnote">Needs your input</span>
					<ChevronDown aria-hidden="true" className="size-3" />
				</button>
				{children}
			</div>
		);
	}

	return (
		<div className={SESSION_DOCK_COLUMN_CLASS}>
			<button
				type="button"
				aria-label="Scroll to bottom"
				aria-hidden={awayFromBottom ? undefined : true}
				inert={!awayFromBottom}
				tabIndex={awayFromBottom ? 0 : -1}
				onClick={scrollToBottom}
				className={`absolute bottom-full mb-5 left-1/2 -translate-x-1/2 z-[1] inline-flex size-9 items-center justify-center rounded-full border-[0.5px] border-white/10 bg-[oklab(0.243_0_0/0.8)] p-1 text-secondary backdrop-blur-[8px] not-dark:border-primary/10 not-dark:bg-white/80 not-dark:shadow-[0_2px_4px_rgb(11_11_11/0.07),0_6px_16px_rgb(11_11_11/0.08)] cursor-pointer transition-opacity duration-150 ${
					awayFromBottom ? "opacity-100" : "opacity-0 pointer-events-none"
				}`}
			>
				<ArrowDown className="size-5 mix-blend-luminosity" aria-hidden="true" />
			</button>
			{children}
		</div>
	);
}
