import {useCallback, useEffect, useMemo, useRef} from "react";

import {useToast} from "../components/toast-context";
import {sendHerdrRewind} from "../lib/api/herdr";
import {focusComposer, getComposerText, refillComposer} from "../lib/context-attach";
import {rewindStepsBack, type RewindTurn} from "../lib/rewind-picker";

/** Upstream's draft guard (`Px`, uniqueKey `refusal-band-edit-retry-blocked`). */
export const REFUSAL_EDIT_RETRY_BLOCKED = "Send or clear your draft first, then select Rewind and retry.";
/** Upstream's declined/failed rewind warning (uniqueKey `refusal-band-edit-retry-declined`). */
export const REFUSAL_EDIT_RETRY_DECLINED = "Couldn’t go back to that message. Use Rewind on the message instead.";

/**
 * Upstream's refusal band "Rewind and retry" (`handleRefusalFallbackEditRetry`, cc43287c9 `Px`): rewinds
 * the live CLI to the refused prompt with no confirm and puts that prompt back in the composer. It is
 * undefined unless the session can rewind now and the fallback names its refused prompt (upstream `Mx`).
 * Calling it returns true once a retry started, false when a draft or an in-flight retry refused it.
 */
export function useRefusalEditRetry({
	sessionId,
	refusedUuid,
	available,
	turns,
}: {
	sessionId: string;
	refusedUuid: string | null;
	/** The session page's `rewindAvailable && !rewindBusy`. */
	available: boolean;
	turns: readonly RewindTurn[];
}): (() => boolean) | undefined {
	const toast = useToast();
	const inFlight = useRef(false);
	const latest = useRef({sessionId, refusedUuid, turns});
	useEffect(() => {
		latest.current = {sessionId, refusedUuid, turns};
	});

	const retry = useCallback((): boolean => {
		const {sessionId: session, refusedUuid: uuid, turns: current} = latest.current;
		if (uuid === null || inFlight.current) return false;
		if ((getComposerText(session) ?? "").trim() !== "") {
			toast({kind: "warning", message: REFUSAL_EDIT_RETRY_BLOCKED, uniqueKey: "refusal-band-edit-retry-blocked"});
			return false;
		}
		focusComposer(session);
		const declined = () => {
			toast({
				kind: "warning",
				message: REFUSAL_EDIT_RETRY_DECLINED,
				uniqueKey: "refusal-band-edit-retry-declined",
			});
		};
		const text = current.find((turn) => turn.uuid === uuid)?.text ?? "";
		const stepsBack = rewindStepsBack(current, uuid);
		if (text.trim() === "" || stepsBack === null) {
			declined();
			return true;
		}
		inFlight.current = true;
		void sendHerdrRewind(session, {stepsBack, text})
			.then(() => {
				refillComposer(session, text);
				focusComposer(session);
			}, declined)
			.finally(() => {
				inFlight.current = false;
			});
		return true;
	}, [toast]);

	return useMemo(() => (available && refusedUuid !== null ? retry : undefined), [available, refusedUuid, retry]);
}
