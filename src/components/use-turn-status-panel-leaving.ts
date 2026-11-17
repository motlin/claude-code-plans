import {useEffect, useState} from "react";
import {isMotionReduced} from "../lib/reduced-motion";

/** Upstream's leave: `onLeft` fires when the mark slot's 400ms collapse ends. */
const LEAVE_MS = 400;

/**
 * Upstream `gR`'s `ue`: true from the render where a marked row stops being marked and active until its mark has left.
 * For rows whose mark slot reports `onLeft` itself, pass that state instead; this one times the 400ms leave, and
 * ends it at once under reduced motion. A row that stays active while losing its mark is not leaving: it snaps.
 */
export function useTurnStatusPanelLeaving(marked: boolean, active: boolean): boolean
{
	const [wasMarked, setWasMarked] = useState(marked);
	const [leaving, setLeaving] = useState(false);
	if (marked !== wasMarked)
	{
		setWasMarked(marked);
		setLeaving(!marked && !active);
	}
	else if (leaving && (marked || active))
	{
		setLeaving(false);
	}
	useEffect(() =>
	{
		if (!leaving) return undefined;
		if (isMotionReduced())
		{
			setLeaving(false);
			return undefined;
		}
		const timer = setTimeout(() =>
		{
			setLeaving(false);
		}, LEAVE_MS);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [leaving]);
	return leaving;
}
