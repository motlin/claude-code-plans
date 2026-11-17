import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useCallback, useEffect, useState} from "react";
import {autoModeSetupQueryOptions} from "../lib/api/auto-mode-setup";
import {homeDismissalsQueryOptions, postHomeDismissal} from "../lib/api/home-dismissals";
import {type AutoSetupBandInput, autoSetupBandEligible} from "../lib/auto-mode-setup-band";
import {readTryAutoCoachSeenAt} from "../lib/try-auto-coach";
import {cdsButtonClass} from "./ui/cds-button";
import {Icon} from "./ui/icon";
import {BandShell} from "./usage-pace-banner";

const SETUP_COMMAND = "/auto-mode-setup";

/**
 * Upstream's auto-mode setup band (`hye`) in a local session's composer. It is one-shot: the first paint marks it seen
 * (upstream burns `epitaxy-auto-setup-band-seen` then), and it stays up for this mount until Start or Dismiss.
 * Upstream's Start opens the desktop's own setup dialogs; locally the CLI owns that wizard, so Start types
 * `/auto-mode-setup` into the session's pane and the wizard runs there.
 */
export function AutoModeSetupBand({
	input,
	sendLive,
	markSeen,
}: {
	/** Null until the setup state, consent and seen store have loaded. */
	input: AutoSetupBandInput | null;
	sendLive: (prompt: string) => void;
	markSeen: () => void;
})
{
	const [phase, setPhase] = useState<"waiting" | "shown" | "closed">("waiting");
	const eligible = input !== null && autoSetupBandEligible(input);
	useEffect(() =>
	{
		if (phase !== "waiting" || !eligible) return;
		setPhase("shown");
		markSeen();
	}, [phase, eligible, markSeen]);
	if (phase === "closed" || (phase === "waiting" && !eligible)) return null;
	return (
		<BandShell
			icon={<Icon name="Trust" size="sm" className="text-muted-as-secondary" />}
			actions={
				<span className="flex h-[1lh] shrink-0 items-center">
					<button
						type="button"
						aria-label="Start"
						className={`${cdsButtonClass("secondary")} shrink-0`}
						onClick={() =>
						{
							setPhase("closed");
							sendLive(SETUP_COMMAND);
						}}
					>
						Start
					</button>
				</span>
			}
			onDismiss={() =>
			{
				setPhase("closed");
			}}
		>
			<span className="min-w-0 text-primary">
				Auto mode works better when it knows your environment. Takes about a minute.
			</span>
		</BandShell>
	);
}

/** The band's one-shot seen mark, kept in the server's home dismissals store so every browser sees it. */
const AUTO_SETUP_BAND_SEEN_KEY = "auto-setup-band:";

/**
 * The band for a live session: the CLI's setup state for its folder (with the Auto default mapping), the server seen mark
 * and this browser's try-auto coach mark time.
 */
export function SessionAutoModeSetupBand({
	cwd,
	paneWritable,
	effectiveMode,
	sendLive,
}: {
	cwd: string;
	paneWritable: boolean;
	effectiveMode: string | undefined;
	sendLive: (prompt: string) => void;
})
{
	const queryClient = useQueryClient();
	const {data: setup} = useQuery(autoModeSetupQueryOptions(cwd));
	const {data: dismissals} = useQuery(homeDismissalsQueryOptions);
	const markSeen = useCallback(() =>
	{
		void postHomeDismissal(AUTO_SETUP_BAND_SEEN_KEY)
			.then((data) => queryClient.setQueryData(homeDismissalsQueryOptions.queryKey, data))
			.catch(() => undefined);
	}, [queryClient]);
	const input: AutoSetupBandInput | null =
		setup === undefined || dismissals === undefined
			? null
			:
				{
					setup,
					autoModeIsDefault: setup.autoModeIsDefault,
					paneWritable,
					effectiveMode,
					sessionHistoryCount: setup.sessionHistoryCount,
					bandSeen: AUTO_SETUP_BAND_SEEN_KEY in dismissals.dismissals,
					coachSeenAt: readTryAutoCoachSeenAt(),
					now: Date.now(),
				};
	return <AutoModeSetupBand input={input} sendLive={sendLive} markSeen={markSeen} />;
}
