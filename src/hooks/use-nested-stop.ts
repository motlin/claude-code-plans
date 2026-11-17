import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import type {NestedStopFace} from "../components/composer";
import type {ToastOptions} from "../components/toast-context";
import {stopHerdrBackgroundAgents} from "../lib/api/herdr";
import {nestedStopLabels} from "../lib/nested-stop";

/** How long a sent stop waits for the transcript to show the agents gone before reporting the ones left. */
export const NESTED_STOP_CONFIRM_MS = 5000;

export interface NestedStopOptions
{
	sessionId: string;
	/** Running background agents and workflows (`nestedStopCount`). */
	count: number;
	/** A live pane that accepts writes. */
	enabled: boolean;
	/** The newest `agents_killed` record's id in the transcript, so a new one confirms the stop. */
	killedMarker: string | null;
	toast: (options: ToastOptions) => void;
	stop?: (sessionId: string) => Promise<void>;
}

interface Press
{
	sessionId: string;
	/** The count at press time, which the success toast reports (as upstream's does). */
	count: number;
	marker: string | null;
	phase: "sending" | "confirming";
}

/**
 * Upstream's `Jbe` for the composer's nested-session Stop, over the CLI's background agents. The press sends
 * the kill-agents chord, then waits for the CLI's `agents_killed` record (or the running count reaching 0)
 * before the info toast. A failed request, or agents still running after {@link NESTED_STOP_CONFIRM_MS},
 * gets upstream's error toasts instead.
 */
export function useNestedStop({
	sessionId,
	count,
	enabled,
	killedMarker,
	toast,
	stop = stopHerdrBackgroundAgents,
}: NestedStopOptions): NestedStopFace | undefined
{
	const [press, setPress] = useState<Press | null>(null);
	if (press !== null && press.sessionId !== sessionId) setPress(null);
	const countRef = useRef(count);
	useEffect(() =>
	{
		countRef.current = count;
	}, [count]);

	const onStop = useCallback(() =>
	{
		const sent: Press =
		{
			sessionId,
			count,
			marker: killedMarker,
			phase: "sending",
		};
		setPress(sent);
		stop(sessionId).then(
			() =>
			{
				setPress((current) =>
					current === sent
						?
							{
								...sent,
								phase: "confirming",
							}
						: current,
				);
			},
			(error: unknown) =>
			{
				setPress((current) => (current === sent ? null : current));
				toast(
					{
						kind: "error",
						message: nestedStopLabels(sent.count).failed,
						description: error instanceof Error ? error.message : String(error),
					},
				);
			},
		);
	}, [sessionId, count, killedMarker, stop, toast]);

	const confirming = press?.phase === "confirming" && press.sessionId === sessionId ? press : null;
	const confirmed = confirming !== null && (killedMarker !== confirming.marker || count === 0);
	useEffect(() =>
	{
		if (confirming === null || !confirmed) return;
		setPress(null);
		toast(
			{
				kind: "success",
				message: nestedStopLabels(confirming.count).stopped,
			},
		);
	}, [confirming, confirmed, toast]);
	useEffect(() =>
	{
		if (confirming === null) return undefined;
		const timer = window.setTimeout(() =>
		{
			setPress((current) => (current === confirming ? null : current));
			toast(
				{
					kind: "error",
					message: nestedStopLabels(countRef.current).notStopped,
				},
			);
		}, NESTED_STOP_CONFIRM_MS);
		return () =>
		{
			window.clearTimeout(timer);
		};
	}, [confirming, toast]);

	const stopping = press?.sessionId === sessionId;
	return useMemo(() =>
	{
		if (!enabled || count === 0) return undefined;
		const labels = nestedStopLabels(count);
		return {
			label: labels.label,
			stopping,
			stoppingLabel: labels.stoppingLabel,
			onStop,
		};
	}, [enabled, count, stopping, onStop]);
}
