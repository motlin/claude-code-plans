import {useEffect, useState} from "react";
import {formatPaceBannerReset} from "../lib/usage";

/** Upstream's `rn`: under an hour the countdown replaces the absolute reset time. */
const COUNTDOWN_MS = 3_600_000;
/** Upstream's `an`: under ten minutes the countdown shows seconds. */
const SECONDS_COUNTDOWN = 600;

const MINUTES = new Intl.NumberFormat("en-US", {style: "unit", unit: "minute", unitDisplay: "short"});

/** Upstream's countdown text (`cn`) for a reset `resetsAt` (epoch seconds) seen at `nowMs`. */
function resetCountdownText(resetsAt: number, nowMs: number): string {
	const remainingMs = resetsAt * 1000 - nowMs;
	if (remainingMs >= COUNTDOWN_MS) return formatPaceBannerReset(resetsAt, nowMs);
	const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
	if (seconds === 0) return "Resetting…";
	if (seconds < SECONDS_COUNTDOWN) {
		return `Resets in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
	}
	return `Resets in ${MINUTES.format(Math.floor(seconds / 60))}`;
}

/**
 * The exceeded band's reset: the absolute time an hour or more out, then "Resets in N min",
 * "Resets in m:ss" under ten minutes (ticking each second), and "Resetting…" at the reset.
 */
export function ResetCountdown({resetsAt}: {resetsAt: number}) {
	const [nowMs, setNowMs] = useState(() => Date.now());
	const counting = resetsAt * 1000 - nowMs < COUNTDOWN_MS;
	useEffect(() => {
		const id = setInterval(
			() => {
				setNowMs(Date.now());
			},
			counting ? 1000 : 60_000,
		);
		return () => {
			clearInterval(id);
		};
	}, [counting]);
	return (
		<span data-testid="reset-countdown" aria-live="off" className="tabular-nums">
			{resetCountdownText(resetsAt, nowMs)}
		</span>
	);
}
