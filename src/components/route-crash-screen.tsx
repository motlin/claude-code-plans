import {useEffect, useState} from "react";
import {crashCodeSeenRecently, crashErrorCode, rememberCrashCode} from "../lib/crash-error-code";
import {navigateHomeAfterCrash, reloadAfterCrash} from "../lib/route-crash-reload";
import {Spark} from "./spark";

/** Upstream's `Dn`: how long a reload may hang before the screen re-enables Reload or gives up recovering. */
export const CRASH_RELOAD_STUCK_MS = 10_000;

/*
 * Upstream's crash frame is `h-screen` and replaces the whole code layout. Locally the sidebar survives, so the frame
 * fills the page outlet instead, at the same height the not-found page uses.
 */
const CRASH_FRAME_CLASS =
	"flex h-full min-h-[calc(100dvh-4.5rem)] flex-col items-center justify-center px-4 py-10 text-center";

/** Upstream's inline `wc` button: 32px tall, radius 8, secondary fill, a ring that fizzy-lake `stacks` turns off. */
const CRASH_BUTTON_CLASS =
	"h-8 rounded-r6 border-0 bg-fill-secondary px-3 text-[14px] leading-none font-normal text-primary [box-shadow:var(--error-button-edge,inset_0_0_0_1px_var(--color-fill-secondary-ring))] transition-colors hover:bg-fill-secondary-hover disabled:cursor-default disabled:opacity-60";

const SPARK_SIZE = 28;

/** Upstream's `x4` code chip pins this stack inline rather than using the mono token. */
const CRASH_CODE_FONT =
{
	fontFamily: '"Monaco", "Menlo", "Consolas", "Courier New", monospace',
};

/** Upstream's auto-recover frame: the spark alone while a stale-chunk reload is in flight. */
export function RouteCrashRecovering()
{
	return (
		<div role="status" aria-label="Reloading" data-route-crash-recovering="" className={CRASH_FRAME_CLASS}>
			<span className="mr-px inline-flex">
				<Spark size={SPARK_SIZE} />
			</span>
		</div>
	);
}

/** Upstream's `x4`: the error code, only when the same crash already showed within the last minute. */
function RepeatCrashCode({
	error,
}: Readonly<
{
	error: Error;
}>)
{
	const {code, displayCode} = crashErrorCode(error);
	const [repeat] = useState(() => crashCodeSeenRecently(code));
	useEffect(() =>
	{
		rememberCrashCode(code);
	}, [code]);
	if (!repeat) return null;
	return (
		<div className="mt-8 flex flex-col items-center gap-2">
			<p className="text-sm text-secondary">Still not working? Here’s the error code:</p>
			<code
				title={error.message}
				className="inline-block rounded bg-surface-0 px-3 py-1.5 text-sm text-secondary select-all"
				style={CRASH_CODE_FONT}
			>
				{displayCode}
			</code>
		</div>
	);
}

export type RouteCrashVariant = "render" | "chunk";

/** Upstream's `VA` crash screen for a route that threw while rendering or loading. */
export function RouteCrashScreen({
	error,
	variant,
	stuck = false,
}: Readonly<
{
	error: unknown;
	variant: RouteCrashVariant;
	/** A stale-chunk reload that never happened, so the network is the likelier culprit. */
	stuck?: boolean;
}>)
{
	const [reloading, setReloading] = useState(false);
	useEffect(() =>
	{
		if (!reloading) return undefined;
		const timer = setTimeout(() =>
		{
			setReloading(false);
		}, CRASH_RELOAD_STUCK_MS);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [reloading]);

	const chunk = variant === "chunk";
	return (
		<div data-route-crash="" className={CRASH_FRAME_CLASS}>
			<div className="flex flex-1 select-text flex-col items-center justify-center gap-2 pb-14">
				<span className="mb-11 mr-px inline-flex">
					<Spark size={SPARK_SIZE} />
				</span>
				<h1 className="font-voice text-2xl font-medium text-primary sm:text-[2rem]">
					{chunk ? "Couldn’t finish loading" : "This page ran into a problem"}
				</h1>
				<p className="max-w-xl text-secondary sm:text-prose">
					{chunk && stuck ? "Check your connection, then reload." : "Reload to continue."}
				</p>
				<div className="mt-4 flex items-center gap-3 stacks:[--error-button-edge:none]">
					<button
						type="button"
						disabled={reloading}
						onClick={() =>
						{
							setReloading(true);
							reloadAfterCrash();
						}}
						className={CRASH_BUTTON_CLASS}
					>
						Reload
					</button>
					{chunk ? null : (
						<button type="button" onClick={navigateHomeAfterCrash} className={CRASH_BUTTON_CLASS}>
							Home
						</button>
					)}
				</div>
				{error instanceof Error ? <RepeatCrashCode error={error} /> : null}
			</div>
		</div>
	);
}
