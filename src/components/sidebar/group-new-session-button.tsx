import {Plus} from "lucide-react";
import type {MouseEvent} from "react";
import {Tooltip} from "../ui/tooltip";

/** Where a group's new session was started from, as upstream's `group_new_session_clicked` source. */
export type GroupNewSessionSource = "plus_button" | "header_menu";

/**
 * Upstream's per-section "+" (`me`): `target` undefined is a project section (labelled by the group, no tooltip);
 * a string or null is a custom section's prefill folder, named in the label and a tooltip with an "Added to" detail.
 */
export function GroupNewSessionButton({
	groupLabel,
	target,
	onNewSession,
}: {
	groupLabel: string;
	target?: string | null;
	onNewSession: (source: GroupNewSessionSource) => void;
}) {
	const place = target === null ? "New session with no folder picked" : `New session in ${target ?? groupLabel}`;
	const label = target === undefined ? place : `${place}, added to ${groupLabel}`;

	function onClick(event: MouseEvent<HTMLButtonElement>) {
		// Never toggles the section the header belongs to.
		event.stopPropagation();
		event.preventDefault();
		onNewSession("plus_button");
	}

	const button = (
		<button
			type="button"
			aria-label={label}
			data-row-action=""
			// The list keeps one roving tab stop; ArrowRight from the group toggle reaches the header controls.
			tabIndex={-1}
			onClick={onClick}
			className="relative flex size-6 shrink-0 items-center justify-center rounded-r5 text-[color:var(--sb-heading-ink,var(--color-secondary))] hover:text-primary hover:bg-[var(--sb-hover)] hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
		>
			<Plus aria-hidden="true" className="size-4" />
		</button>
	);

	if (target === undefined) return <span className="-my-1 flex shrink-0">{button}</span>;
	return (
		<Tooltip content={place} detail={`Added to ${groupLabel}`} stacked side="right" className="-my-1 shrink-0">
			{button}
		</Tooltip>
	);
}
