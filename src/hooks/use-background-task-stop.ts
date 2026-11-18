import {useCallback, useEffect, useMemo, useRef, useSyncExternalStore} from "react";

import type {ToastOptions} from "../components/toast-context";
import {stopHerdrBackgroundTask, type StoppableTask} from "../lib/api/herdr";
import type {BackgroundTask} from "../lib/background-tasks";

/** How long a sent stop waits for the transcript to show the task no longer running before reporting failure. */
export const BACKGROUND_TASK_STOP_CONFIRM_MS = 5000;

/** Upstream's `TFDx1B` toast. */
const STOP_FAILED = "Couldn’t stop the task — check your connection and try again.";

interface Stopping
{
	phase: "sending" | "confirming";
	timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Upstream's `stoppingTaskIds` (`qp`, its pending stop mutations): which tasks each session is stopping, kept
 * outside React so the Background tasks pane and the rail card read the same set wherever they render.
 */
const stopping = new Map<string, Map<string, Stopping>>();
const snapshots = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
const NONE: ReadonlySet<string> = new Set();

function changed(sessionId: string): void
{
	const ids = stopping.get(sessionId);
	snapshots.set(sessionId, ids === undefined || ids.size === 0 ? NONE : new Set(ids.keys()));
	for (const listener of listeners) listener();
}

function setStopping(sessionId: string, taskId: string, entry: Stopping): void
{
	const ids = stopping.get(sessionId) ?? new Map<string, Stopping>();
	ids.set(taskId, entry);
	stopping.set(sessionId, ids);
	changed(sessionId);
}

function clearStopping(sessionId: string, taskId: string): void
{
	const entry = stopping.get(sessionId)?.get(taskId);
	if (entry === undefined) return;
	if (entry.timer !== null) clearTimeout(entry.timer);
	stopping.get(sessionId)?.delete(taskId);
	changed(sessionId);
}

/** Test seam: forget every stop in flight. */
export function resetStoppingTasks(): void
{
	for (const ids of stopping.values())
	{
		for (const entry of ids.values()) if (entry.timer !== null) clearTimeout(entry.timer);
	}
	stopping.clear();
	snapshots.clear();
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

/** The session's tasks with a stop in flight: sent, or sent and not yet seen to stop in the transcript. */
export function useStoppingTaskIds(sessionId: string): ReadonlySet<string>
{
	const snapshot = useCallback(() => snapshots.get(sessionId) ?? NONE, [sessionId]);
	return useSyncExternalStore(subscribe, snapshot, () => NONE);
}

export interface BackgroundTaskStop
{
	stop: (task: BackgroundTask) => void;
}

export interface BackgroundTaskStopOptions
{
	sessionId: string;
	/** A live pane that accepts writes, on a session that isn't archived (upstream's not `readOnly`). */
	enabled: boolean;
	/** The session's running tasks, from its transcript. */
	running: readonly BackgroundTask[];
	toast: (options: ToastOptions) => void;
	stop?: (sessionId: string, task: StoppableTask) => Promise<void>;
}

/**
 * Upstream's per-row stop (`MI` over the `dl` mutation), through the CLI's `/tasks` dialog. A press sends the
 * stop, and the task stays "Stopping…" until the transcript shows it no longer running (upstream fakes a stopped
 * notification instead; locally the CLI writes its own). A refused request, or a task still running
 * {@link BACKGROUND_TASK_STOP_CONFIRM_MS} later, gets upstream's error toast. Null when the session can't take
 * writes, so no Stop renders.
 */
export function useBackgroundTaskStop({
	sessionId,
	enabled,
	running,
	toast,
	stop = stopHerdrBackgroundTask,
}: BackgroundTaskStopOptions): BackgroundTaskStop | null
{
	const runningIds = useMemo(() => new Set(running.map((task) => task.id)), [running]);
	const runningRef = useRef(runningIds);
	useEffect(() =>
	{
		runningRef.current = runningIds;
		for (const [taskId, entry] of stopping.get(sessionId) ?? [])
		{
			if (entry.phase === "confirming" && !runningIds.has(taskId)) clearStopping(sessionId, taskId);
		}
	}, [runningIds, sessionId]);

	const onStop = useCallback(
		(task: BackgroundTask) =>
		{
			if (stopping.get(sessionId)?.has(task.id) === true) return;
			setStopping(
				sessionId,
				task.id,
				{
					phase: "sending",
					timer: null,
				},
			);
			stop(
				sessionId,
				{
					kind: task.kind,
					description: task.description,
					command: task.command,
				},
			).then(
				() =>
				{
					if (stopping.get(sessionId)?.has(task.id) !== true) return;
					if (!runningRef.current.has(task.id))
					{
						clearStopping(sessionId, task.id);
						return;
					}
					const timer = setTimeout(() =>
					{
						clearStopping(sessionId, task.id);
						toast(
							{
								kind: "error",
								message: STOP_FAILED,
							},
						);
					}, BACKGROUND_TASK_STOP_CONFIRM_MS);
					setStopping(
						sessionId,
						task.id,
						{
							phase: "confirming",
							timer,
						},
					);
				},
				(error: unknown) =>
				{
					clearStopping(sessionId, task.id);
					toast(
						{
							kind: "error",
							message: STOP_FAILED,
							description: error instanceof Error ? error.message : String(error),
						},
					);
				},
			);
		},
		[sessionId, stop, toast],
	);

	return useMemo(
		() =>
			enabled
				?
					{
						stop: onStop,
					}
				: null,
		[enabled, onStop],
	);
}
