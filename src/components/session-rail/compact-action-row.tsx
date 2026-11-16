import {useId} from "react";

import {COMPACT_DISABLED_REASON, type CompactActionState} from "../../lib/compact-action";
import {cdsButtonClass} from "../ui/cds-button";
import {DisabledReason} from "../ui/disabled-reason";

const COMPACT_BUTTON_CLASS = `${cdsButtonClass("secondary", "xs")} min-w-0`;

/** Upstream's compact action `H`: the auto-compact hint and an xs "Compact session" button behind its disabled reason. */
export function CompactActionRow({
	inset,
	state,
	hint,
	onCompact,
}: {
	/** The row's inline inset: the rail card's `px-xs`, or the ring popover's `px-lg` (upstream `H`'s `I`). */
	inset: "px-xs" | "px-lg";
	state: Exclude<
		CompactActionState,
		{
			kind: "hidden";
		}
	>;
	hint: string | null;
	onCompact: () => void;
})
{
	const hintId = useId();
	return (
		<div
			data-rail-compact-action=""
			className={`flex min-h-[20px] items-center gap-sm ${inset} py-xs text-footnote`}
		>
			{hint !== null && (
				<span id={hintId} className="min-w-0 flex-1 truncate text-secondary">
					{hint}
				</span>
			)}
			<DisabledReason
				reason={state.kind === "disabled" ? COMPACT_DISABLED_REASON[state.reason] : null}
				// Without the flex-1 hint, the button still sits at the trailing edge.
				wrapperClassName={hint === null ? "min-w-0 shrink-0 ms-auto" : "min-w-0 shrink-0"}
			>
				<button
					type="button"
					data-cds="Button"
					data-size="xs"
					disabled={state.kind === "disabled"}
					aria-describedby={hint === null ? undefined : hintId}
					onClick={() =>
					{
						onCompact();
					}}
					className={COMPACT_BUTTON_CLASS}
				>
					<span className="truncate">Compact session</span>
				</button>
			</DisabledReason>
		</div>
	);
}
