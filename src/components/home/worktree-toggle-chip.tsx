import {type MouseEvent, useId} from "react";

import {Switch} from "../ui/switch";
import {Tooltip} from "../ui/tooltip";

const WORKTREE_DESCRIPTION = "Work in an isolated copy of the repository";

/** Upstream `hit-row flex h-control items-center gap-xs px-md text-body font-normal font-control` (local `font-control-regular`). */
const CHIP_CLASS = "hit-row flex h-control items-center gap-xs px-md text-body font-control-regular";

interface WorktreeToggleChipProps {
	on: boolean;
	/** The folder or its setup is still resolving: the switch is busy and ignores toggles. */
	pending: boolean;
	onChange: (on: boolean) => void;
	/** A pointer toggle hands focus back (upstream `onPressed`, the composer focus). */
	onPressed: () => void;
}

/**
 * Upstream's environment-bar Worktree chip (`Nye`): an xxs switch labelled "Worktree" with its description as a
 * hidden detail and hover tooltip. A pointer click toggles and then refocuses the composer; a keyboard (virtual)
 * click toggles and keeps focus on the switch.
 */
export function WorktreeToggleChip({on, pending, onChange, onPressed}: WorktreeToggleChipProps) {
	const labelId = useId();
	const descriptionId = useId();
	const handleClick = (event: MouseEvent) => {
		if (pending || event.detail === 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		onPressed();
	};
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream's presentation row: the switch inside it is the keyboard control, the row only refocuses after a pointer toggle
		<span role="presentation" onClick={handleClick} className={CHIP_CLASS}>
			<Tooltip content={WORKTREE_DESCRIPTION}>
				<Switch
					size="xxs"
					className="hit-row-main"
					data-testid="environment-bar-worktree-toggle"
					aria-labelledby={labelId}
					aria-describedby={descriptionId}
					checked={on}
					busy={pending}
					onCheckedChange={onChange}
				/>
			</Tooltip>
			<span id={labelId} className="pointer-events-none text-muted-as-secondary">
				Worktree
			</span>
			<span id={descriptionId} hidden>
				{WORKTREE_DESCRIPTION}
			</span>
		</span>
	);
}
