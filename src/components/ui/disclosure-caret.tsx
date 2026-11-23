import {Icon} from "./icon";

const CARET_STYLE =
{
	contain: "layout paint",
	pointerEvents: "none",
	translate: "0 0.5px",
} as const;

/** Upstream's `duration-fast` is the local `duration-[60ms]` (ui/collapsible-classes.ts). */
const CARET_MOTION = "transition-transform duration-[60ms] motion-reduce:transition-none";

/**
 * Upstream's shared-frame `rS` caret beside text: `CaretDownSmall` pointing down while open (`data-open`), turned
 * -90deg (mirrored in RTL) while closed.
 */
export function DisclosureCaret({open, customSize}: {open: boolean; customSize: number})
{
	return (
		<Icon
			name="CaretDownSmall"
			customSize={customSize}
			data-open={open ? "" : undefined}
			style={CARET_STYLE}
			className={open ? CARET_MOTION : `${CARET_MOTION} -rotate-90 page-rtl:rotate-90`}
		/>
	);
}
