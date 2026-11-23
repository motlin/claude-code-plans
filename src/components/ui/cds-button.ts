import {CDS_BUTTON_DISABLED, CDS_BUTTON_DISABLED_FILL, CDS_BUTTON_DISABLED_OPEN_FILL} from "./cds-button-disabled";

/* Upstream's cds Button base (`kl`): a self-painting local copy with the shared disabled look. */
const CDS_BUTTON_BASE = `relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--upstream-radius)] whitespace-nowrap select-none hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus ${CDS_BUTTON_DISABLED}`;

/**
 * A cds ghost Button's hover: the 5% ghost hover, or under fizzy colour (upstream `CL`) the stronger button ghost
 * hover. For hand-copied ghost buttons that paint themselves.
 */
export const CDS_GHOST_HOVER = "hover:bg-fill-ghost-hover stacks:hover:bg-fill-button-ghost-hover";

/*
 * The primary paints like upstream `d9`: fill-primary at rest, fill-primary-hover on hover and while its menu is open.
 * Each variant keeps its pre-fizzy hover and adds upstream's fizzy-colour paints (`sT` hover/open, `Ct` press), moved
 * from the paint span's `group-…/btn:` onto the self-painted button.
 *
 * Selectors are spelled literally (never interpolated) so Tailwind's source scanner sees every class:
 * - `[:root:not([data-cds-fizzy-lake~=color])_&]` is upstream's `stacks:shadow-none`: the secondary's drop shadow and
 *   inset ring only paint outside fizzy colour.
 * - `[&[aria-haspopup][aria-expanded=true]]` is upstream's open-menu state, on the button itself.
 * - `[&:disabled:not([aria-busy])]` is upstream's non-busy disabled state.
 *
 * A pressed (`aria-pressed`) secondary or ghost takes upstream's accent paint and, on hover, one accent-layer gradient,
 * in every colour mode; the disabled fills still win.
 */
const CDS_BUTTON_VARIANTS =
{
	secondary: `bg-fill-secondary font-control-regular [:root:not([data-cds-fizzy-lake~=color])_&]:shadow-field-drop after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] [:root:not([data-cds-fizzy-lake~=color])_&]:after:shadow-[inset_0_0_0_1px_var(--color-fill-secondary-ring)] text-primary aria-pressed:text-upstream-accent hover:bg-fill-secondary-hover stacks:hover:bg-fill-secondary stacks:[&[aria-haspopup][aria-expanded=true]]:bg-fill-secondary stacks:hover:layers-1-fill-button-layer stacks:[&[aria-haspopup][aria-expanded=true]]:layers-2-fill-button-layer stacks:hover:[&[aria-haspopup][aria-expanded=true]]:layers-3-fill-button-layer stacks:active:layers-2-fill-button-layer aria-pressed:bg-upstream-accent-pressed hover:aria-pressed:bg-upstream-accent-pressed hover:aria-pressed:layers-1-upstream-accent-layer ${CDS_BUTTON_DISABLED_FILL} ${CDS_BUTTON_DISABLED_OPEN_FILL}`,
	ghost: `font-control-regular text-primary aria-pressed:text-upstream-accent ${CDS_GHOST_HOVER} stacks:[&[aria-haspopup][aria-expanded=true]]:bg-fill-button-ghost-hover stacks:hover:[&[aria-haspopup][aria-expanded=true]]:layers-1-fill-button-layer stacks:active:bg-fill-button-ghost-hover stacks:active:layers-1-fill-button-layer aria-pressed:bg-upstream-accent-pressed hover:aria-pressed:bg-upstream-accent-pressed hover:aria-pressed:layers-1-upstream-accent-layer stacks:[&:disabled:not([aria-busy])]:bg-transparent stacks:[&:disabled:not([aria-busy])]:[&[aria-haspopup][aria-expanded=true]]:bg-transparent`,
	/** The local destructive confirm: the danger menu fill on the primary's geometry and weight. */
	danger: `bg-[var(--menu-danger-fill)] font-control text-[var(--menu-on-danger)] [--shortcut-cap-ink:currentColor] hover:opacity-90 ${CDS_BUTTON_DISABLED_FILL}`,
	primary: `bg-fill-primary font-control text-surface-1 [--shortcut-cap-ink:currentColor] hover:bg-fill-primary-hover [&[aria-haspopup][aria-expanded=true]]:bg-fill-primary-hover stacks:active:bg-fill-primary-hover stacks:active:layers-1-fill-primary-layer stacks:[&[aria-haspopup][aria-expanded=true]]:bg-none ${CDS_BUTTON_DISABLED_FILL} ${CDS_BUTTON_DISABLED_OPEN_FILL}`,
} as const;

/** Upstream's cds Button inline pad: pad-md, capped by --cds-button-pad-max (9px under fizzy panels). */
export const CDS_BUTTON_PAD = "px-[min(var(--cds-pad-md),var(--cds-button-pad-max,var(--cds-pad-md)))]";

/**
 * Upstream's cds Button at the density control height and body text, its `size="sm"` button (20px, padding 0 6px,
 * 12/17), or its `size="xs"` button as comfortable density draws it (24px, 13/19, radius 6, the xs pad scale's
 * pad-md; pair it with `data-size="xs"`).
 */
const CDS_BUTTON_SIZES =
{
	default: `h-control ${CDS_BUTTON_PAD} text-body`,
	sm: "h-5 px-1.5 text-[12px]/[17px]",
	xs: `h-6 ${CDS_BUTTON_PAD} text-[13px]/[19px] [--upstream-radius:0.375rem]`,
} as const;

export type CdsButtonVariant = keyof typeof CDS_BUTTON_VARIANTS;
export type CdsButtonSize = keyof typeof CDS_BUTTON_SIZES;

/** Classes for upstream's ghost, filled secondary or black primary cds Button (or the red danger confirm), at the control height (or sm/xs). */
export function cdsButtonClass(variant: CdsButtonVariant, size: CdsButtonSize = "default"): string
{
	return `${CDS_BUTTON_BASE} ${CDS_BUTTON_SIZES[size]} ${CDS_BUTTON_VARIANTS[variant]}`;
}
