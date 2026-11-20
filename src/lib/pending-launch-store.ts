import {useEffect, useState, useSyncExternalStore} from "react";

/**
 * A session this tab is launching (upstream's optimistic spawn store `A_.pending`): the sidebar draws a skeleton row
 * for it until the session's real row arrives.
 */
export interface PendingLaunchEntry
{
	/** `launch:<since>`, the synthetic row's key for the whole launch. */
	key: string;
	/** The launch folder's project id, which the session's list row carries as `project`. */
	projectId: string;
	projectName: string;
	cwd: string;
	/** Client clock when the launch began. */
	since: number;
	/** Home will open the session, so its row draws selected (a ⌘⏎ stay launch does not). */
	opens: boolean;
	/** The id herdr reported for the new agent, once it answers with one. */
	sessionId: string | null;
}

export type PendingLaunchInput = Omit<PendingLaunchEntry, "key" | "sessionId">;

/** How long a settled launch's row keeps revealing its title (upstream `UT(pending, 1500)`), in ms. */
const LAUNCH_REVEAL_MS = 1500;

/**
 * How long a started launch's row waits for its session, in ms: upstream's give-up for a code spawn (`zV`), counted
 * from herdr's answer as upstream counts from the spawn's settle. A launch whose session never shows up (claude exited,
 * the tab was closed) drops its row then; a session that arrives later still gets its real row.
 */
const LAUNCH_GIVE_UP_MS = 15_000;

let entries: readonly PendingLaunchEntry[] = [];
/** Each started launch's give-up timer, by key. */
const giveUpTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** When each launched session's launch settled, for its row's first-title reveal. */
const settledAt = new Map<string, number>();
const listeners = new Set<() => void>();

function publish(next: readonly PendingLaunchEntry[]): void
{
	entries = next;
	for (const listener of listeners) listener();
}

function cancelGiveUp(key: string): void
{
	clearTimeout(giveUpTimers.get(key));
	giveUpTimers.delete(key);
}

/** Publish a launch that is starting; returns its key. */
export function addPendingLaunch(launch: PendingLaunchInput): string
{
	const key = `launch:${launch.since}`;
	publish([
		...entries.filter((entry) => entry.key !== key),
		{
			...launch,
			key,
			sessionId: null,
		},
	]);
	return key;
}

/** herdr answered the launch, naming the new agent's session when it knew it: start waiting for that session's row. */
export function markPendingLaunchStarted(key: string, sessionId: string | null): void
{
	if (!entries.some((entry) => entry.key === key)) return;
	cancelGiveUp(key);
	giveUpTimers.set(
		key,
		setTimeout(() =>
		{
			clearPendingLaunch(key);
		}, LAUNCH_GIVE_UP_MS),
	);
	if (sessionId === null) return;
	publish(
		entries.map((entry) =>
			entry.key === key
				?
					{
						...entry,
						sessionId,
					}
				: entry,
		),
	);
}

/** The launch produced `sessionId`: drop its skeleton row and start that session's title-reveal window. */
export function settlePendingLaunch(key: string, sessionId: string): void
{
	if (!entries.some((entry) => entry.key === key)) return;
	cancelGiveUp(key);
	settledAt.set(sessionId, Date.now());
	publish(entries.filter((entry) => entry.key !== key));
}

/** The launch failed or gave up: drop its skeleton row. */
export function clearPendingLaunch(key: string): void
{
	cancelGiveUp(key);
	if (!entries.some((entry) => entry.key === key)) return;
	publish(entries.filter((entry) => entry.key !== key));
}

export function readPendingLaunches(): readonly PendingLaunchEntry[]
{
	return entries;
}

/** When the launch that produced `sessionId` settled, if this tab launched it. */
export function launchSettledAt(sessionId: string): number | undefined
{
	return settledAt.get(sessionId);
}

export function subscribePendingLaunches(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

const NO_LAUNCHES: readonly PendingLaunchEntry[] = [];

function serverLaunches(): readonly PendingLaunchEntry[]
{
	return NO_LAUNCHES;
}

export function usePendingLaunches(): readonly PendingLaunchEntry[]
{
	return useSyncExternalStore(subscribePendingLaunches, readPendingLaunches, serverLaunches);
}

function noSettledAt(): undefined
{
	return undefined;
}

/** When this tab's launch of `sessionId` settled, re-rendering when it does. */
function useLaunchSettledAt(sessionId: string): number | undefined
{
	return useSyncExternalStore(subscribePendingLaunches, () => settledAt.get(sessionId), noSettledAt);
}

function revealWindowOpen(at: number | undefined): boolean
{
	return at !== undefined && Date.now() < at + LAUNCH_REVEAL_MS;
}

/**
 * Whether a row's title reveals (upstream `UT(pending, 1500)` gating `CR`): only for a session this tab launched, and
 * only until 1500 ms after its launch settled. Every other row, and this one afterwards, draws its title as plain text.
 */
export function useLaunchTitleReveal(sessionId: string): boolean
{
	const at = useLaunchSettledAt(sessionId);
	const [reveal, setReveal] = useState(() => (
	{
		at,
		open: revealWindowOpen(at),
	}));
	if (reveal.at !== at)
		setReveal(
			{
				at,
				open: revealWindowOpen(at),
			},
		);
	const open = reveal.at === at && reveal.open;
	useEffect(() =>
	{
		if (!open || at === undefined) return undefined;
		const timer = setTimeout(
			() =>
			{
				setReveal((current) =>
					current.at === at
						?
							{
								at,
								open: false,
							}
						: current,
				);
			},
			at + LAUNCH_REVEAL_MS - Date.now(),
		);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [open, at]);
	return open;
}

interface LaunchedRowCandidate
{
	id: string;
	/** The session's project id (its encoded cwd). */
	project: string;
	/** ISO creation time. */
	created: string;
}

/**
 * The sessions-list row a pending launch produced: herdr's id when known, else a row created since the launch in its
 * project or in a worktree the CLI's `--worktree` made under it (`<cwd>/.claude/worktrees/<name>`, encoded).
 */
export function findLaunchedRow(rows: Iterable<LaunchedRowCandidate>, launch: PendingLaunchEntry): string | null
{
	const worktreePrefix = `${launch.projectId}--claude-worktrees-`;
	for (const row of rows)
	{
		if (row.id === launch.sessionId) return row.id;
		if (Date.parse(row.created) < launch.since) continue;
		if (row.project === launch.projectId || row.project.startsWith(worktreePrefix)) return row.id;
	}
	return null;
}

export const __pendingLaunchTesting =
{
	reset(): void
	{
		for (const timer of giveUpTimers.values()) clearTimeout(timer);
		giveUpTimers.clear();
		entries = [];
		settledAt.clear();
	},
};
