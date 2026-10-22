import {Popover as BasePopover} from "@base-ui/react/popover";
import {type ComponentProps, createContext, type ReactNode, useContext, useId, useMemo, useState} from "react";

import {useSheetPresentation} from "./sheet-presentation";

interface PopoverSheet {
	sheet: boolean;
	treeId: string;
}

/** Whether the enclosing root latched a bottom-sheet presentation at open, and its sheet tree id. */
const PopoverSheetContext = createContext<PopoverSheet>({sheet: false, treeId: ""});

/**
 * Upstream's `Bl` → `r3`: tracks the root's open state (controlled or not) and runs the sheet gate with
 * `closable = !(open !== undefined && !consumerHandlesOpenChange)`, latched from open through the exit.
 */
function PopoverRoot(props: ComponentProps<typeof BasePopover.Root>) {
	const {open, defaultOpen, onOpenChange, onOpenChangeComplete} = props;
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
	const {sheet, onOpenChangeComplete: releaseLatch} = useSheetPresentation(open ?? uncontrolledOpen, {
		closable: !(open !== undefined && onOpenChange === undefined),
	});
	const treeId = useId();
	const context = useMemo(() => ({sheet, treeId}), [sheet, treeId]);
	return (
		<PopoverSheetContext.Provider value={context}>
			<BasePopover.Root
				{...props}
				onOpenChange={(nextOpen, details) => {
					setUncontrolledOpen(nextOpen);
					onOpenChange?.(nextOpen, details);
				}}
				onOpenChangeComplete={(completedOpen) => {
					releaseLatch(completedOpen);
					onOpenChangeComplete?.(completedOpen);
				}}
			/>
		</PopoverSheetContext.Provider>
	);
}

/** Upstream's cds `Ql`: the gated root and the Base UI trigger, with `PopoverContent` as the surface. */
export const Popover = {Root: PopoverRoot, Trigger: BasePopover.Trigger};

export interface PopoverContentProps {
	children: ReactNode;
	side?: ComponentProps<typeof BasePopover.Positioner>["side"];
	align?: ComponentProps<typeof BasePopover.Positioner>["align"];
	sideOffset?: number;
	/** Lands on the anchored Popup, or on the sheet's body wrapper (minus its sizing and radius). */
	className?: string;
	/**
	 * Upstream's `structurallyAnchored` (`nG`): the popup declines focus and is anchored to a text field, so it
	 * stays anchored even where the bottom-sheet gate would otherwise open a sheet.
	 */
	structurallyAnchored?: boolean;
}

/* Upstream's gM: `duration-sheet ease-out`, which compute to 0.3s and the phone-sheet curve. */
const SHEET_MOTION = "duration-[300ms] ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none";

/** Upstream's PopoverSheetBackdrop: the scrim, fading with the popup's enter and exit. */
const SHEET_SCRIM_CLASS = `draggable-none fixed inset-0 bg-backdrop transition-opacity ${SHEET_MOTION} data-[starting-style]:opacity-0 data-[ending-style]:opacity-0`;

/** Upstream's Xd: paints the sheet surface below the positioner so overscroll never shows the page. */
const SHEET_POSITIONER_CLASS =
	"z-[130] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[100dvh] after:bg-[var(--menu-bg)]";

/** Upstream's zA: pinned full-width to the bottom edge, ignoring the trigger. */
const SHEET_POSITIONER_STYLE = {
	position: "fixed",
	inset: "auto 0 0",
	width: "auto",
	minWidth: 0,
	maxWidth: "none",
	transform: "none",
	scrollMarginTop: "env(safe-area-inset-top,0px)",
} as const;

/** Upstream's X1: no flipping or shifting. */
const SHEET_COLLISION_AVOIDANCE = {side: "none", align: "none"} as const;

/** Upstream's Hc + kX: the sheet surface, sliding up on enter and down on exit. */
const SHEET_POPUP_CLASS = `group/sheet relative flex w-full min-w-0 max-w-none flex-col overflow-hidden bg-[var(--menu-bg)] text-primary shadow-[var(--menu-shadow)] outline-none rounded-t-[14px] rounded-b-none pb-[max(env(safe-area-inset-bottom),0.5rem)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] transition-[translate,height,scale] ${SHEET_MOTION} [&_[data-cds-sheet-scroll]]:overscroll-contain data-[starting-style]:translate-y-[calc(100%+1.5rem)] data-[ending-style]:translate-y-[calc(100%+1.5rem)]`;

/** Upstream's Gf (.9) resting cap and the .95 ceiling, both below the top safe area. */
const SHEET_POPUP_STYLE = {
	maxHeight: "calc((100dvh - env(safe-area-inset-top,0px)) * .95)",
	"--available-height": "calc((100dvh - env(safe-area-inset-top,0px)) * .9)",
} as const;

const SHEET_BODY_CLASS = "min-h-0 min-w-0 flex-auto overflow-y-auto outline-none";

/** Sizing and radius tokens the sheet's own `w-full max-w-none h-auto max-h-none` merge away upstream. */
const SHEET_STRIPPED_TOKEN = /^(?:w|max-w|max-h|rounded(?:-[a-z]+)?)-/;

/** Upstream's pt: the consumer's className moves here, minus the sizing tailwind-merge drops. */
function sheetWrapperClass(className: string | undefined): string {
	const consumer = (className ?? "")
		.split(/\s+/)
		.filter((token) => token !== "" && !SHEET_STRIPPED_TOKEN.test(token))
		.join(" ");
	return `flex min-h-0 flex-auto flex-col ${consumer === "" ? "" : `${consumer} `}h-auto max-h-none min-h-0 w-full min-w-0 max-w-none flex-auto`;
}

/** Upstream's PopoverSheetContent: scrim, bottom-pinned positioner, handle and the scrolling body. */
function PopoverSheetContent({
	children,
	className,
	treeId,
}: {
	children: ReactNode;
	className: string | undefined;
	treeId: string;
}) {
	return (
		<BasePopover.Portal>
			<BasePopover.Backdrop data-presentation="sheet" data-sheet-scrim={treeId} className={SHEET_SCRIM_CLASS} />
			<BasePopover.Positioner
				className={SHEET_POSITIONER_CLASS}
				style={SHEET_POSITIONER_STYLE}
				collisionAvoidance={SHEET_COLLISION_AVOIDANCE}
				disableAnchorTracking
			>
				<BasePopover.Popup
					data-cds="Popover"
					data-size="lg"
					data-presentation="sheet"
					data-sheet-tree={treeId}
					data-cds-sheet-depth="0"
					data-cds-sheet-detent="default"
					className={SHEET_POPUP_CLASS}
					style={SHEET_POPUP_STYLE}
				>
					<div
						aria-hidden="true"
						data-cds-sheet-handle=""
						className="flex min-h-8 shrink-0 touch-none items-center justify-center select-none"
					>
						<div className="h-1 w-9 rounded-full bg-border" />
					</div>
					<div className={sheetWrapperClass(className)}>
						<div
							tabIndex={-1}
							data-cds-popover-body=""
							data-cds-sheet-scroll=""
							className={SHEET_BODY_CLASS}
						>
							{children}
						</div>
					</div>
				</BasePopover.Popup>
			</BasePopover.Positioner>
		</BasePopover.Portal>
	);
}

/** The popover surface: a bottom sheet where the root's gate latched one, else anchored to its trigger. */
export function PopoverContent({
	children,
	side = "bottom",
	align = "center",
	sideOffset = 6,
	className,
	structurallyAnchored = false,
}: PopoverContentProps) {
	const {sheet, treeId} = useContext(PopoverSheetContext);
	if (sheet && !structurallyAnchored) {
		return (
			<PopoverSheetContent className={className} treeId={treeId}>
				{children}
			</PopoverSheetContent>
		);
	}
	return (
		<BasePopover.Portal>
			<BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} className="z-[130]">
				<BasePopover.Popup {...(className === undefined ? {} : {className})}>{children}</BasePopover.Popup>
			</BasePopover.Positioner>
		</BasePopover.Portal>
	);
}
