import {useEffect, useReducer, useRef} from "react";

/** Upstream `e4`: the hold a shown value keeps when `minMs` is absent or yields `undefined`. */
export const LABEL_HOLD_DEFAULT_MS = 650;

export type HeldLabelOptions<T> =
	| number
	| {
			minMs?: number | ((shown: T) => number | undefined);
			settleMs?: number;
			line?: string;
			restretch?: boolean;
	  };

interface Shown<T> {
	key: string;
	value: T;
	line: string | undefined;
	armed: boolean;
}

type Action<T> =
	| {type: "swap"; key: string; value: T; line: string | undefined; armed: boolean}
	| {type: "shown"; value: T; line: string | undefined};

function reduce<T>(state: Shown<T>, action: Action<T>): Shown<T> {
	if (action.type === "shown") {
		if (Object.is(action.value, state.value) && action.line === state.line) return state;
		return {...state, value: action.value, line: action.line};
	}
	if (action.key === state.key) return state;
	return {key: action.key, value: action.value, line: action.line, armed: action.armed};
}

interface Clock {
	key: string;
	at: number;
}

/**
 * Port of upstream's shared-frame `Ky`: show `value` until a change of `key` has
 * settled for `settleMs` and the shown value has been up for `minMs` (unless both
 * values share the same `line`). The value present at mount is unarmed, so the
 * first change waits only the settle; with `restretch`, a value reached by a 0ms
 * change is unarmed too.
 */
export function useHeldLabel<T>(value: T, key: string, opts: HeldLabelOptions<T>): T {
	const {minMs, settleMs: settleOpt, line, restretch: restretchOpt} = typeof opts === "object" ? opts : {minMs: opts};
	const settleMs = settleOpt ?? 0;
	const restretch = restretchOpt ?? false;

	const [shown, dispatch] = useReducer(reduce<T>, {key, value, line, armed: false});
	const holdMs = (typeof minMs === "function" ? minMs(shown.value) : minMs) ?? LABEL_HOLD_DEFAULT_MS;
	const armNext = !(restretch && holdMs === 0);

	if (key !== shown.key && (holdMs === 0 || (!shown.armed && settleMs === 0))) {
		dispatch({type: "swap", key, value, line, armed: armNext});
	}

	const pending = key !== shown.key;
	const shownClock = useRef<Clock | null>(null);
	const pendingClock = useRef<Clock | null>(null);
	const latest = useRef({value, line});

	useEffect(() => {
		if (!pending) latest.current = {value, line};
	}, [pending, value, line]);

	useEffect(() => {
		const newest = latest.current;
		if (pending && !(Object.is(shown.value, newest.value) && shown.line === newest.line)) {
			dispatch({type: "shown", value: newest.value, line: newest.line});
		}
	}, [pending, shown.value, shown.line]);

	useEffect(() => {
		if (shownClock.current?.key !== shown.key) shownClock.current = {key: shown.key, at: performance.now()};
	}, [shown.key]);

	useEffect(() => {
		if (!pending) {
			pendingClock.current = null;
		} else if (pendingClock.current?.key !== key) {
			pendingClock.current = {key, at: performance.now()};
		}
	}, [pending, key]);

	const sameLine = line !== undefined && line === shown.line;
	const holdsMinimum = shown.armed && !sameLine;

	useEffect(() => {
		if (!pending) return undefined;
		const now = performance.now();
		const settleAt = (pendingClock.current?.at ?? now) + settleMs;
		const since = shownClock.current;
		const minAt = holdsMinimum && since !== null ? since.at + holdMs : now;
		const at = Math.max(settleAt, minAt);
		const swap = (): void => {
			dispatch({type: "swap", key, value, line, armed: armNext});
		};
		if (now >= at) {
			swap();
			return undefined;
		}
		const timer = setTimeout(swap, at - now);
		return () => {
			clearTimeout(timer);
		};
	}, [pending, key, value, line, holdMs, settleMs, holdsMinimum, armNext]);

	return pending ? shown.value : value;
}
