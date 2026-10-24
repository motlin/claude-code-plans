import {useCallback, useEffect, useRef, useState} from "react";

import {useToast} from "../components/toast-context";
import {fetchRewindFilesPreview, postRewindFiles, type RewindFileChanges} from "../lib/api/rewind-files";

/**
 * claude.ai/code's rewind request → confirm → run state machine (`zue`, see
 * .llm/upstream-sync/features/rewind-undo-redo.md): dry-run the code restore,
 * confirm only when there is code to restore or the dry run is slow, else
 * rewind the conversation at once.
 */

/** `"pending"` while the dry run is out; `"none"` when it found nothing after the dialog had already shown. */
export type RewindPreview = "pending" | "none" | RewindFileChanges;

/** What the confirm's Restore select picks. */
export type RewindChoice = "both" | "conversation" | "code";

export interface RewindConfirmRequest {
	token: number;
	uuid: string;
	text: string;
	preview: RewindPreview;
}

export interface RewindRequestDependencies {
	fetchPreview: typeof fetchRewindFilesPreview;
	restoreCode: typeof postRewindFiles;
}

const DEFAULT_DEPENDENCIES: RewindRequestDependencies = {
	fetchPreview: fetchRewindFilesPreview,
	restoreCode: postRewindFiles,
};

/** Upstream's `dP(…, 400)` and the "Rewinding…" toast delay. */
const REWIND_DIALOG_DELAY_MS = 400;

const OFFLINE = "Rewind is unavailable while the computer running this session is offline";
const STILL_RESTORING = "Still restoring the code from an earlier rewind…";
const RESTORE_SLOW = "Restoring the code is taking longer than expected. Your files may still change.";
const RESTORE_FAILED = "Couldn’t restore the code from this point. Try again.";

function skippedMessage(count: number): string {
	return `Restored the code, but skipped ${count} ${count === 1 ? "file" : "files"} that couldn’t be safely written. Skipped files were left untouched.`;
}

type Phase = "idle" | "awaiting" | "running";

export interface RewindRequest {
	/** The confirm to show, or null while there is none (or the dry run is pending under 400ms). */
	rewindConfirm: RewindConfirmRequest | null;
	requestRewind: (uuid: string, text: string) => void;
	closeRewindConfirm: () => void;
	confirmRewind: (choice: RewindChoice) => Promise<void>;
}

export function useRewindRequest({
	sessionId,
	conversationAvailable,
	runConversationRewind,
	dependencies = DEFAULT_DEPENDENCIES,
}: {
	sessionId: string;
	/** A live terminal can rewind the conversation; without one only the code can be restored. */
	conversationAvailable: boolean;
	/** Upstream's `kb`: rewinds the conversation and reports its own errors; `afterCode` follows a code restore. */
	runConversationRewind: (uuid: string, text: string, afterCode: boolean) => Promise<void>;
	dependencies?: RewindRequestDependencies;
}): RewindRequest {
	const toast = useToast();
	const [request, setRequest] = useState<RewindConfirmRequest | null>(null);
	const [delayPassed, setDelayPassed] = useState<number | null>(null);
	const phase = useRef<Phase>("idle");
	const token = useRef(0);
	const latest = useRef({sessionId, conversationAvailable, runConversationRewind, dependencies});
	useEffect(() => {
		latest.current = {sessionId, conversationAvailable, runConversationRewind, dependencies};
	});

	// The dialog waits out the first 400ms of a pending dry run.
	const pendingToken = request?.preview === "pending" ? request.token : null;
	useEffect(() => {
		if (pendingToken === null) return undefined;
		const timer = setTimeout(() => {
			setDelayPassed(pendingToken);
		}, REWIND_DIALOG_DELAY_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [pendingToken]);

	const closeRewindConfirm = useCallback(() => {
		token.current += 1;
		phase.current = "idle";
		setRequest(null);
	}, []);

	/** Runs the conversation rewind, with an info toast once it passes 400ms. */
	const runConversation = useCallback(
		async (uuid: string, text: string, afterCode: boolean) => {
			const slow = new AbortController();
			const timer = setTimeout(() => {
				toast({kind: "success", message: "Rewinding…", durationMs: null, signal: slow.signal});
			}, REWIND_DIALOG_DELAY_MS);
			try {
				await latest.current.runConversationRewind(uuid, text, afterCode);
			} finally {
				clearTimeout(timer);
				slow.abort();
			}
		},
		[toast],
	);

	const requestRewind = useCallback(
		(uuid: string, text: string) => {
			if (phase.current !== "idle") return;
			phase.current = "awaiting";
			token.current += 1;
			const mine = token.current;
			const startedAt = Date.now();
			const {sessionId: session, dependencies: current} = latest.current;
			setRequest({token: mine, uuid, text, preview: "pending"});
			const reset = () => {
				setRequest(null);
				phase.current = "idle";
			};
			void current.fetchPreview(session, uuid).then((preview) => {
				if (token.current !== mine) return;
				if (preview === "restoring") {
					reset();
					toast({kind: "warning", message: STILL_RESTORING});
					return;
				}
				if (preview !== null) {
					setRequest({token: mine, uuid, text, preview});
					return;
				}
				if (!latest.current.conversationAvailable) {
					reset();
					toast({kind: "error", message: OFFLINE});
					return;
				}
				if (Date.now() - startedAt >= REWIND_DIALOG_DELAY_MS) {
					setRequest({token: mine, uuid, text, preview: "none"});
					return;
				}
				setRequest(null);
				phase.current = "running";
				void runConversation(uuid, text, false).finally(() => {
					phase.current = "idle";
				});
			});
		},
		[runConversation, toast],
	);

	const confirmRewind = useCallback(
		async (choice: RewindChoice) => {
			if (request === null || request.preview === "pending" || phase.current !== "awaiting") return;
			phase.current = "running";
			const {uuid, text} = request;
			try {
				if (choice !== "conversation") {
					const restored = await latest.current.dependencies.restoreCode(latest.current.sessionId, uuid);
					if (!restored.ok && restored.inFlight) {
						toast({kind: "warning", message: RESTORE_SLOW});
						return;
					}
					if (!restored.ok) {
						phase.current = "awaiting";
						toast({kind: "error", message: RESTORE_FAILED});
						return;
					}
					if (restored.skipped > 0) toast({kind: "warning", message: skippedMessage(restored.skipped)});
					else if (choice === "code") toast({kind: "success", message: "Code restored"});
				}
				if (choice !== "code") await runConversation(uuid, text, choice === "both");
			} finally {
				if (phase.current === "running") {
					phase.current = "idle";
					setRequest(null);
				}
			}
		},
		[request, runConversation, toast],
	);

	const shown = request !== null && (request.preview !== "pending" || delayPassed === request.token) ? request : null;
	return {rewindConfirm: shown, requestRewind, closeRewindConfirm, confirmRewind};
}
