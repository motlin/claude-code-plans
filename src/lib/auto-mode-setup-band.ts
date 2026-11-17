import type {AutoModeSetupState} from "./api/auto-mode-setup";

/** Upstream's `tr`: the try path stays open a week after the coach mark, as a CLI "Not now" snoozes a week. */
const WEEK_MS = 604_800_000;

export interface AutoSetupBandInput
{
	setup: AutoModeSetupState;
	/** Upstream's `ccd_auto_default_mode`, mapped like the consent guard: `defaultMode` "auto" or the prompt skipped. */
	autoModeIsDefault: boolean;
	/** The session has a live herdr pane that this app may type into: upstream's local-session gate. */
	paneWritable: boolean;
	/** The live session's permission mode, as the chin shows it. */
	effectiveMode: string | undefined;
	sessionHistoryCount: number;
	/** The band has been painted once (one-shot). */
	bandSeen: boolean;
	/** When the try-auto coach mark was shown (ms), or 0. */
	coachSeenAt: number;
	now: number;
}

/**
 * Upstream `hr` (c5cd1b4dc): the setup band shows in auto mode once a user with some history has hit enough
 * classifier denials, or in Manual within a week of the try-auto coach mark. Upstream re-shows a seen band after a
 * dialog snooze ends; the local band has no snooze control (the CLI wizard owns it), so being seen retires it.
 */
export function autoSetupBandEligible({
	setup,
	autoModeIsDefault,
	paneWritable,
	effectiveMode,
	sessionHistoryCount,
	bandSeen,
	coachSeenAt,
	now,
}: AutoSetupBandInput): boolean
{
	const enabled = setup.offered && autoModeIsDefault && paneWritable;
	const retired = setup.setupComplete || setup.dismissed || now < setup.snoozedUntil;
	const autoPath = effectiveMode === "auto" && sessionHistoryCount >= 3 && setup.denials >= 5;
	const tryPath = effectiveMode === "default" && coachSeenAt !== 0 && now < coachSeenAt + WEEK_MS;
	return enabled && !retired && !bandSeen && (autoPath || tryPath);
}
