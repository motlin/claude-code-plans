import {ContextMenu as BaseContextMenu} from "@base-ui/react/context-menu";
import {Menu as BaseMenu} from "@base-ui/react/menu";
import {Check, ChevronRight} from "lucide-react";
import {
	type ComponentProps,
	createContext,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useContext,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

import {useIsMac} from "../../hooks/use-is-mac";
import {toAriaKeyShortcuts} from "../../lib/shortcuts/format";
import {type Density, DensityProvider, useDensity, useScopeDensity} from "./density";
import {MenuSwitch} from "./menu-switch";
import {useSheetPresentation} from "./sheet-presentation";
import {Shortcut} from "./shortcut";
import {Tooltip} from "./tooltip";

/*
 * One menu primitive copied from claude.ai/code (Base UI Menu / ContextMenu):
 * compact header rows and comfortable navigation rows, with 4px popup padding,
 * a right-aligned muted shortcut hint,
 * submenus that open on hover, click or ArrowRight, trailing accent checks for
 * radio/checkbox items, and single-key accelerators that fire while open.
 */

type MenuKind = "Menu" | "ContextMenu";

const MenuKindContext = createContext<MenuKind>("Menu");
const DENSITY_CLASSES = {
	compact: {
		popup: "rounded-r7",
		text: "text-[13px]/[19px]",
		item: "rounded-r5 px-2 py-[2.5px]",
		singleLine: "h-6 items-center",
		/* Upstream pads compact two-line rows 2.5px 8px 4px. */
		twoLine: "min-h-[41px] items-start pb-1",
		separator: "mx-2",
		shortcut: "[&>kbd]:leading-[15px]",
		shortcutPadding: "pl-[14px]",
		icon: "[&_svg]:size-4",
		/* Upstream's gap-xs and the switch row's ms-md trailing group. */
		switchGap: "gap-1.5",
		switchTrailing: "ms-3 flex shrink-0 items-center gap-1.5",
	},
	comfortable: {
		popup: "rounded-card",
		text: "text-[14px]/[20px]",
		item: "rounded-r6 px-2.5 py-1.5",
		singleLine: "h-8 items-center",
		twoLine: "min-h-8 items-start",
		separator: "mx-2.5",
		shortcut: "[&>kbd]:text-[13px] [&>kbd]:inline-flex [&>kbd]:items-baseline [&>kbd]:gap-[0.3em]",
		shortcutPadding: "pl-5",
		/* Upstream's size:"auto" icons follow --cds-icon: 16px compact, 20px comfortable. */
		icon: "[&_svg]:size-5",
		switchGap: "gap-2",
		switchTrailing: "ms-4 flex shrink-0 items-center gap-2",
	},
} as const;

const POSITIONER_CLASS = "z-[130] outline-none";

const POPUP_CLASS =
	"relative flex max-h-[var(--available-height)] min-w-[128px] max-w-[320px] flex-col bg-[var(--menu-bg)] font-normal text-primary shadow-[var(--menu-shadow)] outline-none select-none";

const SCROLLER_CLASS = "min-h-0 overflow-y-auto";

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

/** Upstream's Hc plus the slide-up enter and exit. */
const SHEET_POPUP_CLASS = `group/sheet relative flex w-full min-w-0 max-w-none flex-col overflow-hidden bg-[var(--menu-bg)] font-normal text-primary shadow-[var(--menu-shadow)] outline-none select-none rounded-t-[14px] rounded-b-none pb-[max(env(safe-area-inset-bottom),0.5rem)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] transition-[translate,height,scale] ${SHEET_MOTION} data-[starting-style]:translate-y-[calc(100%+1.5rem)] data-[ending-style]:translate-y-[calc(100%+1.5rem)]`;

/** Upstream's Gf (.9) resting cap and the .95 drag ceiling, both below the top safe area. */
const SHEET_POPUP_STYLE = {
	maxHeight: "calc((100dvh - env(safe-area-inset-top,0px)) * .95)",
	"--available-height": "calc((100dvh - env(safe-area-inset-top,0px)) * .9)",
} as const;

/** Upstream's tP: the level's content, which slides off when a submenu drills in. */
const SHEET_CONTENT_CLASS = `flex min-h-0 flex-1 flex-col transition-[translate] ${SHEET_MOTION} group-data-[cds-sheet-drilled]/sheet:-translate-x-[calc(100%+env(safe-area-inset-left,0px))] rtl:group-data-[cds-sheet-drilled]/sheet:translate-x-[calc(100%+env(safe-area-inset-right,0px))]`;

const SHEET_SCROLL_CLASS = "relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1";

/** Upstream's dt: the drag handle pill at the top of the sheet. */
function SheetHandle() {
	return (
		<div
			aria-hidden="true"
			data-cds-sheet-handle=""
			className="flex min-h-8 shrink-0 touch-none items-center justify-center select-none"
		>
			<div className="h-1 w-9 rounded-full bg-border" />
		</div>
	);
}

function useItemClass(twoLine = false, gap = "gap-1"): string {
	const sizing = DENSITY_CLASSES[useDensity()];
	return `flex w-full cursor-default ${twoLine ? sizing.twoLine : sizing.singleLine} ${gap} ${sizing.item} ${sizing.text} font-normal outline-none select-none [--shortcut-cap-ink:var(--menu-muted)] data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[disabled]:focus-visible:shadow-focus`;
}

const ITEM_VARIANT_CLASS = {
	default: "text-primary data-[highlighted]:bg-fill-ghost-hover",
	danger: "text-danger-100 data-[highlighted]:bg-[var(--menu-danger-fill)] data-[highlighted]:text-[var(--menu-on-danger)] data-[highlighted]:[--shortcut-cap-ink:currentColor]",
} as const;

const LABEL_CLASS = "min-w-0 flex-1 truncate";
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
	const glyph = DENSITY_CLASSES[useDensity()].icon;
	if (icon === undefined) return null;
	return (
		<span aria-hidden="true" className={`${ICON_SLOT_CLASS} ${glyph}`}>
			{icon}
		</span>
	);
}

export type MenuItemVariant = keyof typeof ITEM_VARIANT_CLASS;

/** Upstream's digit rows match the physical key, so Numpad digits and non-QWERTY layouts work. */
const DIGIT_CODE = /^(?:Digit|Numpad)([1-9])$/;

function acceleratorKey(event: KeyboardEvent<HTMLElement>): string | undefined {
	if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return undefined;
	const digit = DIGIT_CODE.exec(event.code)?.[1];
	if (digit !== undefined) return digit;
	if (event.key.length !== 1 || event.key === " ") return undefined;
	return event.key.toLowerCase();
}

function handleAcceleratorKey(event: KeyboardEvent<HTMLElement>): void {
	const key = acceleratorKey(event);
	if (key === undefined) return;
	const popup = event.currentTarget;
	if (!(event.target instanceof Element) || event.target.closest('[role="menu"]') !== popup) {
		return;
	}
	const item = Array.from(popup.querySelectorAll<HTMLElement>("[data-accelerator]")).find(
		(candidate) =>
			candidate.dataset["accelerator"] === key &&
			candidate.closest('[role="menu"]') === popup &&
			!candidate.hasAttribute("data-disabled"),
	);
	if (item === undefined) return;
	event.preventDefault();
	event.stopPropagation();
	item.click();
}

function acceleratorProps(accelerator: string | undefined) {
	if (accelerator === undefined) return {};
	const key = accelerator.toLowerCase();
	return {"aria-keyshortcuts": key, "data-accelerator": key};
}

/** Whether the enclosing menu root latched a bottom-sheet presentation at open. */
const MenuSheetContext = createContext(false);

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
function useMenuRootSheet<P extends MenuRootProps>(props: P): {sheet: boolean; rootProps: P} {
	const {open, defaultOpen, onOpenChange, onOpenChangeComplete} = props;
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
	const {sheet, onOpenChangeComplete: releaseLatch} = useSheetPresentation(open ?? uncontrolledOpen, {
		closable: open === undefined || onOpenChange !== undefined,
	});
	const rootProps = {
		...props,
		onOpenChange: (nextOpen: boolean, ...rest: never[]) => {
			setUncontrolledOpen(nextOpen);
			onOpenChange?.(nextOpen, ...rest);
		},
		onOpenChangeComplete: (completedOpen: boolean) => {
			releaseLatch(completedOpen);
			onOpenChangeComplete?.(completedOpen);
		},
	};
	return {sheet, rootProps};
}

export function Menu(props: ComponentProps<typeof BaseMenu.Root>) {
	const {sheet, rootProps} = useMenuRootSheet(props);
	return (
		<MenuKindContext.Provider value="Menu">
			<MenuSheetContext.Provider value={sheet}>
				<BaseMenu.Root {...rootProps} />
			</MenuSheetContext.Provider>
		</MenuKindContext.Provider>
	);
}

export const MenuTrigger = BaseMenu.Trigger;

export function ContextMenu(props: ComponentProps<typeof BaseContextMenu.Root>) {
	const {sheet, rootProps} = useMenuRootSheet(props);
	return (
		<MenuKindContext.Provider value="ContextMenu">
			<MenuSheetContext.Provider value={sheet}>
				<BaseContextMenu.Root {...rootProps} />
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
	/**
	 * Upstream's `structurallyAnchored`: the trigger keeps focus in an editor or input, so the popup stays
	 * anchored even where the root would otherwise present a bottom sheet.
	 */
	structurallyAnchored?: boolean;
}

interface MenuContentInternalProps extends MenuContentProps {
	/** A submenu level, which keeps its own layout until drill-in sheets land. */
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
	structurallyAnchored = false,
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
	const sheetTreeId = useId();
	/* Upstream's si order: an override, then comfortable on (pointer: coarse), then the prop or opener's density. */
	const resolvedDensity = useScopeDensity(density);
	const sizing = DENSITY_CLASSES[resolvedDensity];
	const popupClass = `${POPUP_CLASS} ${sizing.popup} p-1 ${sizing.text}`;
	if (sheet && !nested) {
		return (
			<DensityProvider density={resolvedDensity}>
				<BaseMenu.Portal>
					<BaseMenu.Backdrop
						data-presentation="sheet"
						data-sheet-scrim={sheetTreeId}
						className={SHEET_SCRIM_CLASS}
					/>
					<BaseMenu.Positioner
						className={SHEET_POSITIONER_CLASS}
						style={SHEET_POSITIONER_STYLE}
						data-density={resolvedDensity}
						collisionAvoidance={SHEET_COLLISION_AVOIDANCE}
						disableAnchorTracking
					>
						<BaseMenu.Popup
							data-cds={kind}
							data-presentation="sheet"
							data-sheet-tree={sheetTreeId}
							data-cds-sheet-depth="0"
							data-size="lg"
							className={`${SHEET_POPUP_CLASS} ${sizing.text}${className ? ` ${className}` : ""}`}
							style={SHEET_POPUP_STYLE}
							onKeyDown={handleAcceleratorKey}
							{...(finalFocus === undefined ? {} : {finalFocus})}
						>
							<SheetHandle />
							<div className={SHEET_CONTENT_CLASS}>
								<div data-cds-sheet-scroll="" className={SHEET_SCROLL_CLASS}>
									{children}
								</div>
							</div>
						</BaseMenu.Popup>
					</BaseMenu.Positioner>
				</BaseMenu.Portal>
			</DensityProvider>
		);
	}
	return (
		<DensityProvider density={resolvedDensity}>
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
						<div className={SCROLLER_CLASS}>{children}</div>
					</BaseMenu.Popup>
				</BaseMenu.Positioner>
			</BaseMenu.Portal>
		</DensityProvider>
	);
}

function ItemTrailing({accelerator, shortcut}: {accelerator?: string; shortcut?: string}) {
	const sizing = DENSITY_CLASSES[useDensity()];
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
	const sizing = DENSITY_CLASSES[useDensity()];
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
	const sizing = DENSITY_CLASSES[useDensity()];
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

/** Upstream's ss: a submenu re-runs the sheet gate at its own open rather than inheriting the root's. */
export function MenuSub(props: ComponentProps<typeof BaseMenu.SubmenuRoot>) {
	const triggerRef = useRef<HTMLElement | null>(null);
	const {sheet, rootProps} = useMenuRootSheet(props);
	return (
		<SubmenuTriggerContext.Provider value={triggerRef}>
			<MenuSheetContext.Provider value={sheet}>
				<BaseMenu.SubmenuRoot {...rootProps} />
			</MenuSheetContext.Provider>
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
	return (
		<BaseMenu.SubmenuTrigger
			ref={triggerRef}
			openOnHover
			delay={SUBMENU_HOVER_DELAY_MS}
			{...props}
			className={`${itemClass} ${ITEM_VARIANT_CLASS.default} justify-between data-[popup-open]:bg-fill-ghost-hover`}
		>
			<ItemIcon icon={icon} />
			<span className={LABEL_CLASS}>{children}</span>
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
	const sizing = DENSITY_CLASSES[useDensity()];
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
