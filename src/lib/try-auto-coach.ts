import type {AutoModeSetupState} from "./api/auto-mode-setup";

/** When the mark was shown (ms). Upstream keeps it as the account pref `epitaxy-try-auto-coach-seen-at`. */
export const TRY_AUTO_COACH_KEY = "ccb.coachmark.tryAuto";

/** The mark's seen-at time, the setup band's try path; 0 when never shown or storage is unavailable. */
export function readTryAutoCoachSeenAt(): number
{
	try
	{
		const seenAt = Number(localStorage.getItem(TRY_AUTO_COACH_KEY) ?? 0);
		return Number.isFinite(seenAt) ? seenAt : 0;
	}
	catch
	{
		return 0;
	}
}

export function writeTryAutoCoachSeenAt(seenAt: number): void
{
	try
	{
		localStorage.setItem(TRY_AUTO_COACH_KEY, String(seenAt));
	}
	catch
	{
		// No storage: the mark may show again next time.
	}
}

export interface TryAutoCoachOffer
{
	autoModeIsDefault: boolean;
	setup: Pick<AutoModeSetupState, "offered" | "setupComplete">;
}

/**
 * Upstream's cohort `qn` (c4a83c53b), less what a local draft always meets: the user explicitly picked Manual, Auto
 * is the default on offer, and the CLI offers `/auto-mode-setup` that hasn't been run.
 */
export function tryAutoCoachEligible(pickedMode: string | undefined, offer: TryAutoCoachOffer | undefined): boolean
{
	return (
		pickedMode === "default" &&
		offer !== undefined &&
		offer.autoModeIsDefault &&
		offer.setup.offered &&
		!offer.setup.setupComplete
	);
}
