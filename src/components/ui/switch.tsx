import type {ComponentProps} from "react";

import {DisabledReason} from "./disabled-reason";
import type {Tooltip} from "./tooltip";

/*
 * Upstream's cds `Switch size=xs` as a standalone control (the rail's Remote
 * Control setting row): a 25.2x14 button track that a `<label htmlFor>` can
 * click, with a 10px knob that springs 11.2px on (mirrored under RTL).
 * `size=xxs` maps to no size token upstream, so it follows the scope's
 * `--cds-switch-h` (16px, 20px at comfortable): the environment bar's Worktree chip.
 */

const TRACK_TAIL =
	"shrink-0 cursor-pointer rounded-full border-0 p-[2px] bg-[var(--settings-switch-track)] hover:bg-[var(--settings-switch-track-hover)] data-[checked]:bg-accent-100 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

const KNOB_TAIL =
	"rounded-full bg-white shadow-sm transition-transform duration-[120ms] ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none";

const TRACK_CLASS =
{
	xs: `relative inline-flex h-[14px] w-[25.2px] ${TRACK_TAIL}`,
	xxs: `relative inline-flex h-[var(--cds-switch-h)] w-[calc(var(--cds-switch-h)*1.8)] ${TRACK_TAIL}`,
} as const;

const KNOB_CLASS =
{
	xs: `block size-[10px] ${KNOB_TAIL} data-[checked]:translate-x-[11.2px] rtl:data-[checked]:-translate-x-[11.2px]`,
	xxs: `block size-[calc(var(--cds-switch-h)-4px)] ${KNOB_TAIL} data-[checked]:translate-x-[calc(var(--cds-switch-h)*0.8)] rtl:data-[checked]:-translate-x-[calc(var(--cds-switch-h)*0.8)]`,
} as const;

export interface SwitchProps
{
	id?: string | undefined;
	checked: boolean;
	/** `xs` is a fixed 14px track; `xxs` follows the scope's `--cds-switch-h`. */
	size?: "xs" | "xxs";
	/** Appended to the track's classes (the Worktree chip's `hit-row-main`). */
	className?: string | undefined;
	"aria-labelledby"?: string | undefined;
	"aria-describedby"?: string | undefined;
	"data-testid"?: string | undefined;
	/** Upstream's pending switch: `aria-busy` and `aria-disabled`, still focusable, its toggles ignored. */
	busy?: boolean | undefined;
	disabled?: boolean | undefined;
	/** Omitted, the switch only shows its state (`aria-readonly`). */
	onCheckedChange?: ((checked: boolean) => void) | undefined;
	"aria-label"?: string | undefined;
	/**
	 * Upstream `NB`: any value but `undefined` mounts a stable disabled-reason wrapper, which carries the reason only
	 * while the switch is disabled.
	 */
	disabledReason?: string | null | undefined;
	/** The reason tooltip's side (upstream `disabledReasonSide`). */
	disabledReasonSide?: ComponentProps<typeof Tooltip>["side"];
}

export function Switch({
	id,
	checked,
	size = "xs",
	className,
	"aria-labelledby": labelledBy,
	"aria-describedby": describedBy,
	"data-testid": testId,
	busy = false,
	disabled = false,
	onCheckedChange,
	"aria-label": ariaLabel,
	disabledReason,
	disabledReasonSide,
}: SwitchProps)
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
	const track = (
		<button
			{...(id === undefined
				? {}
				:
					{
						id,
					})}
			type="button"
			role="switch"
			aria-checked={checked}
			{...(ariaLabel === undefined
				? {}
				:
					{
						"aria-label": ariaLabel,
					})}
			{...(labelledBy === undefined
				? {}
				:
					{
						"aria-labelledby": labelledBy,
					})}
			{...(describedBy === undefined
				? {}
				:
					{
						"aria-describedby": describedBy,
					})}
			{...(busy
				?
					{
						"aria-busy": true,
						"aria-disabled": true,
					}
				: {})}
			{...(onCheckedChange === undefined
				?
					{
						"aria-readonly": true,
					}
				: {})}
			{...(disabled
				?
					{
						disabled: true,
						"data-disabled": "",
					}
				: {})}
			{...(testId === undefined
				? {}
				:
					{
						"data-testid": testId,
					})}
			data-size={size}
			{...state}
			onClick={() =>
			{
				if (!busy) onCheckedChange?.(!checked);
			}}
			onKeyDown={(event) =>
			{
				// Upstream swallows a held Enter so it can't flip the switch over and over.
				if (event.repeat && event.key === "Enter") event.preventDefault();
			}}
			className={className === undefined ? TRACK_CLASS[size] : `${TRACK_CLASS[size]} ${className}`}
		>
			<span aria-hidden="true" {...state} className={KNOB_CLASS[size]} />
		</button>
	);
	if (disabledReason === undefined) return track;
	return (
		<DisabledReason
			reason={disabled ? disabledReason : null}
			{...(disabledReasonSide === undefined
				? {}
				:
					{
						side: disabledReasonSide,
					})}
		>
			{track}
		</DisabledReason>
	);
}
