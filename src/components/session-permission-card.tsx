import type {ComponentProps} from "react";

import {PermissionCard} from "./permission-card";
import {type AllowAndSwitchToAutoInput, useAllowAndSwitchToAuto} from "./use-allow-and-switch-to-auto";

export interface SessionAutoSwitch extends AllowAndSwitchToAutoInput
{
	offered: boolean;
	/** The page's answer wrapper, so a stale prompt drops the card as the other answers do. */
	answerWith: (run: () => Promise<void>) => Promise<void>;
}

/**
 * The session's permission card with upstream's "Allow and switch to Auto" wired in: the Auto consent dialog lives
 * here, in the deferred prompt-cards chunk, and outlives the card, which hides at the click.
 */
export function SessionPermissionCard({
	autoSwitch,
	...card
}: Omit<ComponentProps<typeof PermissionCard>, "autoSwitch"> &
{
	autoSwitch: SessionAutoSwitch;
})
{
	const {offered, answerWith, ...input} = autoSwitch;
	const {onAllowAndSwitch, gate} = useAllowAndSwitchToAuto(input);
	return (
		<>
			<PermissionCard
				{...card}
				autoSwitch={
				{
					offered,
					onAllowAndSwitch: async () => answerWith(onAllowAndSwitch),
				}}
			/>
			{gate}
		</>
	);
}
