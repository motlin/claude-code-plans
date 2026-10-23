import {ContextMenu as BaseContextMenu} from "@base-ui/react/context-menu";
import {Menu as BaseMenu} from "@base-ui/react/menu";
import {Check, ChevronRight} from "lucide-react";
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

import {useIsMac} from "../../hooks/use-is-mac";
import {toAriaKeyShortcuts} from "../../lib/shortcuts/format";
import {type Density, DensityProvider, useScopeDensity} from "./density";
import {
	DENSITY_CLASSES,
	handleAcceleratorKey,
	LABEL_CLASS,
	MenuKindContext,
	MenuLgContext,
	POSITIONER_CLASS,
	SHEET_SIZING,
	type SheetSize,
	SheetDismissContext,
	SheetLevelContext,
	SheetTreeIdContext,
	SubmenuControlContext,
	useItemClass,
	useMenuSizing,
} from "./menu-internals";
import type {SheetContentProps} from "./menu-sheet";
import {MenuSwitch} from "./menu-switch";
import {useSheetPresentation} from "./sheet-presentation";
import {Shortcut} from "./shortcut";
import {Tooltip} from "./tooltip";

type MenuSheetModule = typeof import("./menu-sheet");

let menuSheetModule: MenuSheetModule | null = null;
let menuSheetLoad: Promise<MenuSheetModule> | null = null;

/**
 * The sheet presentation (sheet DOM, drag, drill-in) is its own chunk. A root whose gate would open a sheet
 * starts the load as it mounts, so by the first tap the module is in hand and the sheet renders synchronously.
 */
export async function preloadMenuSheet(): Promise<MenuSheetModule> {
	menuSheetLoad ??= import("./menu-sheet").then((module) => {
		menuSheetModule = module;
		return module;
	});
	return menuSheetLoad;
}

const LazyRootSheetContent = lazy(async () =>
	preloadMenuSheet().then((module) => ({default: module.RootSheetContent})),
);
const LazyNestedSheetContent = lazy(async () =>
	preloadMenuSheet().then((module) => ({default: module.NestedSheetContent})),
);

function RootSheet(props: SheetContentProps) {
	if (menuSheetModule !== null) return <menuSheetModule.RootSheetContent {...props} />;
	return (
		<Suspense fallback={null}>
			<LazyRootSheetContent {...props} />
		</Suspense>
	);
}

function NestedSheet(props: SheetContentProps & {treeId: string}) {
	if (menuSheetModule !== null) return <menuSheetModule.NestedSheetContent {...props} />;
	return (
		<Suspense fallback={null}>
			<LazyNestedSheetContent {...props} />
		</Suspense>
	);
}

/*
 * One menu primitive copied from claude.ai/code (Base UI Menu / ContextMenu):
 * compact header rows and comfortable navigation rows, with 4px popup padding,
 * a right-aligned muted shortcut hint,
 * submenus that open on hover, click or ArrowRight, trailing accent checks for
 * radio/checkbox items, and single-key accelerators that fire while open.
 */

const POPUP_CLASS =
	"relative flex max-h-[var(--available-height)] min-w-[128px] max-w-[320px] flex-col bg-[var(--menu-bg)] font-normal text-primary shadow-[var(--menu-shadow)] outline-none select-none";

/** Upstream's scroller carries a `border-b-[length:var(--cds-ring-inner)] border-transparent` 1px bottom border. */
const SCROLLER_CLASS = "min-h-0 overflow-y-auto border-b border-transparent";

const ITEM_VARIANT_CLASS = {
	default: "text-primary data-[highlighted]:bg-fill-ghost-hover",
	danger: "text-danger-100 data-[highlighted]:bg-[var(--menu-danger-fill)] data-[highlighted]:text-[var(--menu-on-danger)] data-[highlighted]:[--shortcut-cap-ink:currentColor]",
} as const;

const DESCRIPTION_CLASS = "truncate pt-[2px] text-[12px]/[15px] text-[var(--menu-muted)]";
const TRAILING_CLASS = "ml-auto flex shrink-0 items-center gap-1";
/** Radio descriptions wrap rather than truncate, as upstream's mode rows. */
const RADIO_DESCRIPTION_CLASS = "break-words text-[12px]/[15px] text-[var(--menu-muted)]";
/** Pins a two-line row's keycap and check to its first line. */
const FIRST_LINE_TRAILING_CLASS = `${TRAILING_CLASS} h-[1lh] self-start`;
/** A digit row's trailing group: check slot then keycap, as upstream's mode rows. */
const DIGIT_TRAILING_CLASS = "flex shrink-0 items-center gap-1 ms-3 h-[1lh] self-start";
const DIGIT_CHECK_SLOT_CLASS = "flex size-4 shrink-0 items-center justify-center pointer-coarse:-me-1";
const CHECK_SLOT_CLASS = "-mr-1 flex size-5 shrink-0 items-center justify-center";
/** Upstream's checked tick: 16px, bold, in fill-accent ink. */
const CHECK_ICON_CLASS = "size-4 text-fill-accent";
/** Hover dwell before a submenu opens. */
const SUBMENU_HOVER_DELAY_MS = 100;
const ICON_SLOT_CLASS = "mr-1 flex size-5 shrink-0 items-center justify-center [&_svg]:shrink-0";

function ItemIcon({icon}: {icon: ReactNode}) {
	const glyph = useMenuSizing().icon;
	if (icon === undefined) return null;
	return (
		<span aria-hidden="true" className={`${ICON_SLOT_CLASS} ${glyph}`}>
			{icon}
		</span>
	);
}

export type MenuItemVariant = keyof typeof ITEM_VARIANT_CLASS;

function acceleratorProps(accelerator: string | undefined) {
	if (accelerator === undefined) return {};
	const key = accelerator.toLowerCase();
	return {"aria-keyshortcuts": key, "data-accelerator": key};
}

/** Whether the enclosing menu root latched a bottom-sheet presentation at open. */
const MenuSheetContext = createContext(false);

type MenuActions = NonNullable<ComponentProps<typeof BaseMenu.Root>["actionsRef"]>;

/** The root's imperative close, wired through Base UI's `actionsRef`. */
function useRootDismiss(actionsRef: MenuActions | undefined) {
	const ownRef = useRef<MenuActions extends RefObject<infer T> ? T : never>(null);
	const ref = actionsRef ?? ownRef;
	const dismiss = useCallback(() => {
		ref.current?.close();
	}, [ref]);
	return {ref, dismiss};
}

/**
 * Upstream's tree close: the root marks every open level `data-cds-sheet-tree-closing` before Base UI
 * starts the exit, so drilled levels slide down with the root instead of sideways.
 */
function markSheetTreeClosing(treeId: string, closing: boolean) {
	for (const level of document.querySelectorAll(`[data-sheet-tree="${CSS.escape(treeId)}"]`)) {
		level.toggleAttribute("data-cds-sheet-tree-closing", closing);
	}
}

interface MenuRootProps {
	open?: boolean | undefined;
	defaultOpen?: boolean | undefined;
	onOpenChange?: ((open: boolean, ...rest: never[]) => void) | undefined;
	onOpenChangeComplete?: ((open: boolean) => void) | undefined;
}

/**
 * Upstream's yt/Ik: track the root's open state (controlled or not) and run the sheet gate with
 * `closable = open === undefined || onOpenChange !== undefined`, latched from open through the exit.
 */
function useMenuRootSheet<P extends MenuRootProps>(
	props: P,
): {
	sheet: boolean;
	open: boolean;
	treeId: string;
	rootProps: P & {onOpenChange: (open: boolean, ...rest: never[]) => void};
} {
	const {open, defaultOpen, onOpenChange, onOpenChangeComplete} = props;
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
	const resolvedOpen = open ?? uncontrolledOpen;
	const {sheet, onOpenChangeComplete: releaseLatch} = useSheetPresentation(resolvedOpen, {
		closable: open === undefined || onOpenChange !== undefined,
	});
	const treeId = useId();
	useEffect(() => {
		if (sheet) void preloadMenuSheet();
	}, [sheet]);
	const rootProps = {
		...props,
		onOpenChange: (nextOpen: boolean, ...rest: never[]) => {
			if (sheet) markSheetTreeClosing(treeId, !nextOpen);
			setUncontrolledOpen(nextOpen);
			onOpenChange?.(nextOpen, ...rest);
		},
		onOpenChangeComplete: (completedOpen: boolean) => {
			releaseLatch(completedOpen);
			onOpenChangeComplete?.(completedOpen);
		},
	};
	return {sheet, open: resolvedOpen, treeId, rootProps};
}

export function Menu(props: ComponentProps<typeof BaseMenu.Root>) {
	const {sheet, treeId, rootProps} = useMenuRootSheet(props);
	const {ref, dismiss} = useRootDismiss(props.actionsRef);
	return (
		<MenuKindContext.Provider value="Menu">
			<MenuSheetContext.Provider value={sheet}>
				<SheetTreeIdContext.Provider value={treeId}>
					<SheetDismissContext.Provider value={dismiss}>
						<BaseMenu.Root {...rootProps} actionsRef={ref} />
					</SheetDismissContext.Provider>
				</SheetTreeIdContext.Provider>
			</MenuSheetContext.Provider>
		</MenuKindContext.Provider>
	);
}

export const MenuTrigger = BaseMenu.Trigger;

export function ContextMenu(props: ComponentProps<typeof BaseContextMenu.Root>) {
	const {sheet, treeId, rootProps} = useMenuRootSheet(props);
	const {ref, dismiss} = useRootDismiss(props.actionsRef);
	return (
		<MenuKindContext.Provider value="ContextMenu">
			<MenuSheetContext.Provider value={sheet}>
				<SheetTreeIdContext.Provider value={treeId}>
					<SheetDismissContext.Provider value={dismiss}>
						<BaseContextMenu.Root {...rootProps} actionsRef={ref} />
					</SheetDismissContext.Provider>
				</SheetTreeIdContext.Provider>
			</MenuSheetContext.Provider>
		</MenuKindContext.Provider>
	);
}

export const ContextMenuTrigger = BaseContextMenu.Trigger;

type CollisionAvoidance = NonNullable<ComponentProps<typeof BaseMenu.Positioner>["collisionAvoidance"]>;

/*
 * A left/right popup that fits neither side (e.g. the phone sidebar's More menu)
 * falls back below its trigger instead of flipping off-screen, matching
 * upstream's Base UI submenu default.
 */
const SIDE_COLLISION_AVOIDANCE = {fallbackAxisSide: "end"} as const satisfies CollisionAvoidance;
type MenuSide = NonNullable<ComponentProps<typeof BaseMenu.Positioner>["side"]>;
const INLINE_SIDES: ReadonlySet<MenuSide> = new Set(["left", "right", "inline-start", "inline-end"]);

export interface MenuContentProps {
	/** Overrides the opener's density; nested popups inherit their parent's. */
	density?: Density;
	children: ReactNode;
	side?: ComponentProps<typeof BaseMenu.Positioner>["side"];
	align?: ComponentProps<typeof BaseMenu.Positioner>["align"];
	sideOffset?: number;
	alignOffset?: number;
	/** Defaults to falling back along the cross axis for side-opening popups, as Base UI submenus do. */
	collisionAvoidance?: CollisionAvoidance;
	className?: string;
	/** Where focus goes when the menu closes; `false` leaves it where an action put it. */
	finalFocus?: ComponentProps<typeof BaseMenu.Popup>["finalFocus"];
	anchor?: ComponentProps<typeof BaseMenu.Positioner>["anchor"];
	/** Upstream's pinned header: it sits above the scroller in the gutter, so it never scrolls away. */
	header?: ReactNode;
	/**
	 * Upstream's `structurallyAnchored`: the trigger keeps focus in an editor or input, so the popup stays
	 * anchored even where the root would otherwise present a bottom sheet.
	 */
	structurallyAnchored?: boolean;
	/**
	 * A root sheet's row size: upstream's lg rows (`data-size="lg"`), or `"base"` to keep the comfortable 32px rows
	 * as upstream's ModelSelector does. Drilled levels follow their root.
	 */
	sheetSize?: SheetSize;
}

interface MenuContentInternalProps extends MenuContentProps {
	/** A submenu level: anchored beside its trigger, or drilled into the parent's sheet. */
	nested?: boolean;
}

/** The popup surface. Inside a ContextMenu it opens at the pointer; in a root sheet it pins to the bottom edge. */
export function MenuContent({
	children,
	density,
	side = "bottom",
	align = "start",
	sideOffset = 4,
	alignOffset = 0,
	collisionAvoidance,
	className,
	finalFocus,
	anchor,
	header,
	structurallyAnchored = false,
	sheetSize = "lg",
	nested = false,
}: MenuContentInternalProps) {
	const resolvedCollisionAvoidance =
		collisionAvoidance ?? (INLINE_SIDES.has(side) ? SIDE_COLLISION_AVOIDANCE : undefined);
	const collisionFallback =
		resolvedCollisionAvoidance !== undefined && "fallbackAxisSide" in resolvedCollisionAvoidance
			? resolvedCollisionAvoidance.fallbackAxisSide
			: undefined;
	const kind = useContext(MenuKindContext);
	const sheet = useContext(MenuSheetContext) && !structurallyAnchored;
	const parentLevel = useContext(SheetLevelContext);
	/* Upstream's si order: an override, then comfortable on (pointer: coarse), then the prop or opener's density. */
	const scopeDensity = useScopeDensity(density);
	const sheetProps = {
		children: (
			<>
				{header}
				{children}
			</>
		),
		className,
		finalFocus,
	};
	if (sheet && !nested) return <RootSheet {...sheetProps} size={sheetSize} />;
	/* A submenu drills in only inside a sheet tree; an anchored parent keeps its fly-out. */
	if (sheet && parentLevel !== null) return <NestedSheet {...sheetProps} treeId={parentLevel.treeId} />;
	/* A sheet's portal forces comfortable (`density: MG`) at every account density. */
	const resolvedDensity = sheet ? "comfortable" : scopeDensity;
	const sizing = sheet ? SHEET_SIZING : DENSITY_CLASSES[resolvedDensity];
	/* With a header the gutter moves onto the header and the scroller, as upstream's `p-gutter pt-0`. */
	const popupClass = `${POPUP_CLASS} ${sizing.popup}${header === undefined ? " p-1" : ""} ${sizing.text}`;
	return (
		<DensityProvider density={resolvedDensity}>
			<MenuLgContext.Provider value={sheet}>
				<BaseMenu.Portal>
					<BaseMenu.Positioner
						className={POSITIONER_CLASS}
						data-density={resolvedDensity}
						side={side}
						align={align}
						sideOffset={sideOffset}
						alignOffset={alignOffset}
						data-side-offset={sideOffset}
						data-align-offset={alignOffset}
						{...(anchor === undefined ? {} : {anchor})}
						{...(resolvedCollisionAvoidance === undefined
							? {}
							: {collisionAvoidance: resolvedCollisionAvoidance})}
						{...(collisionFallback === undefined ? {} : {"data-collision-fallback": collisionFallback})}
					>
						<BaseMenu.Popup
							data-cds={kind}
							{...(sheet ? {"data-presentation": "sheet"} : {})}
							className={className ? `${popupClass} ${className}` : popupClass}
							onKeyDown={handleAcceleratorKey}
							{...(finalFocus === undefined ? {} : {finalFocus})}
						>
							{header !== undefined && <div className="shrink-0 px-1 pt-1">{header}</div>}
							<div
								data-menu-scroller=""
								className={header === undefined ? SCROLLER_CLASS : `${SCROLLER_CLASS} p-1 pt-0`}
							>
								{children}
							</div>
						</BaseMenu.Popup>
					</BaseMenu.Positioner>
				</BaseMenu.Portal>
			</MenuLgContext.Provider>
		</DensityProvider>
	);
}

function ItemTrailing({accelerator, shortcut}: {accelerator?: string; shortcut?: string}) {
	const sizing = useMenuSizing();
	const keys = shortcut ?? accelerator;
	if (keys === undefined) return null;
	return (
		<span aria-hidden="true" className={`${TRAILING_CLASS} ${sizing.shortcutPadding} pointer-coarse:hidden`}>
			<Shortcut keys={keys} variant="text" className={sizing.shortcut} />
		</span>
	);
}

function useAriaKeyShortcuts(accelerator?: string, shortcut?: string): string | undefined {
	const isMac = useIsMac();
	if (accelerator !== undefined) return accelerator.toLowerCase();
	if (shortcut !== undefined) return toAriaKeyShortcuts(shortcut, isMac);
	return undefined;
}

export interface MenuItemProps extends Omit<
	ComponentProps<typeof BaseMenu.Item>,
	"onSelect" | "className" | "children"
> {
	children: ReactNode;
	/** Leading 20px icon slot, as on upstream's icon rows. */
	icon?: ReactNode;
	/** Muted second line, making the item upstream's 41px two-line row. */
	description?: ReactNode;
	/** Single key that fires this item while the menu is open. */
	accelerator?: string;
	/** Global shortcut hint shown instead of the accelerator, e.g. "alt+cmd+r". */
	shortcut?: string;
	variant?: MenuItemVariant;
	/**
	 * Why a disabled item is unavailable: it describes the item and shows in a reason tooltip on side right when
	 * the row is hovered or highlighted (upstream's cds MenuItem `disabledReason`).
	 */
	disabledReason?: string | undefined;
	onSelect?: () => void;
}

export function MenuItem({
	children,
	icon,
	description,
	accelerator,
	shortcut,
	variant = "default",
	disabledReason,
	onSelect,
	...props
}: MenuItemProps) {
	const itemClass = useItemClass(description !== undefined);
	const ariaKeyShortcuts = useAriaKeyShortcuts(accelerator, shortcut);
	const reasonId = useId();
	const reason =
		props.disabled === true && disabledReason !== undefined && disabledReason !== "" ? disabledReason : undefined;
	const item = (
		<BaseMenu.Item
			{...props}
			{...(reason === undefined ? {} : {"aria-describedby": reasonId})}
			{...(onSelect ? {onClick: onSelect} : {})}
			{...(ariaKeyShortcuts ? {"aria-keyshortcuts": ariaKeyShortcuts} : {})}
			{...(accelerator ? {"data-accelerator": accelerator.toLowerCase()} : {})}
			data-variant={variant}
			className={`${itemClass} ${ITEM_VARIANT_CLASS[variant]}`}
		>
			<ItemIcon icon={icon} />
			{description === undefined ? (
				<span data-menu-item-title="" className={LABEL_CLASS}>
					{children}
				</span>
			) : (
				<span className="flex min-w-0 flex-1 flex-col">
					<span data-menu-item-title="" className="truncate">
						{children}
					</span>
					<span data-menu-item-description="" className={DESCRIPTION_CLASS}>
						{description}
					</span>
				</span>
			)}
			<ItemTrailing
				{...(accelerator === undefined ? {} : {accelerator})}
				{...(shortcut === undefined ? {} : {shortcut})}
			/>
		</BaseMenu.Item>
	);
	if (reason === undefined) return item;
	/* Upstream's UV: no tab stop; the pointer lands on the role=none row, so hovering a disabled item still opens it. */
	return (
		<Tooltip content={reason} variant="reason" side="right" closeOnClick={false} portal className="w-full">
			<div role="none" className="w-full">
				{item}
				<span id={reasonId} hidden data-cds-disabled-reason="">
					{reason}
				</span>
			</div>
		</Tooltip>
	);
}

export interface MenuCheckboxItemProps extends Omit<
	ComponentProps<typeof BaseMenu.CheckboxItem>,
	"className" | "children"
> {
	children: ReactNode;
	accelerator?: string;
	/** Global shortcut hint shown before the check, e.g. "ctrl+shift+y". */
	shortcut?: string;
	/** Close the menu on pick, as upstream's View options rows do. Defaults to keeping it open. */
	closeOnClick?: boolean;
}

export function MenuCheckboxItem({
	children,
	accelerator,
	shortcut,
	closeOnClick = false,
	...props
}: MenuCheckboxItemProps) {
	const itemClass = useItemClass();
	const ariaKeyShortcuts = useAriaKeyShortcuts(accelerator, shortcut);
	return (
		<BaseMenu.CheckboxItem
			{...props}
			closeOnClick={closeOnClick}
			{...acceleratorProps(accelerator)}
			{...(ariaKeyShortcuts ? {"aria-keyshortcuts": ariaKeyShortcuts} : {})}
			className={`${itemClass} ${ITEM_VARIANT_CLASS.default}`}
		>
			<span className={LABEL_CLASS}>{children}</span>
			{shortcut !== undefined && <ItemTrailing shortcut={shortcut} />}
			<BaseMenu.CheckboxItemIndicator className={CHECK_SLOT_CLASS}>
				<Check aria-hidden="true" strokeWidth={3} className={CHECK_ICON_CLASS} />
			</BaseMenu.CheckboxItemIndicator>
		</BaseMenu.CheckboxItem>
	);
}

export interface MenuSwitchItemProps extends Omit<
	ComponentProps<typeof BaseMenu.Item>,
	"className" | "children" | "onClick" | "closeOnClick"
> {
	/** The row label, which also names the switch. */
	children: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}

/**
 * Upstream's keepOpen switch row (the folder menu's Worktree item): a plain menuitem, with no aria-checked,
 * whose trailing xs switch carries the state. Click, Enter and Space toggle it and the menu stays open.
 */
export function MenuSwitchItem({children, checked, onCheckedChange, ...props}: MenuSwitchItemProps) {
	const sizing = useMenuSizing();
	const itemClass = useItemClass(false, sizing.switchGap);
	return (
		<BaseMenu.Item
			closeOnClick={false}
			{...props}
			onClick={() => {
				onCheckedChange(!checked);
			}}
			className={`${itemClass} ${ITEM_VARIANT_CLASS.default}`}
		>
			<span className={LABEL_CLASS}>{children}</span>
			<span className={sizing.switchTrailing}>
				<MenuSwitch checked={checked} disabled={props.disabled} aria-label={children} />
			</span>
		</BaseMenu.Item>
	);
}

export const MenuRadioGroup = BaseMenu.RadioGroup;

/** One menu section, `role="group"`, as upstream wraps each run between separators. */
export function MenuGroup(props: ComponentProps<typeof BaseMenu.Group>) {
	return <BaseMenu.Group {...props} />;
}

function RadioItemText({children, description}: {children: ReactNode; description: ReactNode}) {
	if (description === undefined) return <span className={LABEL_CLASS}>{children}</span>;
	return (
		<span className="flex min-w-0 flex-1 flex-col">
			<span data-menu-item-title="" className="truncate">
				{children}
			</span>
			<span data-menu-item-description="" className={RADIO_DESCRIPTION_CLASS}>
				{description}
			</span>
		</span>
	);
}

/** Upstream's digit row trailing: the check slot first, then the keycap, pinned to the first line. */
function DigitTrailing({accelerator, hideAccelerator}: {accelerator: string; hideAccelerator: boolean}) {
	const sizing = useMenuSizing();
	return (
		<span data-menu-item-trailing="" className={DIGIT_TRAILING_CLASS}>
			<BaseMenu.RadioItemIndicator
				keepMounted
				className={DIGIT_CHECK_SLOT_CLASS}
				render={(slotProps, {checked}) => (
					<span {...slotProps}>
						{checked && <Check aria-hidden="true" strokeWidth={3} className={CHECK_ICON_CLASS} />}
					</span>
				)}
			/>
			{!hideAccelerator && (
				<Shortcut keys={accelerator} variant="text" className={`${sizing.shortcut} pointer-coarse:hidden`} />
			)}
		</span>
	);
}

export interface MenuRadioItemProps extends Omit<ComponentProps<typeof BaseMenu.RadioItem>, "className" | "children"> {
	children: ReactNode;
	/** Muted wrapping second line, making the item upstream's 41px two-line row. */
	description?: ReactNode;
	accelerator?: string;
	/** Upstream's checked model row: its ✓ replaces the visible digit, which still fires. */
	hideAccelerator?: boolean;
}

export function MenuRadioItem({
	children,
	description,
	accelerator,
	hideAccelerator = false,
	...props
}: MenuRadioItemProps) {
	const itemClass = useItemClass(description !== undefined);
	const check = (
		<BaseMenu.RadioItemIndicator className={CHECK_SLOT_CLASS}>
			<Check aria-hidden="true" strokeWidth={3} className={CHECK_ICON_CLASS} />
		</BaseMenu.RadioItemIndicator>
	);
	let trailing: ReactNode = check;
	if (accelerator !== undefined)
		trailing = <DigitTrailing accelerator={accelerator} hideAccelerator={hideAccelerator} />;
	else if (description !== undefined) {
		trailing = (
			<span data-menu-item-trailing="" className={FIRST_LINE_TRAILING_CLASS}>
				{check}
			</span>
		);
	}
	return (
		<BaseMenu.RadioItem
			closeOnClick={false}
			{...props}
			{...acceleratorProps(accelerator)}
			className={`${itemClass} ${ITEM_VARIANT_CLASS.default}`}
		>
			<RadioItemText description={description}>{children}</RadioItemText>
			{trailing}
		</BaseMenu.RadioItem>
	);
}

const SubmenuTriggerContext = createContext<RefObject<HTMLElement | null> | null>(null);

/**
 * Upstream's ss: a submenu re-runs the sheet gate at its own open rather than inheriting the root's.
 * Inside a sheet it drills in: open, it marks the parent level drilled, and its Back row closes it.
 */
export function MenuSub(props: ComponentProps<typeof BaseMenu.SubmenuRoot>) {
	const triggerRef = useRef<HTMLElement | null>(null);
	const {sheet, open, rootProps} = useMenuRootSheet(props);
	const parentLevel = useContext(SheetLevelContext);
	const drills = sheet && parentLevel !== null;
	const {defaultOpen: _defaultOpen, ...controlledProps} = rootProps;
	const {onOpenChange} = rootProps;
	const control = useMemo(
		() => ({
			triggerRef,
			close: () => {
				onOpenChange(false);
			},
		}),
		[onOpenChange],
	);
	useEffect(() => {
		if (parentLevel === null) return undefined;
		parentLevel.setDrilled(drills && open);
		return () => {
			parentLevel.setDrilled(false);
		};
	}, [parentLevel, drills, open]);
	return (
		<SubmenuTriggerContext.Provider value={triggerRef}>
			<SubmenuControlContext.Provider value={control}>
				<MenuSheetContext.Provider value={sheet}>
					<BaseMenu.SubmenuRoot {...controlledProps} open={open} />
				</MenuSheetContext.Provider>
			</SubmenuControlContext.Provider>
		</SubmenuTriggerContext.Provider>
	);
}

/**
 * cds' `ua()`: a submenu anchors to the parent popup's horizontal span at the
 * trigger row's height, so `sideOffset` measures from the popup edge, not the
 * row (the default 2 lands 6px past the row; Copy ▸'s -4 sits on the row edge).
 */
export function submenuAnchor(triggerRef: RefObject<HTMLElement | null>) {
	return {
		get contextElement() {
			return triggerRef.current ?? undefined;
		},
		getBoundingClientRect: () => {
			const trigger = triggerRef.current?.getBoundingClientRect();
			const popup = triggerRef.current?.closest('[role="menu"]')?.getBoundingClientRect();
			const x = popup?.x ?? trigger?.x ?? 0;
			const y = trigger?.y ?? 0;
			const width = popup?.width ?? trigger?.width ?? 0;
			const height = trigger?.height ?? 0;
			return {x, y, width, height, top: y, left: x, right: x + width, bottom: y + height};
		},
	};
}

/** cds resolves a submenu's logical inline-end side against the document direction. */
function inlineEndSide(): "left" | "right" {
	return document.documentElement.dir === "rtl" ? "left" : "right";
}

export interface MenuSubTriggerProps extends Omit<
	ComponentProps<typeof BaseMenu.SubmenuTrigger>,
	"className" | "children"
> {
	children: ReactNode;
	/** Leading 20px icon slot, as on upstream's icon rows. */
	icon?: ReactNode;
	/** Muted trailing value, e.g. the current radio choice. */
	value?: ReactNode;
	/** Render the trailing value in accent, for non-default choices. */
	valueAccent?: boolean;
}

/** Submenu trigger: opens on hover, click, Enter or ArrowRight. */
export function MenuSubTrigger({children, icon, value, valueAccent, ...props}: MenuSubTriggerProps) {
	const itemClass = useItemClass();
	const triggerRef = useContext(SubmenuTriggerContext);
	/* A sheet drills in on a press only; hover would yank the level sideways under the finger. */
	const sheet = useContext(MenuSheetContext);
	const parentLevel = useContext(SheetLevelContext);
	const drills = sheet && parentLevel !== null;
	return (
		<BaseMenu.SubmenuTrigger
			ref={triggerRef}
			openOnHover={!drills}
			delay={SUBMENU_HOVER_DELAY_MS}
			{...props}
			className={`${itemClass} ${ITEM_VARIANT_CLASS.default} justify-between data-[popup-open]:bg-fill-ghost-hover`}
		>
			<ItemIcon icon={icon} />
			<span data-menu-sub-label="" className={LABEL_CLASS}>
				{children}
			</span>
			<span className={`${TRAILING_CLASS} pl-3`}>
				{value !== undefined && (
					<span
						data-menu-value=""
						className={
							valueAccent
								? "max-w-[100px] truncate text-[12px]/[15px] text-accent-100"
								: "text-[12px]/[15px] text-[var(--menu-muted)]"
						}
					>
						{value}
					</span>
				)}
				<ChevronRight aria-hidden="true" className="-mr-1 size-4 shrink-0 text-[var(--menu-muted)]" />
			</span>
		</BaseMenu.SubmenuTrigger>
	);
}

export function MenuSubContent({
	children,
	className,
	side,
	align = "start",
	sideOffset = 2,
}: {
	children: ReactNode;
	className?: string;
	/** Defaults to inline-end; upstream's composer model submenus open to `inline-start` (left in LTR). */
	side?: MenuContentProps["side"];
	align?: MenuContentProps["align"];
	/** From the parent popup's edge (cds' default 2); upstream's Copy ▸ passes -4. */
	sideOffset?: number;
}) {
	const triggerRef = useContext(SubmenuTriggerContext);
	const anchor = useMemo(() => (triggerRef === null ? undefined : submenuAnchor(triggerRef)), [triggerRef]);
	return (
		<MenuContent
			nested
			side={side ?? inlineEndSide()}
			align={align}
			sideOffset={sideOffset}
			alignOffset={0}
			{...(anchor === undefined ? {} : {anchor})}
			{...(className === undefined ? {} : {className})}
		>
			{children}
		</MenuContent>
	);
}

export function MenuSeparator() {
	const sizing = useMenuSizing();
	return <BaseMenu.Separator className={`${sizing.separator} my-1 h-px bg-border`} />;
}

export function MenuLabel({
	children,
	className = "px-2 pt-1.5 pb-1 text-[12px]/[15px] text-[var(--menu-muted)]",
}: {
	children: ReactNode;
	/** Replaces the default classes, e.g. upstream's 500-weight Mode header padded 4px 8px. */
	className?: string;
}) {
	return (
		<div data-menu-label="" className={className}>
			{children}
		</div>
	);
}
