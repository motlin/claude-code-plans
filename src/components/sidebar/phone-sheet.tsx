import {useRouter} from "@tanstack/react-router";
import {useEffect, useRef, useState, type PointerEvent, type Ref} from "react";
import {shouldClose, swipeIntent} from "../../lib/sheet-swipe";
import {PHONE_SIDEBAR_TOGGLE} from "../../lib/top-left-clearance";
import {Sidebar} from "./Sidebar";
import {SidebarToggleIcon} from "./primitives";

const PHONE_SHEET_ID = "sidebar-sheet";

/** The sheet's slide transition (`.phone-sheet[data-open]` in globals.css), after which a dismissal refocuses the trigger. */
export const PHONE_SHEET_TRANSITION_MS = 300;

/** claude.ai/code's phone "Show sidebar" trigger: a 32px target, in the titlebar's lead slot (see `topLeftClearance`). */
export function PhoneSheetTrigger({
	open,
	onOpen,
	ref,
}: {
	open: boolean;
	onOpen: () => void;
	ref?: Ref<HTMLButtonElement>;
}) {
	return (
		<button
			ref={ref}
			type="button"
			aria-label="Show sidebar"
			aria-expanded={open}
			aria-controls={PHONE_SHEET_ID}
			data-focus-region="navigation"
			onClick={onOpen}
			style={{
				left: `${PHONE_SIDEBAR_TOGGLE.left}px`,
				top: `${PHONE_SIDEBAR_TOGGLE.top}px`,
				width: `${PHONE_SIDEBAR_TOGGLE.size}px`,
				height: `${PHONE_SIDEBAR_TOGGLE.size}px`,
			}}
			className="fixed z-40 flex items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover [&_svg]:h-4 [&_svg]:w-4"
		>
			<SidebarToggleIcon />
		</button>
	);
}

interface SwipeStart {
	x: number;
	y: number;
	time: number;
	pointerId: number;
	dragging: boolean;
}

/**
 * The phone sidebar sheet: a full-screen modal dialog that slides in from the left, closes on
 * Escape, navigation, browser Back and a leftward swipe, and moves focus to its Close button.
 * The user's own dismissals (Close, Escape, swipe) call `onDismiss`, so focus can return to the
 * trigger; navigation closes call `onClose` and leave focus to the router.
 */
export function PhoneSheet({open, onClose, onDismiss}: {open: boolean; onClose: () => void; onDismiss: () => void}) {
	const router = useRouter();
	const sheetRef = useRef<HTMLDivElement>(null);
	const swipe = useRef<SwipeStart | null>(null);
	const [drag, setDrag] = useState<number | null>(null);

	useEffect(() => {
		if (!open) return undefined;
		sheetRef.current?.querySelector<HTMLElement>("[data-phone-sheet-close]")?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onDismiss();
		};
		const unsubscribe = router.subscribe("onBeforeNavigate", onClose);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("popstate", onClose);
		window.addEventListener("pagehide", onClose);
		return () => {
			unsubscribe();
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("popstate", onClose);
			window.removeEventListener("pagehide", onClose);
		};
	}, [open, onClose, onDismiss, router]);

	const resetSwipe = () => {
		swipe.current = null;
		setDrag(null);
	};

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (!open || event.pointerType === "mouse" || !event.isPrimary) return;
		if (event.target instanceof Element && event.target.closest("[data-no-sheet-swipe]")) return;
		swipe.current = {
			x: event.clientX,
			y: event.clientY,
			time: event.timeStamp,
			pointerId: event.pointerId,
			dragging: false,
		};
	};

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const start = swipe.current;
		if (!start || start.pointerId !== event.pointerId) return;
		const dx = start.x - event.clientX;
		const dy = event.clientY - start.y;
		if (!start.dragging) {
			const intent = swipeIntent(dx, dy);
			if (intent === "pending") return;
			if (intent === "abandon") {
				swipe.current = null;
				return;
			}
			start.dragging = true;
		}
		setDrag(Math.max(0, dx));
	};

	const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
		const start = swipe.current;
		if (!start || start.pointerId !== event.pointerId) return;
		if (start.dragging) {
			const distance = Math.max(0, start.x - event.clientX);
			const elapsed = Math.max(1, event.timeStamp - start.time);
			const width = sheetRef.current?.getBoundingClientRect().width ?? window.innerWidth;
			if (shouldClose(distance, width, distance / elapsed)) onDismiss();
		}
		resetSwipe();
	};

	const dragging = drag !== null;

	return (
		<div
			ref={sheetRef}
			id={PHONE_SHEET_ID}
			role="dialog"
			aria-modal="true"
			aria-label="Sidebar"
			tabIndex={-1}
			inert={!open}
			data-open={open ? "" : undefined}
			data-phone-sheet-dragging={dragging ? "" : undefined}
			style={dragging ? {"--df-phone-sheet-drag": `${-drag}px`} : undefined}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={resetSwipe}
			className="phone-sheet"
		>
			<Sidebar collapsed={false} onPhoneSheetClose={onDismiss} />
		</div>
	);
}
