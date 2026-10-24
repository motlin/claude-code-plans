/*
 * Upstream's cds `Switch size=xs` as it renders inside a compact menu row: a
 * 25.2x14 track that is never a tab stop (the menu item is the focus target),
 * with a 10px knob that springs 11.2px on (mirrored under RTL).
 */

const TRACK_CLASS =
	"relative inline-flex h-[14px] w-[25.2px] shrink-0 rounded-full p-[2px] bg-[var(--menu-switch-track)] hover:bg-[var(--menu-switch-track-hover)] data-[checked]:bg-accent-100 data-[disabled]:opacity-40 forced-colors:border forced-colors:border-solid forced-colors:border-[CanvasText] forced-colors:p-px forced-colors:data-[checked]:border-[Highlight] forced-colors:data-[checked]:!bg-[Highlight]";

/* Upstream knob: shadow-sm, duration-snap (.12s) and --cds-ease-overshoot. */
const KNOB_CLASS =
	"block size-[10px] rounded-full bg-white shadow-[0_1px_2px_0_rgb(11_11_11/0.06),0_2px_8px_0_rgb(0_0_0/0.24)] transition-transform duration-[120ms] ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none forced-colors:bg-[CanvasText] forced-colors:data-[checked]:bg-[HighlightText] data-[checked]:translate-x-[11.2px] rtl:data-[checked]:-translate-x-[11.2px]";

export interface MenuSwitchProps {
	checked: boolean;
	disabled?: boolean | undefined;
	/** Display-only switches (the row does something else on click). */
	readOnly?: boolean | undefined;
	/** Upstream's cds size: `xs` in the folder menu, `sm` on the Model menu's Fast row; both draw 25.2x14 here. */
	size?: "xs" | "sm" | undefined;
	/** Omitted only for a decorative switch inside an `aria-hidden` wrapper. */
	"aria-label"?: string | undefined;
}

export function MenuSwitch({
	checked,
	disabled = false,
	readOnly = false,
	size = "xs",
	"aria-label": ariaLabel,
}: MenuSwitchProps) {
	const state = checked ? {"data-checked": ""} : {"data-unchecked": ""};
	return (
		<span
			role="switch"
			tabIndex={-1}
			aria-checked={checked}
			{...(ariaLabel === undefined ? {} : {"aria-label": ariaLabel})}
			{...(disabled ? {"aria-disabled": true, "data-disabled": ""} : {})}
			{...(readOnly ? {"aria-readonly": true} : {})}
			data-size={size}
			{...state}
			className={TRACK_CLASS}
		>
			<span aria-hidden="true" {...state} className={KNOB_CLASS} />
		</span>
	);
}
