import {useEffect, useState} from "react";
import {readTryAutoCoachSeenAt, writeTryAutoCoachSeenAt} from "../lib/try-auto-coach";
import {CoachMark} from "./coach-mark";

/** Upstream's `introDelay: 0.5`. */
const INTRO_DELAY_MS = 500;

/**
 * Upstream's "Try auto mode" coach mark (`Vx`/`Ux`) on the Mode picker: once ever, 500 ms after it becomes eligible,
 * stamping its seen time as it opens. It closes on Close ×, Escape, an outside click, or as soon as the pick leaves
 * Manual (upstream's `entered_auto`).
 */
export function TryAutoCoachMark({eligible, anchor}: {eligible: boolean; anchor: Element | null})
{
	const [phase, setPhase] = useState<"waiting" | "open" | "done">("waiting");
	useEffect(() =>
	{
		if (phase === "open" && !eligible) setPhase("done");
		if (phase !== "waiting" || !eligible || anchor === null) return undefined;
		const timer = setTimeout(() =>
		{
			if (readTryAutoCoachSeenAt() !== 0)
			{
				setPhase("done");
				return;
			}
			writeTryAutoCoachSeenAt(Date.now());
			setPhase("open");
		}, INTRO_DELAY_MS);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [phase, eligible, anchor]);
	const close = () =>
	{
		setPhase("done");
	};
	if (phase !== "open") return null;
	return (
		<CoachMark
			open={eligible}
			anchor={anchor}
			side="top"
			className="max-w-xs"
			icon={null}
			title="Try auto mode"
			message="Claude checks each tool call and runs ones that pass its safety checks. Choose Auto from this menu anytime."
			onDismiss={close}
			onClose={close}
		/>
	);
}
