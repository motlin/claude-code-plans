/*
 * Upstream's cds `Switch` as it renders inside a compact menu row: never a tab
 * stop (the menu item is the focus target). `xs` is a 25.2x14 track with a 10px
 * knob that springs 11.2px on (mirrored under RTL); `sm` (--cds-switch-h 1.125rem)
 * is a 32.4x18 track with a 14px knob and 14.4px travel; `base` is cds step 2, a
 * 28.8x16 track with a 12px knob and 12.8px travel, and step 4 (36x20, 16px knob,
 * 16px travel) in a comfortable scope.
 */

/* Literals, so Tailwind's scanner emits every size. */
const SIZE_CLASS =
{
	xs:
	{
		track: "h-[14px] w-[25.2px]",
		knob: "size-[10px]",
		travel: "data-[checked]:translate-x-[11.2px] rtl:data-[checked]:-translate-x-[11.2px]",
	},
	sm:
	{
		track: "h-[18px] w-[32.4px]",
		knob: "size-[14px]",
		travel: "data-[checked]:translate-x-[14.4px] rtl:data-[checked]:-translate-x-[14.4px]",
	},
	base:
	{
		track: "h-[16px] w-[28.8px] comfortable:h-[20px] comfortable:w-[36px]",
		knob: "size-[12px] comfortable:size-[16px]",
		travel: "data-[checked]:translate-x-[12.8px] rtl:data-[checked]:-translate-x-[12.8px] comfortable:data-[checked]:translate-x-[16px] comfortable:rtl:data-[checked]:-translate-x-[16px]",
	},
} as const;

const trackClass = (track: string) =>
	`relative inline-flex ${track} shrink-0 rounded-full p-[2px] bg-[var(--menu-switch-track)] hover:bg-[var(--menu-switch-track-hover)] data-[checked]:bg-accent-100 data-[disabled]:opacity-40 forced-colors:border forced-colors:border-solid forced-colors:border-[CanvasText] forced-colors:p-px forced-colors:data-[checked]:border-[Highlight] forced-colors:data-[checked]:!bg-[Highlight]`;

/* Upstream knob: shadow-sm, duration-snap (.12s) and --cds-ease-overshoot. */
const knobClass = (knob: string, travel: string) =>
	`block ${knob} rounded-full bg-white shadow-[0_1px_2px_0_rgb(11_11_11/0.06),0_2px_8px_0_rgb(0_0_0/0.24)] transition-transform duration-[120ms] ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none forced-colors:bg-[CanvasText] forced-colors:data-[checked]:bg-[HighlightText] ${travel}`;

export interface MenuSwitchProps
{
	checked: boolean;
	disabled?: boolean | undefined;
	/** Display-only switches (the row does something else on click). */
	readOnly?: boolean | undefined;
	/**
	 * Upstream's cds size: `xs` in the folder menu, `sm` (32.4x18) on the Model menu's Ultracode and Fast rows,
	 * `base` on a connector row with a description.
	 */
	size?: "xs" | "sm" | "base" | undefined;
	/** Omitted only for a decorative switch inside an `aria-hidden` wrapper. */
	"aria-label"?: string | undefined;
}

export function MenuSwitch({
	checked,
	disabled = false,
	readOnly = false,
	size = "xs",
	"aria-label": ariaLabel,
}: MenuSwitchProps)
{
	const state = checked
		?
			{
				"data-checked": "",
			}
		:
			{
				"data-unchecked": "",
			};
	return (
		<span
			role="switch"
			tabIndex={-1}
			aria-checked={checked}
			{...(ariaLabel === undefined
				? {}
				:
					{
						"aria-label": ariaLabel,
					})}
			{...(disabled
				?
					{
						"aria-disabled": true,
						"data-disabled": "",
					}
				: {})}
			{...(readOnly
				?
					{
						"aria-readonly": true,
					}
				: {})}
			data-size={size}
			{...state}
			className={trackClass(SIZE_CLASS[size].track)}
		>
			<span aria-hidden="true" {...state} className={knobClass(SIZE_CLASS[size].knob, SIZE_CLASS[size].travel)} />
		</span>
	);
}
