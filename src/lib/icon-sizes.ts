import type {Density} from "../components/ui/density-context";

/* Upstream cds Icon's size table and weight math (shared-frame `Lw`, `NY`, `b3`, `Rb`, `uRr`, `qj`). */

const ICON_SIZES = ["xs", "sm", "md", "lg", "xl", "xxl"] as const;
export type IconSize = (typeof ICON_SIZES)[number];
export type IconSizeProp = IconSize | "auto" | "auto-sm" | "auto-lg";

interface IconSizeSpec {
	readonly px: number;
	/** Rendered stroke width in px. */
	readonly stroke: number;
	/** The `bold` stroke, where the size has one. */
	readonly strong?: number;
}

export const ICON_SIZE_TABLE: Readonly<Record<IconSize, IconSizeSpec>> = {
	xs: {px: 12, stroke: 1},
	sm: {px: 16, stroke: 1.25, strong: 1.5625},
	md: {px: 20, stroke: 1.25, strong: 1.5625},
	lg: {px: 24, stroke: 1.5},
	xl: {px: 28, stroke: 1.6667},
	xxl: {px: 32, stroke: 1.875},
};

/** Upstream `HS`: an Icon with no `size` is md. */
const DEFAULT_ICON_SIZE: IconSize = "md";

/** Upstream `b3(size, XE())`: `auto` is md in a comfortable scope, else sm; `auto-sm`/`auto-lg` step one size, keeping the base past either end. */
export function resolveIconSize(size: IconSizeProp | undefined, density: Density): IconSize {
	const base: IconSize = density === "comfortable" ? "md" : "sm";
	const requested = size ?? DEFAULT_ICON_SIZE;
	if (requested === "auto") return base;
	if (requested === "auto-sm" || requested === "auto-lg") {
		return ICON_SIZES[ICON_SIZES.indexOf(base) + (requested === "auto-lg" ? 1 : -1)] ?? base;
	}
	return requested;
}

/** Upstream `Rb`: the table size nearest a custom px, ties going to the larger. */
export function nearestIconSize(px: number): IconSize {
	let best: IconSize = ICON_SIZES[0];
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const size of ICON_SIZES) {
		const distance = Math.abs(ICON_SIZE_TABLE[size].px - px);
		if (distance <= bestDistance) {
			bestDistance = distance;
			best = size;
		}
	}
	return best;
}

/** Upstream `x2.wght`: stroke px at the 400 and 700 ends of each font master. */
const WGHT_MASTERS = {
	16: {lo: 1, hi: 1.5625},
	20: {lo: 1.171875, hi: 1.875},
} as const;
const [WGHT_MIN, WGHT_MAX] = [400, 700];

/**
 * Upstream `uRr` with `pT`'s master (`px < 18 ? 16 : 20`): the variable `wght` that draws `stroke` px
 * at `px`. The local Icon draws svg strokes directly, so this only documents what upstream's weights mean.
 */
export function iconWght(stroke: number, px: number): number {
	const master = px < 18 ? 16 : 20;
	const {lo, hi} = WGHT_MASTERS[master];
	const ratio = (stroke * master) / px;
	const wght = WGHT_MIN + (WGHT_MAX - WGHT_MIN) * ((ratio - lo) / (hi - lo));
	return Math.round(Math.max(WGHT_MIN, Math.min(WGHT_MAX, wght)) * 10) / 10;
}

/** Upstream `qj`: the glyph's font-size in rem, scaled by `--cds-rem-scale`. */
export function iconFontSize(px: number): string {
	return `calc(${px / 16}rem * var(--cds-rem-scale, 1))`;
}

/** Upstream `un`: the `nd` slot's `size-icon` box, pulled up by any overflow past one line. */
export const ICON_SLOT_CLASS =
	"flex size-icon shrink-0 items-center justify-center -my-[max(0px,calc((var(--cds-icon)_-_1lh)_/_2))]";
/** Upstream `Jv`: the `firstLine` slot, a `w-icon` box pinned to a multi-line row's first line. */
export const ICON_SLOT_FIRST_LINE_CLASS = "flex h-[1lh] w-icon shrink-0 items-center justify-center self-start";
