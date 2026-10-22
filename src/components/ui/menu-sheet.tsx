import {Menu as BaseMenu} from "@base-ui/react/menu";
import type {BaseUIEvent} from "@base-ui/react/types";
import {ArrowLeft, X} from "lucide-react";
import {
	type ComponentProps,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";

import type {SheetDetent} from "../../lib/sheet-drag";
import {DensityProvider} from "./density";
import {
	handleAcceleratorKey,
	LABEL_CLASS,
	MenuKindContext,
	MenuLgContext,
	POSITIONER_CLASS,
	DENSITY_CLASSES,
	SHEET_SIZING,
	type SheetSize,
	SheetSizeContext,
	SheetDismissContext,
	SheetLevelContext,
	SheetTreeIdContext,
	SubmenuControlContext,
	useItemClass,
} from "./menu-internals";
import {SHEET_TALL_HEIGHT, SheetDragContext, useSheetDrag} from "./menu-sheet-drag";

/*
 * The bottom-sheet presentation of the menu primitive, which ./menu loads lazily behind the
 * coarse-pointer, narrow-viewport gate so fine-pointer pages never ship the sheet DOM, drag or drill-in.
 */

type CollisionAvoidance = NonNullable<ComponentProps<typeof BaseMenu.Positioner>["collisionAvoidance"]>;

/* Upstream's gM: `duration-sheet ease-out`, which compute to 0.3s and the phone-sheet curve. */
const SHEET_MOTION = "duration-[300ms] ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none";

/** Upstream's WK: the root sheet scrim, fading with the popup's enter and exit. */
const SHEET_SCRIM_CLASS = `draggable-none fixed inset-0 bg-backdrop transition-opacity ${SHEET_MOTION} data-[starting-style]:opacity-0 data-[ending-style]:opacity-0`;

/** Upstream's Xd: paints the sheet surface below the positioner so overscroll never shows the page. */
const SHEET_POSITIONER_CLASS = `${POSITIONER_CLASS} after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[100dvh] after:bg-surface-3`;

/** Upstream's zA: pinned full-width to the bottom edge, ignoring the trigger. */
const SHEET_POSITIONER_STYLE = {
	position: "fixed",
	inset: "auto 0 0",
	width: "auto",
	minWidth: 0,
	maxWidth: "none",
	transform: "none",
} as const;

/** Upstream's X1: no flipping or shifting, and no tracking of the trigger. */
const SHEET_COLLISION_AVOIDANCE = {side: "none", align: "none"} as const satisfies CollisionAvoidance;

/** Upstream's Hc, shared by every level of a sheet tree. */
const SHEET_LEVEL_CLASS = `group/sheet relative flex w-full min-w-0 max-w-none flex-col overflow-hidden font-normal text-primary outline-none select-none rounded-b-none pb-[max(env(safe-area-inset-bottom),0.5rem)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] transition-[translate,height,scale] ${SHEET_MOTION}`;

/** The root level: the sheet surface, sliding up on enter and down on exit. */
const SHEET_POPUP_CLASS = `${SHEET_LEVEL_CLASS} bg-[var(--menu-bg)] shadow-[var(--menu-shadow)] data-[starting-style]:translate-y-[calc(100%+1.5rem)] data-[ending-style]:translate-y-[calc(100%+1.5rem)]`;

/**
 * A drilled level: transparent over the root's surface, sliding out sideways on its own close
 * (or when peeled), and down with the root when the whole tree closes.
 */
const SHEET_NESTED_POPUP_CLASS = `${SHEET_LEVEL_CLASS} bg-transparent shadow-none [&[data-ending-style]:not([data-cds-sheet-tree-closing])]:translate-x-full rtl:[&[data-ending-style]:not([data-cds-sheet-tree-closing])]:-translate-x-full [&[data-ending-style][data-cds-sheet-peeling]]:translate-x-full rtl:[&[data-ending-style][data-cds-sheet-peeling]]:-translate-x-full [&[data-ending-style][data-cds-sheet-tree-closing]]:translate-y-[calc(100%+1.5rem)]`;

/** Upstream's tl: a drilled level's positioner, clipped at the sheet's top edge and stacked over the root. */
const SHEET_NESTED_POSITIONER_CLASS = "[clip-path:inset(0_0_-200vh_0)]";

const SHEET_NESTED_POSITIONER_STYLE = {...SHEET_POSITIONER_STYLE, zIndex: 220} as const;

/** Upstream's Bt/q: a drilled level's title bar, painted above its rows. */
const SHEET_HEADER_CLASS = "order-first flex min-h-10 shrink-0 touch-none items-center gap-1.5 px-1 pb-1 select-none";

const SHEET_BACK_CLASS =
	"flex min-h-10 w-auto cursor-default items-center gap-1 rounded-r7 px-2.5 py-0 text-[15px]/[22px] text-primary outline-none select-none data-[highlighted]:bg-fill-ghost-hover";

const SHEET_TITLE_CLASS = "min-w-0 flex-1 truncate text-start text-[15px]/[20px] font-semibold text-primary";

/** Upstream's Gf (.9) resting cap and the .95 drag ceiling, both below the top safe area. */
const SHEET_POPUP_STYLE = {
	maxHeight: "calc((100dvh - env(safe-area-inset-top,0px)) * .95)",
	"--available-height": "calc((100dvh - env(safe-area-inset-top,0px)) * .9)",
} as const;

/** Upstream's tP: the level's content, which slides off when a submenu drills in. */
const SHEET_CONTENT_CLASS = `flex min-h-0 flex-1 flex-col transition-[translate] ${SHEET_MOTION} group-data-[cds-sheet-drilled]/sheet:-translate-x-[calc(100%+env(safe-area-inset-left,0px))] rtl:group-data-[cds-sheet-drilled]/sheet:translate-x-[calc(100%+env(safe-area-inset-right,0px))]`;

const SHEET_SCROLL_CLASS = "relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1";

/** Upstream's dt: the drag handle pill at the top of the sheet, hidden on a drilled level. */
function SheetHandle({nested = false}: {nested?: boolean}) {
	const drag = useSheetDrag();
	return (
		<div
			aria-hidden="true"
			data-cds-sheet-handle=""
			{...drag}
			className="flex min-h-8 shrink-0 touch-none items-center justify-center select-none"
		>
			<div className={nested ? "h-1 w-9 rounded-full bg-border opacity-0" : "h-1 w-9 rounded-full bg-border"} />
		</div>
	);
}

/** A level that a submenu has drilled past: hidden from assistive tech while its content slides off. */
function useSheetLevel(treeId: string) {
	const [drilled, setDrilled] = useState(false);
	const level = useMemo(() => ({treeId, setDrilled}), [treeId]);
	const attributes = drilled ? {"aria-hidden": true, "data-cds-sheet-drilled": ""} : {};
	return {level, attributes};
}

/** Upstream's Bt: Back and the trigger's label, in a bar that also drags the sheet. */
function SheetLevelHeader() {
	const control = useContext(SubmenuControlContext);
	const drag = useSheetDrag();
	const [title, setTitle] = useState("");
	useLayoutEffect(() => {
		setTitle(control?.triggerRef.current?.querySelector("[data-menu-sub-label]")?.textContent ?? "");
	}, [control]);
	return (
		<div className={SHEET_HEADER_CLASS} {...drag}>
			<span className="-me-2.5 shrink-0">
				<BaseMenu.Item
					closeOnClick={false}
					aria-label="Back"
					className={SHEET_BACK_CLASS}
					onClick={() => {
						control?.close();
					}}
				>
					<span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
						<ArrowLeft className="size-5" />
					</span>
				</BaseMenu.Item>
			</span>
			<span aria-hidden="true" className={SHEET_TITLE_CLASS}>
				{title}
			</span>
		</div>
	);
}

/**
 * A drilled level enters from the inline end (`translate: 100% 0`, then cleared), and takes the
 * taller of its own and its parent's height so the sheet never shrinks under the finger.
 */
function useDrilledLevelLayout(popup: HTMLDivElement | null) {
	useLayoutEffect(() => {
		if (popup === null) return undefined;
		const parent = popup.ownerDocument.querySelector<HTMLElement>(
			`[data-sheet-tree="${CSS.escape(popup.dataset["sheetTree"] ?? "")}"][data-cds-sheet-drilled]`,
		);
		const height = Math.max(parent?.getBoundingClientRect().height ?? 0, popup.scrollHeight);
		if (height > 0) popup.style.height = `${height}px`;
		popup.style.translate = "100% 0";
		const frame = requestAnimationFrame(() => {
			popup.style.translate = "";
		});
		return () => {
			cancelAnimationFrame(frame);
		};
	}, [popup]);
}

/** Upstream's Vt: hidden until keyboard-highlighted or held, so screen readers and arrow keys reach it. */
const SHEET_CLOSE_ROW_CLASS =
	"group/sheet-close block w-full rounded outline-none select-none focus-visible:outline-hidden [&:not(:focus-visible):not([data-highlighted]):not([data-cds-sheet-control-held])]:sr-only";

/** The last row of a root sheet: an item-styled X and "Close" that dismisses the sheet. */
function SheetCloseRow() {
	const itemClass = useItemClass();
	return (
		<BaseMenu.Item closeOnClick aria-label="Close" data-cds-sheet-control="" className={SHEET_CLOSE_ROW_CLASS}>
			<span className={`${itemClass} text-primary group-data-[highlighted]/sheet-close:bg-fill-ghost-hover`}>
				<span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
					<X />
				</span>
				<span className={LABEL_CLASS}>Close</span>
			</span>
		</BaseMenu.Item>
	);
}

/**
 * Upstream's _t: a press marks the sheet pressed, and holds the Close row visible when it was highlighted,
 * until the next click, pointercancel or keydown.
 */
function useSheetPressMarkers(popup: HTMLDivElement | null) {
	useEffect(() => {
		if (popup === null) return undefined;
		const doc = popup.ownerDocument;
		let held: Element | null = null;
		const release = () => {
			popup.removeAttribute("data-cds-sheet-pressed");
			held?.removeAttribute("data-cds-sheet-control-held");
			held = null;
			doc.removeEventListener("click", release, true);
			doc.removeEventListener("pointercancel", release, true);
			doc.removeEventListener("keydown", release, true);
		};
		const press = () => {
			doc.addEventListener("click", release, true);
			doc.addEventListener("pointercancel", release, true);
			doc.addEventListener("keydown", release, true);
			popup.setAttribute("data-cds-sheet-pressed", "");
			const control = popup.querySelector("[data-cds-sheet-control]");
			if (control?.matches(":focus-visible, [data-highlighted]")) {
				held = control;
				control.setAttribute("data-cds-sheet-control-held", "");
			}
		};
		popup.addEventListener("pointerdown", press, true);
		return () => {
			popup.removeEventListener("pointerdown", press, true);
			release();
		};
	}, [popup]);
}

/**
 * Upstream's Pt: a sheet swallows Tab and Shift+Tab so focus stays inside, and skips Base UI's
 * Shift+Tab close; Escape still closes.
 */
function handleSheetKey(event: BaseUIEvent<KeyboardEvent<HTMLElement>>): void {
	if (event.key === "Tab") {
		event.preventDefault();
		event.preventBaseUIHandler();
		return;
	}
	handleAcceleratorKey(event);
}
/** Upstream's `rounded-t-card` resolves to 14px under `data-size="lg"` and to the comfortable 12px card otherwise. */
const SHEET_SIZE = {
	lg: {radius: "rounded-t-[14px]", text: SHEET_SIZING.text, attributes: {"data-size": "lg"}},
	base: {radius: "rounded-t-card", text: DENSITY_CLASSES.comfortable.text, attributes: {}},
} as const satisfies Record<SheetSize, {radius: string; text: string; attributes: object}>;

export interface SheetContentProps {
	children: ReactNode;
	size?: SheetSize | undefined;
	className?: string | undefined;
	finalFocus?: ComponentProps<typeof BaseMenu.Popup>["finalFocus"] | undefined;
}

function popupClass(levelClass: string, size: SheetSize, className: string | undefined): string {
	const {radius, text} = SHEET_SIZE[size];
	return `${levelClass} ${radius} ${text}${className ? ` ${className}` : ""}`;
}

function popupStyle(detent: SheetDetent) {
	return detent === "tall" ? {...SHEET_POPUP_STYLE, height: SHEET_TALL_HEIGHT} : SHEET_POPUP_STYLE;
}

/** A root menu's sheet: scrim, bottom-pinned positioner, handle, rows and the Close row; it owns the drag detent. */
export function RootSheetContent({children, className, finalFocus, size = "lg"}: SheetContentProps) {
	const kind = useContext(MenuKindContext);
	const rootTreeId = useContext(SheetTreeIdContext);
	const ownTreeId = useId();
	const treeId = rootTreeId ?? ownTreeId;
	const {level, attributes} = useSheetLevel(treeId);
	const dismiss = useContext(SheetDismissContext);
	/* A callback ref, so the press markers attach when the portal mounts the popup on open. */
	const [popup, setPopupState] = useState<HTMLDivElement | null>(null);
	const [detent, setDetent] = useState<SheetDetent>("default");
	/* A closed sheet reopens at its default detent. */
	const setPopup = useCallback((next: HTMLDivElement | null) => {
		setPopupState(next);
		if (next === null) setDetent("default");
	}, []);
	const dragFrame = useMemo(() => ({treeId, dismiss, detent, setDetent}), [treeId, dismiss, detent]);
	useSheetPressMarkers(popup);
	return (
		<DensityProvider density="comfortable">
			<SheetSizeContext.Provider value={size}>
				<MenuLgContext.Provider value={size === "lg"}>
					<SheetDragContext.Provider value={dragFrame}>
						<BaseMenu.Portal>
							<BaseMenu.Backdrop
								data-presentation="sheet"
								data-sheet-scrim={treeId}
								className={SHEET_SCRIM_CLASS}
							/>
							<BaseMenu.Positioner
								className={SHEET_POSITIONER_CLASS}
								style={SHEET_POSITIONER_STYLE}
								data-density="comfortable"
								collisionAvoidance={SHEET_COLLISION_AVOIDANCE}
								disableAnchorTracking
							>
								<BaseMenu.Popup
									ref={setPopup}
									data-cds={kind}
									data-presentation="sheet"
									data-sheet-tree={treeId}
									data-cds-sheet-depth="0"
									{...SHEET_SIZE[size].attributes}
									{...attributes}
									className={popupClass(SHEET_POPUP_CLASS, size, className)}
									data-cds-sheet-detent={detent}
									style={popupStyle(detent)}
									onKeyDown={handleSheetKey}
									{...(finalFocus === undefined ? {} : {finalFocus})}
								>
									<SheetHandle />
									<div className={SHEET_CONTENT_CLASS}>
										<div data-cds-sheet-scroll="" className={SHEET_SCROLL_CLASS}>
											<SheetLevelContext.Provider value={level}>
												{children}
											</SheetLevelContext.Provider>
											<SheetCloseRow />
										</div>
									</div>
								</BaseMenu.Popup>
							</BaseMenu.Positioner>
						</BaseMenu.Portal>
					</SheetDragContext.Provider>
				</MenuLgContext.Provider>
			</SheetSizeContext.Provider>
		</DensityProvider>
	);
}

/** A submenu drilled into its parent's sheet: stacked over the root, with a Back header, at the root's detent. */
export function NestedSheetContent({children, className, finalFocus, treeId}: SheetContentProps & {treeId: string}) {
	const kind = useContext(MenuKindContext);
	const {level, attributes} = useSheetLevel(treeId);
	const detent = useContext(SheetDragContext)?.detent ?? "default";
	const size = useContext(SheetSizeContext);
	const [popup, setPopup] = useState<HTMLDivElement | null>(null);
	useDrilledLevelLayout(popup);
	return (
		<DensityProvider density="comfortable">
			<MenuLgContext.Provider value={size === "lg"}>
				<BaseMenu.Portal>
					<BaseMenu.Positioner
						className={SHEET_NESTED_POSITIONER_CLASS}
						style={SHEET_NESTED_POSITIONER_STYLE}
						data-density="comfortable"
						collisionAvoidance={SHEET_COLLISION_AVOIDANCE}
						disableAnchorTracking
					>
						<BaseMenu.Popup
							ref={setPopup}
							data-cds={kind}
							data-presentation="sheet"
							data-nested=""
							data-sheet-tree={treeId}
							data-cds-sheet-depth="0"
							{...SHEET_SIZE[size].attributes}
							{...attributes}
							className={popupClass(SHEET_NESTED_POPUP_CLASS, size, className)}
							data-cds-sheet-detent={detent}
							style={popupStyle(detent)}
							onKeyDown={handleSheetKey}
							{...(finalFocus === undefined ? {} : {finalFocus})}
						>
							<SheetHandle nested />
							<div className={SHEET_CONTENT_CLASS}>
								<div data-cds-sheet-scroll="" className={SHEET_SCROLL_CLASS}>
									<SheetLevelContext.Provider value={level}>{children}</SheetLevelContext.Provider>
								</div>
								<SheetLevelHeader />
							</div>
						</BaseMenu.Popup>
					</BaseMenu.Positioner>
				</BaseMenu.Portal>
			</MenuLgContext.Provider>
		</DensityProvider>
	);
}
