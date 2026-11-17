import {useEffect, useRef} from "react";

import
{
	INITIAL_PLAN_AUTO_OPEN_TRACK,
	markPlanAutoOpened,
	planAutoOpened,
	planAutoOpenStep,
	type PlanAutoOpenSnapshot,
} from "../lib/plan-auto-open";
import {usePhoneSheet} from "../lib/use-phone-sheet";
import {useOptionalPaneHost} from "./panes/pane-host-context";

interface PlanAutoOpenProps
{
	sessionId: string;
	firstRecordUuid: string | undefined;
	/** Grows only when the session appends. */
	liveCount: number;
	hasTodos: boolean;
}

/**
 * Upstream's `ZQ`/`JQ`: opens the Plan pane unprompted (`ND`) the first time a session gains todos live, once per
 * session: an overlay when the chat is alone and there is room, else a split. A session whose Plan pane is already
 * open is marked without opening it.
 * Skipped where there are no side panes (no host, or a phone).
 */
export function PlanAutoOpen({sessionId, firstRecordUuid, liveCount, hasTodos}: PlanAutoOpenProps)
{
	const host = useOptionalPaneHost();
	const phone = usePhoneSheet();
	const planOpen = host?.isOpen("plan") === true;
	const track = useRef<
	{
		sessionId: string;
		snapshot: PlanAutoOpenSnapshot;
	}>(
		{
			sessionId,
			snapshot: INITIAL_PLAN_AUTO_OPEN_TRACK,
		},
	);

	useEffect(() =>
	{
		if (planOpen) markPlanAutoOpened(sessionId);
	}, [planOpen, sessionId]);

	useEffect(() =>
	{
		if (track.current.sessionId !== sessionId)
		{
			track.current =
			{
				sessionId,
				snapshot: INITIAL_PLAN_AUTO_OPEN_TRACK,
			};
		}
		if (host === null || phone || planAutoOpened(sessionId)) return;
		// The transcript arrives already loaded, so every observation is seeded.
		const step = planAutoOpenStep(
			track.current.snapshot,
			{
				firstRecordUuid,
				liveCount,
				hasTodos,
				seeded: true,
			},
		);
		track.current.snapshot = step.track;
		if (!step.open) return;
		if (!host.isOpen("plan"))
		{
			host.openPane(
				"plan",
				{
					unprompted: true,
				},
			);
		}
		markPlanAutoOpened(sessionId);
	}, [firstRecordUuid, liveCount, hasTodos, host, phone, sessionId]);

	return null;
}
