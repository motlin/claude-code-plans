import {useSyncExternalStore} from "react";

import type {SessionListItem} from "./api/sessions";
import type {SessionSummaryState} from "./session-state";

/**
 * The local analogue of upstream's responding override: upstream knows a
 * session runs again from its own live stream, so an answered row draws
 * running at the click. Locally only the server says so, seconds later, so a
 * session this tab just answered is held here and every view draws its stale
 * `waiting` as working until the server confirms or the 5000ms cap (upstream's
 * `NH` grace) runs out.
 */
const ANSWERED_HOLD_MS = 5000;

interface Hold {
	/** The answered tool call; a different pending one is a new wait. */
	key: string;
	timer: ReturnType<typeof setTimeout>;
	/** The server has said the session moved on, so its next `waiting` is genuine. */
	confirmed: boolean;
}

const holds = new Map<string, Hold>();

const listeners = new Set<() => void>();

/** Upstream's shared frozen empty set (`EA`/`Pl`), returned while nothing is held. */
const EMPTY: ReadonlySet<string> = Object.freeze(new Set<string>());

let snapshot: ReadonlySet<string> = EMPTY;

function notify(): void {
	snapshot = holds.size === 0 ? EMPTY : new Set(holds.keys());
	for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Holds the session as answered; re-arming restarts the cap, as upstream's `u$`. */
export function holdAnswered(sessionId: string, key: string, ms = ANSWERED_HOLD_MS): void {
	const previous = holds.get(sessionId);
	if (previous !== undefined) clearTimeout(previous.timer);
	const timer = setTimeout(() => {
		if (holds.get(sessionId)?.timer !== timer) return;
		holds.delete(sessionId);
		notify();
	}, ms);
	holds.set(sessionId, {key, timer, confirmed: false});
	notify();
}

export function releaseAnswered(sessionId: string): void {
	const hold = holds.get(sessionId);
	if (hold === undefined) return;
	clearTimeout(hold.timer);
	holds.delete(sessionId);
	notify();
}

/** Drops every hold and its timer, as a fresh module starts; tests call it between cases. */
export function resetAnsweredSessions(): void {
	for (const hold of holds.values()) clearTimeout(hold.timer);
	holds.clear();
	notify();
}

export function isAnsweredHeld(sessionId: string): boolean {
	return holds.has(sessionId);
}

/**
 * A server summary for the session. Session lists refetch after it, so a
 * `waiting` before the server has said anything else is the stale one the
 * hold masks; once a non-waiting summary arrived, the next `waiting` is a new
 * wait and releases the hold.
 */
export function noteAnsweredSummary(sessionId: string, state: SessionSummaryState): void {
	const hold = holds.get(sessionId);
	if (hold === undefined) return;
	if (state !== "waiting") hold.confirmed = true;
	else if (hold.confirmed) releaseAnswered(sessionId);
}

/** A pending question or permission for the session: another tool call than the answered one is a new wait. */
export function noteAnsweredPending(sessionId: string, toolUseId: string): void {
	const hold = holds.get(sessionId);
	if (hold !== undefined && hold.key !== toolUseId) releaseAnswered(sessionId);
}

/** The ids of every held session; the same empty set while none is. */
export function useAnsweredSessionIds(): ReadonlySet<string> {
	return useSyncExternalStore(
		subscribe,
		() => snapshot,
		() => EMPTY,
	);
}

/** A held session waiting on input draws as working, as upstream's `_B` draws a responding row; else the same object. */
export function withAnsweredHold(session: SessionListItem, held: boolean): SessionListItem {
	if (!held || session.state !== "waiting" || session.unseenError === true) return session;
	const {awaitingPermission: _answered, ...rest} = session;
	return {...rest, state: "working", bucket: "working"};
}

/** Every held session in the list drawn as working; the same list while none is held. */
export function withAnsweredHolds(sessions: SessionListItem[], held: ReadonlySet<string>): SessionListItem[] {
	if (held.size === 0) return sessions;
	return sessions.map((session) => withAnsweredHold(session, held.has(session.id)));
}
