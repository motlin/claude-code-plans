import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {useCachedSessionSummary, useClaudeEvents, useIsSessionActive} from "../../hooks/use-claude-events";
import
{
	fetchEarlierTranscript,
	sessionDetailQueryOptions,
	transcriptQueryOptions,
	useHasEarlierTranscript,
	type TranscriptData,
} from "../../lib/api/sessions";
import {buildTerminalLines} from "../../lib/terminal-lines";
import {processTranscript} from "../../lib/transcript";
import {useWorkingMarkerState} from "../use-working-marker-state";
import {useExitTerminalView} from "../../hooks/use-exit-terminal-view";
import {TerminalHold} from "./terminal-hold";
import {type TerminalEarlierPages, TerminalTranscriptView} from "./terminal-transcript-view";

/**
 * Upstream `iPe`: the read-only host of the terminal view, which replaces the whole session column
 * (no titlebar, composer, panes or rail). It holds on upstream's hold screen until the transcript
 * loads, and leaves for the normal view (and its not-found UI) when the session is missing or
 * empty and idle.
 */
export function TerminalSession({sessionId}: {sessionId: string})
{
	const detail = useQuery(sessionDetailQueryOptions(sessionId));
	const transcript = useQuery(transcriptQueryOptions(sessionId));
	const isActive = useIsSessionActive(sessionId);
	const exit = useExitTerminalView();
	const missing =
		detail.data === null ||
		detail.isError ||
		transcript.isError ||
		(transcript.data?.records.length === 0 && !isActive);
	useEffect(() =>
	{
		if (missing) exit();
	}, [missing, exit]);
	if (missing || transcript.data === undefined) return <TerminalHold />;
	return (
		<TerminalSessionView key={sessionId} sessionId={sessionId} transcript={transcript.data} isActive={isActive} />
	);
}

function TerminalSessionView({
	sessionId,
	transcript,
	isActive,
}: {
	sessionId: string;
	transcript: TranscriptData;
	isActive: boolean;
})
{
	const hidden = useMemo(() => new Set(transcript.hiddenUuids), [transcript.hiddenUuids]);
	const processed = useMemo(
		() =>
			processTranscript(
				transcript.records,
				transcript.startIndex,
				{
					hidden,
					cuts: transcript.cuts,
				},
			),
		[transcript.records, transcript.startIndex, hidden, transcript.cuts],
	);
	const lines = useMemo(
		() => buildTerminalLines(processed.lines, processed.toolResultMap),
		[processed.lines, processed.toolResultMap],
	);
	const summary = useCachedSessionSummary(sessionId);
	const {pendingTools} = useClaudeEvents();
	const awaitingPermission = summary?.awaitingPermission === true;
	const marker = useWorkingMarkerState(
		{
			records: transcript.records,
			sessionState: summary?.state ?? null,
			isActive,
			pendingToolName: pendingTools.get(sessionId)?.toolName,
			awaitingPermission,
		},
	);
	const isWorking = marker.status === "working" || marker.status === "retrying" || marker.status === "stopping";
	const turnStartedAt =
		marker.status === "working" || marker.status === "retrying" ? marker.turnStartedAt : undefined;
	const earlier = useEarlierPages(sessionId, transcript);
	return (
		<TerminalTranscriptView
			lines={lines}
			isWorking={isWorking}
			turnStartedAt={turnStartedAt}
			pendingApproval={awaitingPermission}
			earlier={earlier}
		/>
	);
}

/** The transcript's earlier pages, paged in by the view's Load earlier row and its near-top scroll. */
function useEarlierPages(sessionId: string, transcript: TranscriptData): TerminalEarlierPages
{
	const queryClient = useQueryClient();
	const hasEarlier = useHasEarlierTranscript(sessionId, transcript);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState(false);
	const inFlight = useRef(false);
	const loadEarlier = useCallback(() =>
	{
		if (inFlight.current) return;
		inFlight.current = true;
		setIsLoading(true);
		fetchEarlierTranscript(queryClient, sessionId)
			.then(() =>
			{
				setError(false);
			})
			.catch(() =>
			{
				setError(true);
			})
			.finally(() =>
			{
				inFlight.current = false;
				setIsLoading(false);
			});
	}, [queryClient, sessionId]);
	return {
		hasEarlier,
		isLoading,
		error,
		loadEarlier,
	};
}
