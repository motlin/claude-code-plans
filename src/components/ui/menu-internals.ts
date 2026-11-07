import {createContext, type KeyboardEvent, type RefObject, useContext} from "react";
import {useDensity} from "./density-context";

/* The pieces of the menu primitive that both the anchored popup (./menu) and the lazy sheet (./menu-sheet) use. */

export type MenuKind = "Menu" | "ContextMenu";

export const MenuKindContext = createContext<MenuKind>("Menu");
export const DENSITY_CLASSES = {
	compact: {
		popup: "rounded-r7",
		scroller: "",
		text: "text-[13px]/[19px]",
		item: "rounded-r5 px-2 py-[2.5px]",
		singleLine: "h-6 items-center",
		/* Upstream pads compact two-line rows 2.5px 8px 4px. */
		twoLine: "items-start pb-1",
		separator: "mx-2",
		icon: "[&_svg]:size-4",
		/* Upstream's row gap-xs and size-icon slot (--cds-icon 1rem), which may overflow a short line. */
		gap: "gap-1.5",
		iconSlot: "flex size-4 shrink-0 items-center justify-center -my-[max(0px,calc((1rem-1lh)/2))]",
		iconSlotTwoLine: "flex h-[1lh] w-4 shrink-0 items-center justify-center self-start",
		/* Upstream's ms-md gap-xs trailing group (switch rows, keycap accelerators). */
		trailingGroup: "ms-3 flex shrink-0 items-center gap-1.5",
		/* The same group on a digit row (upstream's mode rows), pinned to the first line. */
		digitTrailing: "flex shrink-0 items-center gap-1.5 ms-3 h-[1lh] self-start",
		iconBox: "size-4",
	},
	comfortable: {
		/* Upstream's radius + gutter: 8 + 4 = 12, or 8 + 6 = 14 under fizzy-lake panels on a fine pointer. */
		popup: "rounded-card panels-fine:rounded-menu-comfortable",
		/* Upstream's `--cds-menu-gutter`: 0.25rem, 0.375rem under panels (fine pointer), where the scroller
		   also has no 1px transparent bottom border. */
		scroller: "panels-fine:p-1.5 panels-fine:border-b-0",
		text: "text-[14px]/[20px]",
		/* Rows are upstream's h-control (32, 28 under panels on a fine pointer) with py (h-control - 20) / 2. */
		item: "rounded-r6 px-2.5 py-1.5 panels-fine:py-1",
		singleLine: "h-8 panels-fine:h-7 items-center",
		twoLine: "min-h-8 panels-fine:min-h-7 items-start",
		separator: "mx-2.5",
		/* Upstream's size:"auto" icons follow --cds-icon: 16px compact, 20px comfortable. */
		icon: "[&_svg]:size-5",
		gap: "gap-2",
		iconSlot: "flex size-5 shrink-0 items-center justify-center -my-[max(0px,calc((1.25rem-1lh)/2))]",
		iconSlotTwoLine: "flex h-[1lh] w-5 shrink-0 items-center justify-center self-start",
		trailingGroup: "ms-4 flex shrink-0 items-center gap-2",
		digitTrailing: "flex shrink-0 items-center gap-2 ms-4 h-[1lh] self-start",
		iconBox: "size-5",
	},
} as const;

/** Upstream's `ta("lg")` rows, which a sheet lays over its forced comfortable density. */
export const SHEET_SIZING = {
	...DENSITY_CLASSES.comfortable,
	/* A sheet is a coarse-pointer surface, so the panels fine-pointer sizes never apply. */
	popup: "rounded-card",
	scroller: "",
	twoLine: "min-h-8 items-start",
	text: "text-[15px]/[22px]",
	item: "rounded-r7 px-2.5 py-[9px]",
	singleLine: "min-h-10 items-center",
	separator: "mx-2.5",
	icon: "[&_svg]:size-5",
};

/**
 * A sheet's row size: upstream's `ta("lg")` by default, or the base comfortable rows its ModelSelector
 * keeps (no `data-size`).
 */
export type SheetSize = "lg" | "base";

/** The size a root sheet chose, which its drilled levels inherit. */
export const SheetSizeContext = createContext<SheetSize>("lg");

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

export function useItemClass(twoLine = false, gap?: string): string {
	const sizing = useMenuSizing();
	return `flex w-full cursor-default ${twoLine ? sizing.twoLine : sizing.singleLine} ${gap ?? sizing.gap} ${sizing.item} ${sizing.text} font-control-regular outline-none select-none [--shortcut-cap-ink:var(--menu-muted)] data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[disabled]:focus-visible:shadow-focus`;
}

export const LABEL_CLASS = "min-w-0 flex-1 truncate";

/** Upstream's eJ: a menu row's text hint is footnote-sized, hidden on touch, with tabular all-digit keys. */
export function menuHintClass(keys: string): string {
	return /^\d+$/.test(keys)
		? "pointer-coarse:hidden text-footnote tabular-nums"
		: "pointer-coarse:hidden text-footnote";
}

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
