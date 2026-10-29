/*
 * Upstream's cds `Switch size=xs` as a standalone control (the rail's Remote
 * Control setting row): a 25.2x14 button track that a `<label htmlFor>` can
 * click, with a 10px knob that springs 11.2px on (mirrored under RTL).
 */

const TRACK_CLASS =
	"relative inline-flex h-[14px] w-[25.2px] shrink-0 cursor-pointer rounded-full border-0 p-[2px] bg-[var(--settings-switch-track)] hover:bg-[var(--settings-switch-track-hover)] data-[checked]:bg-accent-100 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

const KNOB_CLASS =
	"block size-[10px] rounded-full bg-white shadow-sm transition-transform duration-[120ms] ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none data-[checked]:translate-x-[11.2px] rtl:data-[checked]:-translate-x-[11.2px]";

export interface SwitchProps {
	id: string;
	checked: boolean;
	disabled?: boolean | undefined;
	/** Omitted, the switch only shows its state (`aria-readonly`). */
	onCheckedChange?: ((checked: boolean) => void) | undefined;
	"aria-label"?: string | undefined;
}

export function Switch({id, checked, disabled = false, onCheckedChange, "aria-label": ariaLabel}: SwitchProps) {
	const state = checked ? {"data-checked": ""} : {"data-unchecked": ""};
	return (
		<button
			id={id}
			type="button"
			role="switch"
			aria-checked={checked}
			{...(ariaLabel === undefined ? {} : {"aria-label": ariaLabel})}
			{...(onCheckedChange === undefined ? {"aria-readonly": true} : {})}
			{...(disabled ? {disabled: true, "data-disabled": ""} : {})}
			data-size="xs"
			{...state}
			onClick={() => {
				onCheckedChange?.(!checked);
			}}
			onKeyDown={(event) => {
				// Upstream swallows a held Enter so it can't flip the switch over and over.
				if (event.repeat && event.key === "Enter") event.preventDefault();
			}}
			className={TRACK_CLASS}
		>
			<span aria-hidden="true" {...state} className={KNOB_CLASS} />
		</button>
	);
}
