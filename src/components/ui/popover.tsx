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

import {useSheetPresentation} from "./sheet-presentation";

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
function PopoverRoot(props: ComponentProps<typeof BasePopover.Root>) {
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

/** Upstream's cds `Ql`: the gated root and the Base UI trigger and title, with `PopoverContent` as the surface. */
export const Popover = {
	Root: PopoverRoot,
	Trigger: BasePopover.Trigger,
	Title: BasePopover.Title,
};

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
}

type PopoverSheetModule = typeof import("./popover-sheet");

let popoverSheetModule: PopoverSheetModule | null = null;
let popoverSheetLoad: Promise<PopoverSheetModule> | null = null;

/**
 * The sheet presentation (sheet DOM, drag, detents, keyboard inset) is its own chunk, as upstream's
 * `cds_mobile_sheets`. A root whose gate would open a sheet starts the load as it mounts, so by the first
 * tap the module is in hand and the sheet renders synchronously.
 */
export async function preloadPopoverSheet(): Promise<PopoverSheetModule> {
	popoverSheetLoad ??= import("./popover-sheet").then((module) => {
		popoverSheetModule = module;
		return module;
	});
	return popoverSheetLoad;
}

const LazyPopoverSheetContent = lazy(async () =>
	preloadPopoverSheet().then((module) => ({default: module.PopoverSheetContent})),
);

function PopoverSheet(props: ComponentProps<typeof LazyPopoverSheetContent>) {
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
				<BasePopover.Popup {...(className === undefined ? {} : {className})}>{children}</BasePopover.Popup>
			</BasePopover.Positioner>
		</BasePopover.Portal>
	);
}
