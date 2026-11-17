import {createContext, useContext, useEffect, useId, useMemo, useState, useSyncExternalStore} from "react";

import {markClaimHolds, TurnMarkOutletStore, type MarkWords, type SaidCall} from "../lib/turn-mark-outlet";

/** Upstream `Zd`: the session's turn-mark store. */
export const TurnMarkOutletContext = createContext<TurnMarkOutletStore | null>(null);

export const noSubscribe = () => () =>
{
};
const never = () => false;

const NO_WORDS: MarkWords =
{
	words: undefined,
	unspoken: false,
	call: undefined,
	callWordsEndedAt: undefined,
};
const noWords = () => NO_WORDS;

/** One turn-mark store per session, for a page that reads it above its provider. */
export function useTurnMarkStore(sessionId: string): TurnMarkOutletStore
{
	// oxlint-disable-next-line react-hooks/exhaustive-deps -- a new session gets a fresh store
	return useMemo(() => new TurnMarkOutletStore(), [sessionId]);
}

/**
 * Upstream `tf`: whether an in-flight row holds the turn mark. It fails while the working line yields, and a fresh
 * claim needs a live turn, though a held one outlasts it. With no provider (a transcript outside a session page),
 * an in-flight row keeps its mark.
 */
export function useMarkClaim(inFlight: boolean, turnLive = true): boolean
{
	const store = useContext(TurnMarkOutletContext);
	const id = useId();
	const [heldBefore, setHeldBefore] = useState(false);
	const watched = inFlight ? store : null;
	const yields = useSyncExternalStore(watched?.subscribeMark ?? noSubscribe, watched?.yields ?? never, never);
	const holds = markClaimHolds(
		{
			hasStore: store !== null,
			inFlight,
			yields,
			heldBefore,
			turnLive,
		},
	);
	if (heldBefore !== holds) setHeldBefore(holds);
	useEffect(() => (store !== null && holds ? store.hold(id) : undefined), [store, id, holds]);
	return store === null ? inFlight : holds;
}

/** Upstream `af`: the working line takes the mark from every row while `on`. */
export function useYieldMark(on: boolean): void
{
	const store = useContext(TurnMarkOutletContext);
	const id = useId();
	useEffect(() => (store !== null && on ? store.yieldFor(id) : undefined), [store, id, on]);
}

/** Upstream `of`: an in-flight row that cannot hold the mark hands `words` to the line; undefined says nothing. */
export function useSayWords(words: string | undefined, unspoken: boolean, call: SaidCall | undefined): void
{
	const store = useContext(TurnMarkOutletContext);
	const id = useId();
	const callId = call?.id;
	const startedAt = call?.startedAt ?? null;
	useEffect(() =>
	{
		if (store === null || words === undefined) return undefined;
		return store.say(
			id,
			words,
			unspoken,
			callId === undefined
				? undefined
				:
					{
						id: callId,
						startedAt,
					},
		);
	}, [store, id, words, unspoken, callId, startedAt]);
}

/** What the working line holds: the newest row's words and its call. */
export function useMarkWords(): MarkWords
{
	const store = useContext(TurnMarkOutletContext);
	return useSyncExternalStore(store?.subscribeMark ?? noSubscribe, store?.markWords ?? noWords, noWords);
}

/** Whether any row holds the turn mark. */
export function useMarkHeld(): boolean
{
	const store = useContext(TurnMarkOutletContext);
	return useSyncExternalStore(store?.subscribeMark ?? noSubscribe, store?.held ?? never, never);
}
