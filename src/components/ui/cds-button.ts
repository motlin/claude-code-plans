import {CDS_BUTTON_DISABLED, CDS_BUTTON_DISABLED_FILL} from "./cds-button-disabled";

/* Upstream's cds Button base (`kl`): a self-painting local copy with the shared disabled look. */
const CDS_BUTTON_BASE = `relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--upstream-radius)] whitespace-nowrap select-none hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus ${CDS_BUTTON_DISABLED}`;

/** Upstream's `stacks:shadow-none`: the secondary's drop shadow and inset ring only paint outside fizzy colour. */
const PRE_FIZZY = "[:root:not([data-cds-fizzy-lake~=color])_&]";

const CDS_BUTTON_VARIANTS = {
	secondary: `bg-fill-secondary font-control-regular ${PRE_FIZZY}:shadow-field-drop after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] ${PRE_FIZZY}:after:shadow-[inset_0_0_0_1px_var(--color-fill-secondary-ring)] text-primary hover:bg-fill-secondary-hover ${CDS_BUTTON_DISABLED_FILL}`,
	primary: `bg-primary font-control text-surface-1 [--shortcut-cap-ink:currentColor] hover:bg-primary/80 ${CDS_BUTTON_DISABLED_FILL}`,
} as const;

/** Upstream's cds Button inline pad: pad-md, capped by --cds-button-pad-max (9px under fizzy panels). */
export const CDS_BUTTON_PAD = "px-[min(var(--cds-pad-md),var(--cds-button-pad-max,var(--cds-pad-md)))]";

/** Upstream's cds Button at the density control height and body text, or its `size="sm"` button (20px, padding 0 6px, 12/17). */
const CDS_BUTTON_SIZES = {
	default: `h-control ${CDS_BUTTON_PAD} text-body`,
	sm: "h-5 px-1.5 text-[12px]/[17px]",
} as const;

export type CdsButtonVariant = keyof typeof CDS_BUTTON_VARIANTS;
export type CdsButtonSize = keyof typeof CDS_BUTTON_SIZES;

/** Classes for upstream's filled secondary or black primary cds Button, at the control height (or sm 20px). */
export function cdsButtonClass(variant: CdsButtonVariant, size: CdsButtonSize = "default"): string {
	return `${CDS_BUTTON_BASE} ${CDS_BUTTON_SIZES[size]} ${CDS_BUTTON_VARIANTS[variant]}`;
}
