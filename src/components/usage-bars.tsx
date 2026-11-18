import {type ReactNode, useEffect, useRef, useState, useSyncExternalStore} from "react";
import {useReducedMotion} from "../lib/reduced-motion";
import {staggerIndexes, USAGE_BARS_GROW, withinGrowWindow} from "../lib/usage-bars-grow";

const FILL_SELECTOR = "[data-usage-bar-fill]";

function isRtl(element: Element): boolean
{
	try
	{
		return element.matches(":dir(rtl)");
	}
	catch
	{
		return false;
	}
}

function subscribeNothing(): () => void
{
	return () =>
	{
	};
}

/** Upstream's `MM`: true only once the client has hydrated. */
function useHydrated(): boolean
{
	return useSyncExternalStore(
		subscribeNothing,
		() => true,
		() => false,
	);
}

/**
 * Upstream's usage-meter wrapper (chunk c37952aed, export `t`): a box-less `div.contents[data-usage-bars]` around
 * a surface's meters. With the gate on (`enabled`, latched at mount) it carries `data-usage-bars-crossfade` and,
 * once `settled`, slides each `[data-usage-bar-fill]` in from fully hidden one time, unless motion is reduced.
 */
export function UsageBars({
	surface,
	settled = true,
	enabled,
	children,
}: {
	surface: "usage_page" | "popover";
	settled?: boolean;
	enabled: boolean;
	children: ReactNode;
})
{
	const reduced = useReducedMotion();
	const hydrated = useHydrated();
	const [gated] = useState(enabled);
	const [decision, setDecision] = useState<
	{
		grow: boolean;
	} | null>(null);
	if (gated && decision === null && settled && hydrated)
		setDecision(
			{
				grow: !reduced,
			},
		);
	else if (decision?.grow === true && reduced)
		setDecision(
			{
				grow: false,
			},
		);
	const grow = decision?.grow === true;

	const ref = useRef<HTMLDivElement>(null);
	const [excluded] = useState(() => new WeakSet<Element>());
	const [animations] = useState(() => new Map<Element, Animation>());
	const timing = useRef<
	{
		decidedAt: number | null;
		firstPlayedAt: number | null;
	}>(
		{
			decidedAt: null,
			firstPlayedAt: null,
		},
	);

	// Before the decision, every fill already in the wrapper is excluded from the slide-in.
	useEffect(() =>
	{
		const root = ref.current;
		if (!gated || decision !== null || root === null) return undefined;
		const exclude = () =>
		{
			for (const fill of root.querySelectorAll(FILL_SELECTOR)) excluded.add(fill);
		};
		exclude();
		const observer = new MutationObserver(exclude);
		observer.observe(
			root,
			{
				childList: true,
				subtree: true,
			},
		);
		return () =>
		{
			observer.disconnect();
		};
	}, [gated, decision, excluded]);

	useEffect(() =>
	{
		const root = ref.current;
		if (!grow || root === null)
		{
			for (const animation of animations.values()) animation.finish();
			return undefined;
		}
		const dir = isRtl(root) ? 1 : -1;
		const state = timing.current;
		state.decidedAt ??= performance.now();
		const decidedAt = state.decidedAt;
		const open = () =>
			withinGrowWindow(
				{
					now: performance.now(),
					decidedAt,
					firstPlayedAt: state.firstPlayedAt,
				},
			);
		const play = () =>
		{
			const fills = [...root.querySelectorAll(FILL_SELECTOR)].filter(
				(fill) => !animations.has(fill) && !excluded.has(fill) && typeof fill.animate === "function",
			);
			if (fills.length === 0) return;
			state.firstPlayedAt ??= performance.now();
			const indexes = staggerIndexes(fills);
			fills.forEach((fill, i) =>
			{
				animations.set(
					fill,
					fill.animate(
						[
							{
								offset: 0,
								transform: `translateX(${dir * 100}%)`,
							},
						],
						{
							duration: USAGE_BARS_GROW.durationMs,
							delay: (indexes[i] ?? 0) * USAGE_BARS_GROW.staggerMs,
							easing: USAGE_BARS_GROW.easing,
							fill: "backwards",
						},
					),
				);
			});
		};
		if (!open()) return undefined;
		play();
		const observer = new MutationObserver(() =>
		{
			if (!open())
			{
				observer.disconnect();
				return;
			}
			play();
		});
		observer.observe(
			root,
			{
				childList: true,
				subtree: true,
			},
		);
		return () =>
		{
			observer.disconnect();
		};
	}, [grow, decision, excluded, animations]);

	return (
		<div
			ref={ref}
			className="contents"
			data-usage-bars={surface}
			data-usage-bars-crossfade={gated ? "" : undefined}
		>
			{children}
		</div>
	);
}
