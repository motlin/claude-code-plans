import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {useToast} from "../components/toast-context";
import {BASH_MODE_REFUSAL, composerInBashMode, focusComposer, getComposerText} from "../lib/context-attach";
import type {HardBlock} from "../lib/hard-block";
import type {RewindTurn} from "../lib/rewind-picker";

/** Upstream's refusals for Edit and retry, all on uniqueKey `hard-block-rerun-blocked`. */
const HARD_BLOCK_RERUN_WORKING = "Rewind is unavailable while Claude is working";
const HARD_BLOCK_RERUN_DRAFT = "Clear your draft first, then select Edit and retry.";
const RERUN_BLOCKED_KEY = "hard-block-rerun-blocked";

export interface HardBlockEditRetry
{
	/** Upstream's wrapped host handler: true once a rewind started. Undefined when the session can't rewind. */
	onEditRetry: ((uuid: string) => boolean) | undefined;
	/** The card whose rewind is running (upstream `editRetryBusyFor`). */
	busyFor: string | null;
}

/**
 * Upstream's hard-block Edit and retry (cc43287c9 `Vx` `handleHardBlockEditRetry`, wrapped by cf6ae6197 `Fc`):
 * silently refuses while a retry runs or once the blocked prompt is no longer the last rewindable one, warns
 * while Claude works, in bash mode or over a draft, else focuses the composer and rewinds the live CLI to the
 * last prompt, which `runConversationRewind` puts back in the composer. The card shows busy until it settles.
 */
export function useHardBlockEditRetry({
	sessionId,
	available,
	busy,
	block,
	turns,
	runConversationRewind,
}: {
	sessionId: string;
	/** The session page's `rewindAvailable`. */
	available: boolean;
	/** The session page's `rewindBusy`. */
	busy: boolean;
	/** The newest turn's hard block. */
	block: HardBlock | null;
	turns: readonly RewindTurn[];
	runConversationRewind: (uuid: string, text: string, afterCode: boolean) => Promise<void>;
}): HardBlockEditRetry
{
	const toast = useToast();
	const inFlight = useRef(false);
	const [busyFor, setBusyFor] = useState<string | null>(null);
	const latest = useRef(
		{
			sessionId,
			busy,
			block,
			turns,
			runConversationRewind,
		},
	);
	useEffect(() =>
	{
		latest.current =
		{
			sessionId,
			busy,
			block,
			turns,
			runConversationRewind,
		};
	});

	const retry = useCallback(
		(uuid: string): boolean =>
		{
			const current = latest.current;
			const target = current.turns.at(-1);
			if (inFlight.current || current.block?.hasMessage !== true || target === undefined) return false;
			let refusal: string | null = null;
			if (current.busy) refusal = HARD_BLOCK_RERUN_WORKING;
			else if (composerInBashMode(current.sessionId)) refusal = BASH_MODE_REFUSAL;
			else if ((getComposerText(current.sessionId) ?? "").trim() !== "") refusal = HARD_BLOCK_RERUN_DRAFT;
			if (refusal !== null)
			{
				toast(
					{
						kind: "warning",
						message: refusal,
						uniqueKey: RERUN_BLOCKED_KEY,
					},
				);
				return false;
			}
			focusComposer(current.sessionId);
			inFlight.current = true;
			setBusyFor(uuid);
			void current.runConversationRewind(target.uuid, target.text, false).finally(() =>
			{
				inFlight.current = false;
				setBusyFor(null);
			});
			return true;
		},
		[toast],
	);

	return useMemo(
		() => (
		{
			onEditRetry: available ? retry : undefined,
			busyFor,
		}),
		[available, retry, busyFor],
	);
}
