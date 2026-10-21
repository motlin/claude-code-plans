import {ContextMenu as BaseContextMenu} from "@base-ui/react/context-menu";
import {Menu as BaseMenu} from "@base-ui/react/menu";
import {Check, ChevronRight} from "lucide-react";
import {type ComponentProps, createContext, type KeyboardEvent, type ReactNode, useContext} from "react";

import {useIsMac} from "../../hooks/use-is-mac";
import {toAriaKeyShortcuts} from "../../lib/shortcuts/format";
import {Shortcut} from "./shortcut";

/*
 * One menu primitive copied from claude.ai/code (Base UI Menu / ContextMenu):
 * compact header rows and comfortable navigation rows, with 4px popup padding,
 * a right-aligned muted shortcut hint,
 * submenus that open on hover, click or ArrowRight, trailing accent checks for
 * radio/checkbox items, and single-key accelerators that fire while open.
 */

type MenuKind = "Menu" | "ContextMenu";

const MenuKindContext = createContext<MenuKind>("Menu");
type MenuDensity = "compact" | "comfortable";
const MenuDensityContext = createContext<MenuDensity>("compact");
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
	},
} as const;

const POSITIONER_CLASS = "z-[130] outline-none";

const POPUP_CLASS =
	"relative flex max-h-[var(--available-height)] min-w-[128px] max-w-[320px] flex-col bg-[var(--menu-bg)] font-normal text-primary shadow-[var(--menu-shadow)] outline-none select-none";

const SCROLLER_CLASS = "min-h-0 overflow-y-auto";

function useItemClass(twoLine = false): string {
	const sizing = DENSITY_CLASSES[useContext(MenuDensityContext)];
	return `flex w-full cursor-default ${twoLine ? sizing.twoLine : sizing.singleLine} gap-1 ${sizing.item} ${sizing.text} font-normal outline-none select-none [--shortcut-cap-ink:var(--menu-muted)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50`;
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
	const glyph = DENSITY_CLASSES[useContext(MenuDensityContext)].icon;
	if (icon === undefined) return null;
	return (
		<span aria-hidden="true" className={`${ICON_SLOT_CLASS} ${glyph}`}>
			{icon}
		</span>
	);
}

export type MenuItemVariant = keyof typeof ITEM_VARIANT_CLASS;

function isAcceleratorEvent(event: KeyboardEvent<HTMLElement>): boolean {
	return (
		!event.defaultPrevented &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey &&
		event.key.length === 1 &&
		event.key !== " "
	);
}

function handleAcceleratorKey(event: KeyboardEvent<HTMLElement>): void {
	if (!isAcceleratorEvent(event)) return;
	const popup = event.currentTarget;
	if (!(event.target instanceof Element) || event.target.closest('[role="menu"]') !== popup) {
		return;
	}
	const key = event.key.toLowerCase();
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

export function Menu(props: ComponentProps<typeof BaseMenu.Root>) {
	return (
		<MenuKindContext.Provider value="Menu">
			<BaseMenu.Root {...props} />
		</MenuKindContext.Provider>
	);
}

export const MenuTrigger = BaseMenu.Trigger;

export function ContextMenu(props: ComponentProps<typeof BaseContextMenu.Root>) {
	return (
		<MenuKindContext.Provider value="ContextMenu">
			<BaseContextMenu.Root {...props} />
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
	/** Navigation menus use larger rows; nested popups inherit their parent density. */
	density?: MenuDensity;
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
}

/** The popup surface. Inside a ContextMenu it opens at the pointer. */
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
}: MenuContentProps) {
	const resolvedCollisionAvoidance =
		collisionAvoidance ?? (INLINE_SIDES.has(side) ? SIDE_COLLISION_AVOIDANCE : undefined);
	const collisionFallback =
		resolvedCollisionAvoidance !== undefined && "fallbackAxisSide" in resolvedCollisionAvoidance
			? resolvedCollisionAvoidance.fallbackAxisSide
			: undefined;
	const kind = useContext(MenuKindContext);
	const inheritedDensity = useContext(MenuDensityContext);
	const resolvedDensity = density ?? inheritedDensity;
	const sizing = DENSITY_CLASSES[resolvedDensity];
	const popupClass = `${POPUP_CLASS} ${sizing.popup} p-1 ${sizing.text}`;
	return (
		<MenuDensityContext.Provider value={resolvedDensity}>
			<BaseMenu.Portal>
				<BaseMenu.Positioner
					className={POSITIONER_CLASS}
					side={side}
					align={align}
					sideOffset={sideOffset}
					alignOffset={alignOffset}
					data-side-offset={sideOffset}
					data-align-offset={alignOffset}
					{...(resolvedCollisionAvoidance === undefined
						? {}
						: {collisionAvoidance: resolvedCollisionAvoidance})}
					{...(collisionFallback === undefined ? {} : {"data-collision-fallback": collisionFallback})}
				>
					<BaseMenu.Popup
						data-cds={kind}
						className={className ? `${popupClass} ${className}` : popupClass}
						onKeyDown={handleAcceleratorKey}
						{...(finalFocus === undefined ? {} : {finalFocus})}
					>
						<div className={SCROLLER_CLASS}>{children}</div>
					</BaseMenu.Popup>
				</BaseMenu.Positioner>
			</BaseMenu.Portal>
		</MenuDensityContext.Provider>
	);
}

function ItemTrailing({accelerator, shortcut}: {accelerator?: string; shortcut?: string}) {
	const sizing = DENSITY_CLASSES[useContext(MenuDensityContext)];
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
	onSelect?: () => void;
}

export function MenuItem({
	children,
	icon,
	description,
	accelerator,
	shortcut,
	variant = "default",
	onSelect,
	...props
}: MenuItemProps) {
	const itemClass = useItemClass(description !== undefined);
	const ariaKeyShortcuts = useAriaKeyShortcuts(accelerator, shortcut);
	return (
		<BaseMenu.Item
			{...props}
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
}

export interface MenuCheckboxItemProps extends Omit<
	ComponentProps<typeof BaseMenu.CheckboxItem>,
	"className" | "children"
> {
	children: ReactNode;
	accelerator?: string;
	/** Global shortcut hint shown before the check, e.g. "ctrl+shift+y". */
	shortcut?: string;
}

export function MenuCheckboxItem({children, accelerator, shortcut, ...props}: MenuCheckboxItemProps) {
	const itemClass = useItemClass();
	const ariaKeyShortcuts = useAriaKeyShortcuts(accelerator, shortcut);
	return (
		<BaseMenu.CheckboxItem
			closeOnClick={false}
			{...props}
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

export const MenuRadioGroup = BaseMenu.RadioGroup;

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
function DigitTrailing({accelerator}: {accelerator: string}) {
	const sizing = DENSITY_CLASSES[useContext(MenuDensityContext)];
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
			<Shortcut keys={accelerator} variant="text" className={`${sizing.shortcut} pointer-coarse:hidden`} />
		</span>
	);
}

export interface MenuRadioItemProps extends Omit<ComponentProps<typeof BaseMenu.RadioItem>, "className" | "children"> {
	children: ReactNode;
	/** Muted wrapping second line, making the item upstream's 41px two-line row. */
	description?: ReactNode;
	accelerator?: string;
}

export function MenuRadioItem({children, description, accelerator, ...props}: MenuRadioItemProps) {
	const itemClass = useItemClass(description !== undefined);
	const check = (
		<BaseMenu.RadioItemIndicator className={CHECK_SLOT_CLASS}>
			<Check aria-hidden="true" strokeWidth={3} className={CHECK_ICON_CLASS} />
		</BaseMenu.RadioItemIndicator>
	);
	let trailing: ReactNode = check;
	if (accelerator !== undefined) trailing = <DigitTrailing accelerator={accelerator} />;
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

export function MenuSub(props: ComponentProps<typeof BaseMenu.SubmenuRoot>) {
	return <BaseMenu.SubmenuRoot {...props} />;
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
	return (
		<BaseMenu.SubmenuTrigger
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
	side = "right",
	align = "start",
	sideOffset = 2,
}: {
	children: ReactNode;
	className?: string;
	/** Upstream's composer model submenus open to `inline-start` (left in LTR). */
	side?: MenuContentProps["side"];
	align?: MenuContentProps["align"];
	sideOffset?: number;
}) {
	return (
		<MenuContent
			side={side}
			align={align}
			sideOffset={sideOffset}
			alignOffset={0}
			{...(className === undefined ? {} : {className})}
		>
			{children}
		</MenuContent>
	);
}

export function MenuSeparator() {
	const sizing = DENSITY_CLASSES[useContext(MenuDensityContext)];
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
