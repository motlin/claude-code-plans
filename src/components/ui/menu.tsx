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
import {DensityProvider} from "./density";
import {type Density, useScopeDensity} from "./density-context";
import {
	DENSITY_CLASSES,
	handleAcceleratorKey,
	LABEL_CLASS,
	menuHintClass,
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
import {inlineEndSide, submenuAnchor} from "./menu-anchor";
import type {SheetContentProps} from "./menu-sheet";
import {loadedMenuSheet, preloadMenuSheet} from "./menu-sheet-loader";
import {Icon} from "./icon";
import {MenuSwitch} from "./menu-switch";
import {useSheetPresentation} from "./sheet-presentation";
import {FORCED_COLORS_BORDER_CLASS} from "./popover-surface";
import {Kbd, Shortcut} from "./shortcut";
import {Tooltip} from "./tooltip";
import {overlayAttrs} from "../../lib/overlay";

const LazyRootSheetContent = lazy(async () =>
	preloadMenuSheet().then((module) => ({default: module.RootSheetContent})),
);
const LazyNestedSheetContent = lazy(async () =>
	preloadMenuSheet().then((module) => ({default: module.NestedSheetContent})),
);

function RootSheet(props: SheetContentProps) {
	const menuSheetModule = loadedMenuSheet();
	if (menuSheetModule !== null) return <menuSheetModule.RootSheetContent {...props} />;
	return (
		<Suspense fallback={null}>
			<LazyRootSheetContent {...props} />
		</Suspense>
	);
}

function NestedSheet(props: SheetContentProps & {treeId: string}) {
	const menuSheetModule = loadedMenuSheet();
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

const POPUP_CLASS = `relative flex max-h-[var(--available-height)] min-w-[128px] max-w-[320px] flex-col bg-[var(--menu-bg)] shadow-[var(--menu-shadow)] ${FORCED_COLORS_BORDER_CLASS} font-normal text-primary outline-none select-none`;

/**
 * Upstream's scroller owns the gutter (`p-[var(--cds-menu-gutter)]`) and the `scroll-fade-y` edge fade, and carries a
 * `border-b-[length:var(--cds-ring-inner)] border-transparent` 1px bottom border. Upstream's `z0` spreads `{[Wj]:""}`
 * (`data-cds-sheet-scroll`) on both its plain (`bY`) and header/footer (`f9`) scrollers, so the anchored body and the
 * sheet share one marker that `Hi`/`yt`/`St` measure; on an anchored popup nothing reads it.
 */
const SCROLLER_CLASS =
	"relative min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-y rounded-[inherit] border-b border-transparent forced-colors:border-b-0 p-1";

const ITEM_VARIANT_CLASS = {
	default: "text-primary data-[highlighted]:bg-fill-ghost-hover",
	danger: "text-danger-100 data-[highlighted]:bg-[var(--menu-danger-fill)] data-[highlighted]:text-[var(--menu-on-danger)] data-[highlighted]:[--shortcut-cap-ink:currentColor]",
} as const;

/** Upstream's description wraps rather than truncates and has no top padding, so a two-line row is 40.5px. */
const DESCRIPTION_CLASS = "break-words text-[12px]/[15px] text-[var(--menu-muted)]";
const TRAILING_CLASS = "ml-auto flex shrink-0 items-center gap-1";
/** Pins a two-line row's keycap and check to its first line. */
const FIRST_LINE_TRAILING_CLASS = `${TRAILING_CLASS} h-[1lh] self-start`;
const DIGIT_CHECK_SLOT_CLASS = "flex size-4 shrink-0 items-center justify-center pointer-coarse:-me-1";
const CHECK_SLOT_CLASS = "-mr-1 flex size-icon shrink-0 items-center justify-center";
/** Upstream's checked tick: a bold sm Check Icon (16px) in fill-accent ink. */
const CHECK_ICON = <Icon name="Check" size="sm" bold className="text-fill-accent" />;
/** Hover dwell before a submenu opens. */
const SUBMENU_HOVER_DELAY_MS = 100;
/** Upstream's `size-icon` leading slot; a two-line row pins it to the first line. */
function ItemIcon({icon, twoLine = false}: {icon: ReactNode; twoLine?: boolean}) {
	const sizing = useMenuSizing();
	if (icon === undefined) return null;
	return (
		<span
			aria-hidden="true"
			className={`${twoLine ? sizing.iconSlotTwoLine : sizing.iconSlot} [&_svg]:shrink-0 ${sizing.icon}`}
		>
			{icon}
		</span>
	);
}

/** A row's label, or upstream's two-line label over a wrapping muted description. */
function ItemText({children, description}: {children: ReactNode; description: ReactNode}) {
	if (description === undefined) {
		return (
			<span data-menu-item-title="" className={LABEL_CLASS}>
				{children}
			</span>
		);
	}
	return (
		<span className="flex min-w-0 flex-1 flex-col">
			<span data-menu-item-title="" className="truncate">
				{children}
			</span>
			<span data-menu-item-description="" className={DESCRIPTION_CLASS}>
				{description}
			</span>
		</span>
	);
}

export type MenuItemVariant = keyof typeof ITEM_VARIANT_CLASS;
export type AcceleratorVariant = "text" | "keycap";

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
	/** Extra attributes for the popup element, such as an `aria-label` or a `data-*` hook for a menu with no trigger. */
	popupProps?: MenuPopupProps;
	/** The popup's `data-cds` name, anchored and as a sheet, such as upstream's `"ModelSelector"`; defaults to the menu kind. */
	cds?: string;
}

type MenuPopupProps = Omit<
	ComponentProps<typeof BaseMenu.Popup>,
	"className" | "children" | "finalFocus" | "onKeyDown" | "render"
> &
	Partial<Record<`data-${string}`, string>>;

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
	popupProps,
	cds,
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
		popupProps,
		cds,
	};
	if (sheet && !nested) return <RootSheet {...sheetProps} size={sheetSize} />;
	/* A submenu drills in only inside a sheet tree; an anchored parent keeps its fly-out. */
	if (sheet && parentLevel !== null) return <NestedSheet {...sheetProps} treeId={parentLevel.treeId} />;
	/* A sheet's portal forces comfortable (`density: MG`) at every account density. */
	const resolvedDensity = sheet ? "comfortable" : scopeDensity;
	const sizing = sheet ? SHEET_SIZING : DENSITY_CLASSES[resolvedDensity];
	const popupClass = `${POPUP_CLASS} ${sizing.popup} ${sizing.text}`;
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
							{...overlayAttrs}
							{...popupProps}
							data-cds={cds ?? kind}
							{...(sheet ? {"data-presentation": "sheet"} : {})}
							className={className ? `${popupClass} ${className}` : popupClass}
							onKeyDown={handleAcceleratorKey}
							{...(finalFocus === undefined ? {} : {finalFocus})}
						>
							{header !== undefined && <div className="shrink-0 px-1 pt-1">{header}</div>}
							<div
								data-menu-scroller=""
								data-cds-sheet-scroll=""
								/* Under a pinned header the gutter drops its top, as upstream's `p-gutter pt-0`. */
								className={`${SCROLLER_CLASS}${sizing.scroller === "" ? "" : ` ${sizing.scroller}`}${header === undefined ? "" : " pt-0"}`}
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

function ItemTrailing({
	accelerator,
	shortcut,
	acceleratorVariant = "text",
}: {
	accelerator?: string;
	shortcut?: string;
	acceleratorVariant?: AcceleratorVariant;
}) {
	const sizing = useMenuSizing();
	const keys = shortcut ?? accelerator;
	if (keys === undefined) return null;
	/* Upstream's boxed accelerator: a bare Kbd in the ms-md gap-xs trailing group, kept on touch. */
	if (acceleratorVariant === "keycap" && shortcut === undefined && accelerator !== undefined) {
		return (
			<span aria-hidden="true" className={sizing.trailingGroup}>
				<Kbd>{accelerator.toUpperCase()}</Kbd>
			</span>
		);
	}
	return (
		<span aria-hidden="true" className={`${sizing.trailingGroup} pointer-coarse:hidden`}>
			<Shortcut keys={keys} variant="text" className={menuHintClass(keys)} />
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
	/** Muted second line, making the item upstream's 40.5px two-line row. */
	description?: ReactNode;
	/** Single key that fires this item while the menu is open. */
	accelerator?: string;
	/** Global shortcut hint shown instead of the accelerator, e.g. "alt+cmd+r". */
	shortcut?: string;
	/** Draw the accelerator as upstream's boxed `Kbd` keycap (the palette row-actions card) instead of muted text. */
	acceleratorVariant?: AcceleratorVariant;
	/** Right-aligned trailing content after the label, such as upstream's loading spinner. */
	trailing?: ReactNode;
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
	acceleratorVariant = "text",
	trailing,
	variant = "default",
	disabledReason,
	onSelect,
	...props
}: MenuItemProps) {
	const itemClass = useItemClass(description !== undefined);
	const ariaKeyShortcuts = useAriaKeyShortcuts(accelerator, shortcut);
	const reasonId = useId();
	const reason = activeDisabledReason(props.disabled, disabledReason);
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
			<ItemIcon icon={icon} twoLine={description !== undefined} />
			<ItemText description={description}>{children}</ItemText>
			<ItemTrailing
				{...(accelerator === undefined ? {} : {accelerator})}
				{...(shortcut === undefined ? {} : {shortcut})}
				acceleratorVariant={acceleratorVariant}
			/>
			{trailing !== undefined && <span className={TRAILING_CLASS}>{trailing}</span>}
		</BaseMenu.Item>
	);
	if (reason === undefined) return item;
	return (
		<DisabledReasonRow reason={reason} reasonId={reasonId}>
			{item}
		</DisabledReasonRow>
	);
}

/** The reason a disabled item is unavailable, or undefined when it is enabled or has none. */
function activeDisabledReason(disabled: boolean | undefined, disabledReason: string | undefined): string | undefined {
	return disabled === true && disabledReason !== undefined && disabledReason !== "" ? disabledReason : undefined;
}

/**
 * Upstream's UV: no tab stop; the pointer lands on the role=none row, so hovering a disabled item still opens its
 * reason tooltip on side right, and the hidden reason describes the item.
 */
function DisabledReasonRow({reason, reasonId, children}: {reason: string; reasonId: string; children: ReactNode}) {
	return (
		<Tooltip content={reason} variant="reason" side="right" closeOnClick={false} portal className="w-full">
			<div role="none" className="w-full">
				{children}
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
	/** Upstream's View options leading icon: a 16px slot before the label, with the row's gap-xs. */
	icon?: ReactNode;
	/** Upstream's trailing Counter; while it shows on an unchecked row, the check slot is left out. */
	count?: number;
	/**
	 * Upstream's multi-select filter row (the Artifacts Type submenu): a leading cds checkbox in the icon slot
	 * instead of the trailing check.
	 */
	leadingCheck?: boolean;
	/** Muted trailing hint text after the label, such as upstream's filter count ("8+"). */
	hint?: ReactNode;
}

/** Upstream's compact `Counter`: a 16px pill in neutral fill with caption-medium muted digits. */
const COUNTER_CLASS =
	"inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-alpha-1 px-[4.8px] text-caption font-medium text-secondary";

export function MenuCheckboxItem({
	children,
	accelerator,
	shortcut,
	closeOnClick = false,
	icon,
	count,
	leadingCheck = false,
	hint,
	...props
}: MenuCheckboxItemProps) {
	const itemClass = useItemClass();
	const ariaKeyShortcuts = useAriaKeyShortcuts(accelerator, shortcut);
	const showCount = count !== undefined && count > 0 && props.checked !== true;
	if (leadingCheck) {
		return (
			<BaseMenu.CheckboxItem
				{...props}
				closeOnClick={closeOnClick}
				className={`${itemClass} ${ITEM_VARIANT_CLASS.default} group/cb`}
			>
				<span aria-hidden="true" className="-ms-1 flex size-5 shrink-0 items-center justify-center">
					<BaseMenu.CheckboxItemIndicator
						keepMounted
						render={(slotProps, {checked}) => (
							<span
								{...slotProps}
								data-cds-checkbox=""
								className={`flex size-4 items-center justify-center rounded-r4 border ${checked ? "border-fill-accent bg-fill-accent text-white" : "border-checkbox-edge group-hover/cb:border-checkbox-edge-hover"}`}
							>
								{checked && <Check aria-hidden="true" strokeWidth={3} className="size-3" />}
							</span>
						)}
					/>
				</span>
				<span className={LABEL_CLASS}>{children}</span>
				{hint !== undefined && (
					<span
						data-menu-hint=""
						className="ms-3 max-w-[160px] shrink-0 truncate text-footnote tabular-nums text-ink-muted"
					>
						{hint}
					</span>
				)}
			</BaseMenu.CheckboxItem>
		);
	}
	return (
		<BaseMenu.CheckboxItem
			{...props}
			closeOnClick={closeOnClick}
			{...acceleratorProps(accelerator)}
			{...(ariaKeyShortcuts ? {"aria-keyshortcuts": ariaKeyShortcuts} : {})}
			className={`${itemClass} ${ITEM_VARIANT_CLASS.default}`}
		>
			{icon !== undefined && (
				<span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
					{icon}
				</span>
			)}
			<span className={LABEL_CLASS}>{children}</span>
			{shortcut !== undefined && <ItemTrailing shortcut={shortcut} />}
			{showCount ? (
				<span className="ms-3 flex shrink-0 items-center gap-1.5">
					<span data-cds="Counter" className={COUNTER_CLASS}>
						{count}
					</span>
				</span>
			) : (
				<BaseMenu.CheckboxItemIndicator data-check-slot="" className={CHECK_SLOT_CLASS}>
					{CHECK_ICON}
				</BaseMenu.CheckboxItemIndicator>
			)}
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
	const itemClass = useItemClass();
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
			<span className={sizing.trailingGroup}>
				<MenuSwitch checked={checked} disabled={props.disabled} aria-label={children} />
			</span>
		</BaseMenu.Item>
	);
}

export interface MenuCheckboxSwitchItemProps extends Omit<
	ComponentProps<typeof BaseMenu.CheckboxItem>,
	"className" | "children" | "checked"
> {
	/** The row label, which also names the switch. */
	children: string;
	icon?: ReactNode;
	checked: boolean;
	/** Close the menu on pick. Defaults to upstream's keepOpen. */
	closeOnClick?: boolean;
	/**
	 * Upstream's Fast mode row: the sm switch sits in an `aria-hidden` `pointer-events-none` wrapper, so it is
	 * purely decorative and the row's `aria-checked` alone carries the state. Its label takes upstream's `kk` nest.
	 */
	decorative?: boolean;
	/** A decorative row's muted second line, as upstream's blocked Fast mode row. */
	description?: string | undefined;
	/** Why a disabled row is unavailable: it describes the row and shows in a reason tooltip, as `MenuItem`'s. */
	disabledReason?: string | undefined;
}

/**
 * Upstream's connector row: a `menuitemcheckbox` whose `aria-checked` carries the state, with a trailing xs
 * switch wrapped in `inert` so it is display-only and the row stays the single focus and click target.
 */
export function MenuCheckboxSwitchItem({
	children,
	icon,
	checked,
	closeOnClick = false,
	decorative = false,
	description,
	disabledReason,
	...props
}: MenuCheckboxSwitchItemProps) {
	const sizing = useMenuSizing();
	// Upstream's `kk` row has no fixed height: a description line grows it, with the switch kept centred.
	const itemClass = useItemClass().replace(
		sizing.singleLine,
		decorative && description !== undefined ? "items-center" : sizing.singleLine,
	);
	const reasonId = useId();
	const reason = activeDisabledReason(props.disabled, disabledReason);
	const item = (
		<BaseMenu.CheckboxItem
			{...props}
			{...(reason === undefined ? {} : {"aria-describedby": reasonId})}
			checked={checked}
			closeOnClick={closeOnClick}
			className={`${itemClass} ${ITEM_VARIANT_CLASS.default}`}
		>
			<ItemIcon icon={icon} />
			<span data-menu-item-title="" className={LABEL_CLASS}>
				{decorative ? (
					/* Upstream's `kk` label: a wrapping block holding the truncated title, then the muted line. */
					<span className="block min-w-0 whitespace-normal">
						<span className="flex min-w-0 items-center gap-1">
							<span className="truncate">{children}</span>
						</span>
						{description !== undefined && (
							<span className="mt-1 block text-[12px]/[15px] text-[var(--menu-muted)]">
								{description}
							</span>
						)}
					</span>
				) : (
					children
				)}
			</span>
			{decorative ? (
				<span className={sizing.trailingGroup}>
					<div aria-hidden="true" className="pointer-events-none inline-flex items-center">
						<span inert className="inline-flex">
							<MenuSwitch checked={checked} disabled={props.disabled} size="sm" />
						</span>
					</div>
				</span>
			) : (
				<span inert className={sizing.trailingGroup}>
					<MenuSwitch
						checked={checked}
						disabled={props.disabled}
						readOnly
						aria-label={`${children} enabled`}
					/>
				</span>
			)}
		</BaseMenu.CheckboxItem>
	);
	if (reason === undefined) return item;
	return (
		<DisabledReasonRow reason={reason} reasonId={reasonId}>
			{item}
		</DisabledReasonRow>
	);
}

export const MenuRadioGroup = BaseMenu.RadioGroup;

/** One menu section, `role="group"`, as upstream wraps each run between separators. */
export function MenuGroup(props: ComponentProps<typeof BaseMenu.Group>) {
	return <BaseMenu.Group {...props} />;
}

/** Upstream's digit row trailing: the check slot first, then the text digit, pinned to the first line. */
function DigitTrailing({accelerator}: {accelerator: string}) {
	const sizing = useMenuSizing();
	return (
		<span data-menu-item-trailing="" className={sizing.digitTrailing}>
			<BaseMenu.RadioItemIndicator
				keepMounted
				className={DIGIT_CHECK_SLOT_CLASS}
				render={(slotProps, {checked}) => <span {...slotProps}>{checked && CHECK_ICON}</span>}
			/>
			<Shortcut keys={accelerator} variant="text" className={menuHintClass(accelerator)} />
		</span>
	);
}

/** Upstream's model row trailing (Bp): one check slot holding the muted digit, which the ✓ replaces when checked. */
function SlotDigitTrailing({accelerator}: {accelerator: string}) {
	const sizing = useMenuSizing();
	return (
		<span data-menu-item-trailing="" className={sizing.trailingGroup}>
			<BaseMenu.RadioItemIndicator
				keepMounted
				render={(slotProps, {checked}) => (
					<span
						{...slotProps}
						aria-hidden="true"
						className={`-me-1 flex ${sizing.iconBox} shrink-0 items-center justify-center`}
					>
						{checked ? (
							CHECK_ICON
						) : (
							<span className="pointer-coarse:hidden text-footnote text-[var(--menu-muted)]">
								{accelerator}
							</span>
						)}
					</span>
				)}
			/>
		</span>
	);
}

export interface MenuRadioItemProps extends Omit<ComponentProps<typeof BaseMenu.RadioItem>, "className" | "children"> {
	children: ReactNode;
	/** Muted wrapping second line, making the item upstream's 40.5px two-line row. */
	description?: ReactNode;
	accelerator?: string;
	/** Upstream's model rows: the digit sits in the check slot, and a checked row's ✓ replaces it (the key still fires). */
	acceleratorInSlot?: boolean;
	/** Why a disabled row is unavailable: it describes the row and shows in a reason tooltip, as `MenuItem`'s. */
	disabledReason?: string | undefined;
}

export function MenuRadioItem({
	children,
	description,
	accelerator,
	acceleratorInSlot = false,
	disabledReason,
	...props
}: MenuRadioItemProps) {
	const itemClass = useItemClass(description !== undefined);
	const reasonId = useId();
	const reason = activeDisabledReason(props.disabled, disabledReason);
	const check = <BaseMenu.RadioItemIndicator className={CHECK_SLOT_CLASS}>{CHECK_ICON}</BaseMenu.RadioItemIndicator>;
	let trailing: ReactNode = check;
	if (accelerator !== undefined)
		trailing = acceleratorInSlot ? (
			<SlotDigitTrailing accelerator={accelerator} />
		) : (
			<DigitTrailing accelerator={accelerator} />
		);
	else if (description !== undefined) {
		trailing = (
			<span data-menu-item-trailing="" className={FIRST_LINE_TRAILING_CLASS}>
				{check}
			</span>
		);
	}
	const item = (
		<BaseMenu.RadioItem
			closeOnClick={false}
			{...props}
			{...(reason === undefined ? {} : {"aria-describedby": reasonId})}
			{...acceleratorProps(accelerator)}
			className={`${itemClass} ${ITEM_VARIANT_CLASS.default}`}
		>
			<ItemText description={description}>{children}</ItemText>
			{trailing}
		</BaseMenu.RadioItem>
	);
	if (reason === undefined) return item;
	return (
		<DisabledReasonRow reason={reason} reasonId={reasonId}>
			{item}
		</DisabledReasonRow>
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
	const sizing = useMenuSizing();
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
			{/* Upstream's `ms-md gap-xs` trailing group around a `max-w-[160px] text-footnote` value. */}
			<span className={sizing.trailingGroup}>
				{value !== undefined && (
					<span
						data-menu-value=""
						className={
							valueAccent
								? "max-w-[100px] truncate text-[12px]/[15px] text-accent-100"
								: "max-w-[160px] shrink-0 truncate text-footnote text-[var(--menu-muted)]"
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
