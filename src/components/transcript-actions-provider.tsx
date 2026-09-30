import {type ReactNode, useEffect, useMemo, useRef} from "react";

import {toggleChapter} from "../lib/chapter-store";
import type {SessionLine} from "../lib/transcript";
import {chapterFor, forkPointFor} from "../lib/transcript-action-targets";
import {type TranscriptActions, TranscriptActionsContext, type TranscriptMessageRef} from "./transcript-context-menu";
import {useToast} from "./toast";
import {TurnUndoConfirm, useTurnUndo} from "./turn-undo";

export interface TranscriptActionsProviderProps {
	sessionId: string;
	/** The transcript lines on the page, which resolve a message's fork point and chapter label. */
	lines: readonly SessionLine[];
	/** Launch a fork resumed at a message; absent when the session has no directory to fork in. */
	fork: ((target: {sessionId: string; atMessage: string}) => void) | undefined;
	children: ReactNode;
}

/**
 * The one implementation behind a turn's Fork from here, Pin as chapter and
 * Rewind to here, whether pressed on the hover toolbar or picked from the
 * right-click menu. Rewind is the turn Undo: it reverts the file edits of the
 * turn the prompt started, behind the same confirm and refusals.
 */
export function TranscriptActionsProvider({sessionId, lines, fork, children}: TranscriptActionsProviderProps) {
	const toast = useToast();
	const undo = useTurnUndo((outcome) =>
		toast(
			outcome.kind === "done"
				? {kind: "success", message: outcome.message}
				: {kind: "error", message: outcome.message},
		),
	);
	// Read through a ref so the context value, and every toolbar under it, stays put as lines grow.
	const latest = useRef({lines, start: undo.start, fork});
	useEffect(() => {
		latest.current = {lines, start: undo.start, fork};
	});
	const canFork = fork !== undefined;

	const actions = useMemo<TranscriptActions>(() => {
		const pinChapter = (message: TranscriptMessageRef) => {
			const chapter = chapterFor(latest.current.lines, message.uuid);
			if (chapter !== null) toggleChapter(message.sessionId, chapter);
		};
		const rewindTo = (message: TranscriptMessageRef) => void latest.current.start(message.sessionId, message.uuid);
		if (!canFork) return {pinChapter, rewindTo};
		const forkFrom = (message: TranscriptMessageRef) => {
			if (message.sessionId !== sessionId) {
				toast({kind: "error", message: "Only this session's own messages can be forked."});
				return;
			}
			latest.current.fork?.({sessionId, atMessage: forkPointFor(latest.current.lines, message.uuid)});
		};
		return {pinChapter, rewindTo, forkFrom};
	}, [canFork, sessionId, toast]);

	return (
		<TranscriptActionsContext.Provider value={actions}>
			{children}
			<TurnUndoConfirm undo={undo} />
		</TranscriptActionsContext.Provider>
	);
}
