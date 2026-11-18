import {type MouseEvent, useContext, useId} from "react";

import {Switch} from "../ui/switch";
import {Tooltip} from "../ui/tooltip";
import {EnvironmentBarIconOnlyContext} from "../use-environment-bar-icon-only";

const WORKTREE_DESCRIPTION = "Work in an isolated copy of the repository";

/** Upstream `hit-row flex h-control items-center gap-xs px-md text-body font-normal font-control` (local `font-control-regular`). */
const CHIP_CLASS = "hit-row flex h-control items-center gap-xs px-md text-body font-control-regular";

interface WorktreeToggleChipProps
{
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
export function WorktreeToggleChip(props: WorktreeToggleChipProps)
{
	return (
		<EnvironmentToggleChip
			{...props}
			label="Worktree"
			description={WORKTREE_DESCRIPTION}
			testId="environment-bar-worktree-toggle"
		/>
	);
}

const HEADLESS_DESCRIPTION = "Run without a terminal: the app owns the CLI and drives it over stream-json";

/** The home draft's Headless chip, Worktree's twin: on, the send starts an app-owned headless session. */
export function HeadlessToggleChip(props: WorktreeToggleChipProps)
{
	return (
		<EnvironmentToggleChip
			{...props}
			label="Headless"
			description={HEADLESS_DESCRIPTION}
			testId="environment-bar-headless-toggle"
		/>
	);
}

function EnvironmentToggleChip({
	on,
	pending,
	onChange,
	onPressed,
	label,
	description,
	testId,
}: WorktreeToggleChipProps &
{
	label: string;
	description: string;
	testId: string;
})
{
	const iconOnly = useContext(EnvironmentBarIconOnlyContext);
	const labelId = useId();
	const descriptionId = useId();
	const handleClick = (event: MouseEvent) =>
	{
		if (pending || event.detail === 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		onPressed();
	};
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream's presentation row: the switch inside it is the keyboard control, the row only refocuses after a pointer toggle
		<span role="presentation" onClick={handleClick} className={CHIP_CLASS}>
			{/* Collapsed, the label is screen-reader text, so the tip names the chip and adds the description. */}
			<Tooltip content={iconOnly ? label : description} detail={iconOnly ? description : undefined}>
				<Switch
					size="xxs"
					className="hit-row-main"
					data-testid={testId}
					aria-labelledby={labelId}
					aria-describedby={descriptionId}
					checked={on}
					busy={pending}
					onCheckedChange={onChange}
				/>
			</Tooltip>
			<span id={labelId} className={iconOnly ? "sr-only" : "pointer-events-none text-muted-as-secondary"}>
				{label}
			</span>
			<span id={descriptionId} hidden>
				{description}
			</span>
		</span>
	);
}
