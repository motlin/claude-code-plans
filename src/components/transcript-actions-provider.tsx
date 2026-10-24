import {type ReactNode, useEffect, useMemo, useRef} from "react";

import {toggleChapter} from "../lib/chapter-store";
import {FORK_NO_DIRECTORY_REASON} from "../lib/session-fork";
import type {SessionLine} from "../lib/transcript";
import {chapterFor, forkPointFor} from "../lib/transcript-action-targets";
import {
	type TranscriptActions,
	TranscriptActionsContext,
	type TranscriptMessageRef,
} from "./transcript-actions-context";
import {useToast} from "./toast-context";

export interface TranscriptActionsProviderProps {
	sessionId: string;
	/** The transcript lines on the page, which resolve a message's fork point and chapter label. */
	lines: readonly SessionLine[];
	/** Launch a fork resumed at a message; absent when the session has no directory to fork in. */
	fork: ((target: {sessionId: string; atMessage: string}) => void) | undefined;
	/** Upstream's `requestRewind` for one of this session's prompts: dry-run, confirm when needed, then rewind. */
	rewind: (uuid: string) => void;
	/** Claude is working in the pane, so Rewind is disabled with upstream's reason. */
	working?: boolean;
	/** The session is archived, so Rewind is left out entirely, as upstream does. */
	archived?: boolean;
	children: ReactNode;
}

/** Upstream's `_x` reason on a user row's Rewind while the session responds. */
const REWIND_WORKING_REASON = "Rewind is unavailable while Claude is working";

/**
 * The one implementation behind a turn's Fork from here, Pin as chapter and
 * Rewind to here, whether pressed on the hover toolbar or picked from the
 * right-click menu. Rewind hands the prompt to the session's rewind request
 * (the "Rewind to this message?" confirm and the live CLI's rewind).
 */
export function TranscriptActionsProvider({
	sessionId,
	lines,
	fork,
	rewind,
	working = false,
	archived = false,
	children,
}: TranscriptActionsProviderProps) {
	const toast = useToast();
	// Read through a ref so the context value, and every toolbar under it, stays put as lines grow.
	const latest = useRef({lines, rewind, fork});
	useEffect(() => {
		latest.current = {lines, rewind, fork};
	});
	const canFork = fork !== undefined;

	const actions = useMemo<TranscriptActions>(() => {
		const pinChapter = (message: TranscriptMessageRef) => {
			const chapter = chapterFor(latest.current.lines, message.uuid);
			if (chapter !== null) toggleChapter(message.sessionId, chapter);
		};
		const rewindTo = (message: TranscriptMessageRef) => {
			if (message.sessionId !== sessionId) {
				toast({kind: "error", message: "Can’t rewind to this message."});
				return;
			}
			latest.current.rewind(message.uuid);
		};
		const rewindActions = archived
			? {rewindHidden: true}
			: working
				? {rewindTo, rewindDisabledReason: REWIND_WORKING_REASON}
				: {rewindTo};
		if (!canFork) return {pinChapter, ...rewindActions, forkDisabledReason: FORK_NO_DIRECTORY_REASON};
		const forkFrom = (message: TranscriptMessageRef) => {
			if (message.sessionId !== sessionId) {
				toast({kind: "error", message: "Only this session's own messages can be forked."});
				return;
			}
			latest.current.fork?.({sessionId, atMessage: forkPointFor(latest.current.lines, message.uuid)});
		};
		return {pinChapter, ...rewindActions, forkFrom};
	}, [archived, canFork, sessionId, toast, working]);

	return <TranscriptActionsContext.Provider value={actions}>{children}</TranscriptActionsContext.Provider>;
}
