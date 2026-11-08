import {Popover as BasePopover} from "@base-ui/react/popover";
import {
	type ComponentProps,
	createContext,
	lazy,
	type ReactNode,
	type RefObject,
	Suspense,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

import {loadedPopoverSheet, preloadPopoverSheet} from "./popover-sheet-loader";
import {useSheetPresentation} from "./sheet-presentation";
import {overlayAttrs} from "../../lib/overlay";

interface PopoverSheet {
	sheet: boolean;
	treeId: string;
	/** Closes the root, as a drag past the dismiss threshold does. */
	dismiss: () => void;
}

/** Whether the enclosing root latched a bottom-sheet presentation at open, its sheet tree id and its close. */
const PopoverSheetContext = createContext<PopoverSheet>({
	sheet: false,
	treeId: "",
	dismiss: () => undefined,
});

type PopoverActions = NonNullable<ComponentProps<typeof BasePopover.Root>["actionsRef"]>;

/**
 * Upstream's `Bl` → `r3`: tracks the root's open state (controlled or not) and runs the sheet gate with
 * `closable = !(open !== undefined && !consumerHandlesOpenChange)`, latched from open through the exit.
 */
export function PopoverRoot(props: ComponentProps<typeof BasePopover.Root>) {
	const {open, defaultOpen, onOpenChange, onOpenChangeComplete, actionsRef} = props;
	const ownActionsRef = useRef<PopoverActions extends RefObject<infer T> ? T : never>(null);
	const actions = actionsRef ?? ownActionsRef;
	const dismiss = useCallback(() => {
		actions.current?.close();
	}, [actions]);
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
	const {sheet, onOpenChangeComplete: releaseLatch} = useSheetPresentation(open ?? uncontrolledOpen, {
		closable: !(open !== undefined && onOpenChange === undefined),
	});
	const treeId = useId();
	useEffect(() => {
		if (sheet) void preloadPopoverSheet();
	}, [sheet]);
	const context = useMemo(() => ({sheet, treeId, dismiss}), [sheet, treeId, dismiss]);
	return (
		<PopoverSheetContext.Provider value={context}>
			<BasePopover.Root
				{...props}
				actionsRef={actions}
				/* Upstream's uK returns `modal: true` for a sheet: body scroll locks and the page behind goes inert. */
				modal={sheet || props.modal}
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

/**
 * A scroll body for an anchored popup that scrolls its own content: upstream's popover body (`c_` +
 * `scroll-fade-y`), clamped to the popup's max height. The fade's mask sits on this body, not on the
 * popup, so it can't clip the popup's shadow.
 */
export const POPOVER_SCROLL_BODY_CLASS =
	"max-h-[inherit] min-h-0 min-w-0 flex-auto overflow-y-auto scroll-fade-y rounded-[inherit] outline-none";

/** Upstream's cds `Ql` trigger and title, beside the gated `PopoverRoot`, with `PopoverContent` as the surface. */
export const PopoverTrigger = BasePopover.Trigger;
export const PopoverTitle = BasePopover.Title;

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
	/** The sheet's sr-only DismissButton text. */
	closeLabel?: string;
	/** Lands on the anchored Popup; a sheet has no pointer to track. */
	onPointerEnter?: () => void;
}

const LazyPopoverSheetContent = lazy(async () =>
	preloadPopoverSheet().then((module) => ({default: module.PopoverSheetContent})),
);

function PopoverSheet(props: ComponentProps<typeof LazyPopoverSheetContent>) {
	const popoverSheetModule = loadedPopoverSheet();
	if (popoverSheetModule !== null) return <popoverSheetModule.PopoverSheetContent {...props} />;
	return (
		<Suspense fallback={null}>
			<LazyPopoverSheetContent {...props} />
		</Suspense>
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
	closeLabel = "Close",
	onPointerEnter,
}: PopoverContentProps) {
	const {sheet, treeId, dismiss} = useContext(PopoverSheetContext);
	if (sheet && !structurallyAnchored) {
		return (
			<PopoverSheet className={className} closeLabel={closeLabel} treeId={treeId} dismiss={dismiss}>
				{children}
			</PopoverSheet>
		);
	}
	return (
		<BasePopover.Portal>
			<BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} className="z-[130]">
				<BasePopover.Popup
					data-cds="Popover"
					{...overlayAttrs}
					{...(className === undefined ? {} : {className})}
					{...(onPointerEnter === undefined ? {} : {onPointerEnter})}
				>
					{children}
				</BasePopover.Popup>
			</BasePopover.Positioner>
		</BasePopover.Portal>
	);
}
