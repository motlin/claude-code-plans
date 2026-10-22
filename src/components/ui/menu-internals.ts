import {createContext, type KeyboardEvent, type RefObject, useContext} from "react";
import {useDensity} from "./density";

/* The pieces of the menu primitive that both the anchored popup (./menu) and the lazy sheet (./menu-sheet) use. */

export type MenuKind = "Menu" | "ContextMenu";

export const MenuKindContext = createContext<MenuKind>("Menu");
export const DENSITY_CLASSES = {
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

/** Upstream's `ta("lg")` rows, which a sheet lays over its forced comfortable density. */
export const SHEET_SIZING = {
	...DENSITY_CLASSES.comfortable,
	text: "text-[15px]/[22px]",
	item: "rounded-r7 px-2.5 py-[9px]",
	singleLine: "min-h-10 items-center",
	separator: "mx-2.5",
	icon: "[&_svg]:size-5",
	shortcutPadding: "pl-5",
};

/** Whether the enclosing popup is a sheet, whose rows take the lg size whatever the consumer's density. */
export const MenuLgContext = createContext(false);

export function useMenuSizing() {
	const density = useDensity();
	return useContext(MenuLgContext) ? SHEET_SIZING : DENSITY_CLASSES[density];
}

export const POSITIONER_CLASS = "z-[130] outline-none";

/** One sheet level's link to its tree: the shared tree id, and how a submenu marks this level drilled. */
export interface SheetLevel {
	treeId: string;
	setDrilled: (drilled: boolean) => void;
}

export const SheetLevelContext = createContext<SheetLevel | null>(null);

/** The submenu a drilled level belongs to: its trigger, for the title, and how Back closes it. */
export interface SubmenuControl {
	triggerRef: RefObject<HTMLElement | null>;
	close: () => void;
}

export const SubmenuControlContext = createContext<SubmenuControl | null>(null);

export function useItemClass(twoLine = false, gap = "gap-1"): string {
	const sizing = useMenuSizing();
	return `flex w-full cursor-default ${twoLine ? sizing.twoLine : sizing.singleLine} ${gap} ${sizing.item} ${sizing.text} font-normal outline-none select-none [--shortcut-cap-ink:var(--menu-muted)] data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[disabled]:focus-visible:shadow-focus`;
}

export const LABEL_CLASS = "min-w-0 flex-1 truncate";

/** Upstream's digit rows match the physical key, so Numpad digits and non-QWERTY layouts work. */
const DIGIT_CODE = /^(?:Digit|Numpad)([1-9])$/;

function acceleratorKey(event: KeyboardEvent<HTMLElement>): string | undefined {
	if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return undefined;
	const digit = DIGIT_CODE.exec(event.code)?.[1];
	if (digit !== undefined) return digit;
	if (event.key.length !== 1 || event.key === " ") return undefined;
	return event.key.toLowerCase();
}

export function handleAcceleratorKey(event: KeyboardEvent<HTMLElement>): void {
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

/** The id the menu root gives its sheet tree, so closing the root can reach every open level. */
export const SheetTreeIdContext = createContext<string | null>(null);

/** Closes the root menu, so a drag on any level of its sheet can dismiss the whole tree. */
export const SheetDismissContext = createContext<() => void>(() => undefined);
