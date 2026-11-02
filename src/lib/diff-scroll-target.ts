import {useSyncExternalStore} from "react";
import type {DiffSide} from "./diff-comments";

/*
 * claude.ai/code's diff scroll target: the `diff-annotations` store's `scrollTargetBySession` (cc8941b7b
 * `scrollToAnnotation` / `clearScrollTarget`), kept in memory. The nonce makes a repeat request for the same target fire
 * again. Local has one Changes pane per session, so upstream's `tileId` drops out.
 */

export interface DiffScrollTarget
{
	filePath: string;
	nonce: number;
	fuzzy?: true;
	anchor?:
	{
		side: DiffSide;
		line: number;
	};
}

const targets = new Map<string, DiffScrollTarget>();
const listeners = new Set<() => void>();

function notify(): void
{
	for (const listener of listeners) listener();
}

/** Upstream `scrollToAnnotation(session, filePath, {fuzzy?, anchor?})`. */
export function scrollToDiffLine(
	sessionId: string,
	filePath: string,
	options?:
	{
		fuzzy?: boolean;
		anchor?:
		{
			side: DiffSide;
			line: number;
		};
	},
): void
{
	targets.set(
		sessionId,
		{
			filePath,
			nonce: (targets.get(sessionId)?.nonce ?? 0) + 1,
			...(options?.fuzzy === true &&
			{
				fuzzy: true,
			}),
			...(options?.anchor !== undefined &&
			{
				anchor: options.anchor,
			}),
		},
	);
	notify();
}

/** Upstream `clearScrollTarget`. */
export function clearDiffScrollTarget(sessionId: string): void
{
	if (!targets.delete(sessionId)) return;
	notify();
}

export function diffScrollTarget(sessionId: string): DiffScrollTarget | undefined
{
	return targets.get(sessionId);
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

/** Upstream selector `Si(session)`. */
export function useDiffScrollTarget(sessionId: string | undefined): DiffScrollTarget | undefined
{
	return useSyncExternalStore(
		subscribe,
		() => (sessionId === undefined ? undefined : targets.get(sessionId)),
		() => undefined,
	);
}

/** Upstream cd14a8022 `P` (imported as `Ln`): the diff path is the target, or ends with `/` + the target. */
function pathMatches(target: string, path: string): boolean
{
	const wanted = target.replaceAll("\\", "/");
	const candidate = path.replaceAll("\\", "/");
	return candidate === wanted || candidate.endsWith(`/${wanted}`);
}

/** Upstream `yi`'s fuzzy branch: the exact path, else the one path that matches; none or several give null. */
export function resolveFuzzyDiffPath(target: string, paths: readonly string[]): string | null
{
	if (paths.includes(target)) return target;
	const matches = paths.filter((path) => pathMatches(target, path));
	return matches.length === 1 ? (matches[0] ?? null) : null;
}
