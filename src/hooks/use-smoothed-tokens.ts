import {useEffect, useRef, useState} from "react";

import {usePrefersReducedMotion} from "../lib/reduced-motion";
import
{
	createTokenSmoother,
	seedsAtCurrent,
	TOKEN_REDUCED_TICK_MS,
	TOKEN_TICK_MS,
	type TokenSmoother,
} from "../lib/token-smoother";
import {formatTokenEstimate} from "../lib/working-marker";

interface SmoothedDisplay
{
	sessionKey: string | undefined;
	smoother: TokenSmoother;
	value: number;
}

interface SmoothedTokensInput
{
	sessionKey: string | undefined;
	tokens: number;
	running: boolean;
	/** When the turn's count first turned positive (ms since epoch), upstream's `firstPositiveAt`. */
	firstPositiveAt: number | undefined;
}

/** Upstream's `N6`/`seedFor`: a new display starts at the current count when `nSe` says so, else empty. */
function freshDisplay({sessionKey, tokens, running, firstPositiveAt}: Readonly<SmoothedTokensInput>): SmoothedDisplay
{
	const smoother = createTokenSmoother();
	const seeded = seedsAtCurrent(
		{
			tokens,
			running,
			firstPositiveAt,
			now: Date.now(),
		},
	);
	if (seeded) smoother.snapTo(tokens, performance.now());
	return {
		sessionKey,
		smoother,
		value: seeded ? tokens : 0,
	};
}

/** Upstream's `show`: a new value re-renders only when its formatted text changes. */
function showValue(prev: SmoothedDisplay, smoother: TokenSmoother, value: number): SmoothedDisplay
{
	if (prev.smoother !== smoother || formatTokenEstimate(prev.value) === formatTokenEstimate(value)) return prev;
	return {
		...prev,
		value,
	};
}

/**
 * Upstream's `iSe` + `aSe`: the working line's token count, ticking every 100ms toward the live count through the
 * linear smoother, snapping every 1000ms under reduced motion, and showing the raw count while not running. A tick
 * re-renders only when the formatted text changes.
 */
export function useSmoothedTokens(input: Readonly<SmoothedTokensInput>): number
{
	const {sessionKey, tokens, running} = input;
	const reduced = usePrefersReducedMotion();
	const [stored, setDisplay] = useState(() => freshDisplay(input));
	let display = stored;
	if (stored.sessionKey !== sessionKey)
	{
		display = freshDisplay(input);
		setDisplay(display);
	}
	const {smoother} = display;
	const tokensRef = useRef(tokens);
	useEffect(() =>
	{
		tokensRef.current = tokens;
	}, [tokens]);

	useEffect(() =>
	{
		if (running) return;
		const now = performance.now();
		if (tokens > 0) smoother.snapTo(tokens, now);
		else smoother.update(undefined, now);
		setDisplay((prev) => showValue(prev, smoother, tokens));
	}, [smoother, running, tokens]);

	useEffect(() =>
	{
		if (!running) return undefined;
		const timer = setInterval(
			() =>
			{
				const current = tokensRef.current;
				const now = performance.now();
				let next = current;
				if (reduced)
				{
					if (current > 0) smoother.snapTo(current, now);
					else smoother.update(undefined, now);
				}
				else
				{
					smoother.update(current > 0 ? current : undefined, now);
					next = smoother.valueAt(now) ?? current;
				}
				setDisplay((prev) => showValue(prev, smoother, next));
			},
			reduced ? TOKEN_REDUCED_TICK_MS : TOKEN_TICK_MS,
		);
		return () =>
		{
			clearInterval(timer);
		};
	}, [smoother, running, reduced]);

	return running ? display.value : tokens;
}
