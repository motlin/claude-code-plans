/*
 * Upstream's session-undo stack (c39a247c4 `zt`, singleton `X`), gated by GrowthBook `__gb__3095207653` (shared-39
 * `wU`), which is off on the live account as of 2026-11-06. Local turns it on (upstream-sync M6, 11-04 Q2 answer c);
 * set this to false to fall back to upstream's gate-off behaviour, where Mark as completed offers no undo.
 * Only the `complete` kind is built so far; unpin, move and archive keep their own toasts (session-undo-toast-stack).
 */
export const SESSION_UNDO: boolean = true;

/** Upstream `Rt`: the toast's auto-dismiss window, restarted by every offer. */
export const SESSION_UNDO_WINDOW_MS = 6000;

export type SessionUndoKind = "complete";

export interface SessionUndoEntry
{
	kind: SessionUndoKind;
	sessionIds: readonly string[];
	restore: () => void | Promise<void>;
}

/** Upstream's `notice`; entry labels (unused by `complete`) are not built yet. */
export interface SessionUndoNotice
{
	kind: SessionUndoKind;
	/** Distinct sessions across the stack. */
	count: number;
}

const listeners = new Set<() => void>();
let entries: SessionUndoEntry[] = [];
let notice: SessionUndoNotice | null = null;

function update(): void
{
	const first = entries[0];
	notice =
		first === undefined
			? null
			:
				{
					kind: first.kind,
					count: new Set(entries.flatMap((entry) => entry.sessionIds)).size,
				};
	for (const listener of listeners) listener();
}

/**
 * Upstream `offer`: keeps entries of the same kind whose sessions don't overlap the new one, drops every entry of
 * another kind, and appends the new one. `complete` is the only kind so far, so only the overlap filter applies.
 */
export function offerSessionUndo(entry: SessionUndoEntry): void
{
	if (!SESSION_UNDO || entry.sessionIds.length === 0) return;
	const ids = new Set(entry.sessionIds);
	entries = [...entries.filter((kept) => !kept.sessionIds.some((id) => ids.has(id))), entry];
	update();
}

/** Upstream `undo()`: clears the stack, then restores each entry newest first; a throw is logged and skipped. */
export async function undoSessions(): Promise<void>
{
	const stack = entries;
	if (stack.length === 0) return;
	entries = [];
	update();
	for (const entry of stack.toReversed())
	{
		try
		{
			await entry.restore();
		}
		catch (error: unknown)
		{
			console.error("session undo: restore threw", error);
		}
	}
}

export function dismissSessionUndo(): void
{
	if (entries.length === 0) return;
	entries = [];
	update();
}

export function sessionUndoNotice(): SessionUndoNotice | null
{
	return notice;
}

export function subscribeSessionUndo(listener: () => void): () => void
{
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Upstream `Xt`'s copy per kind. */
const KIND_TITLES =
{
	/* id `sxTeyv` */
	complete: (count: number) => `Marked ${count} ${count === 1 ? "session" : "sessions"} as completed`,
} as const satisfies Record<SessionUndoKind, (count: number) => string>;

export function sessionUndoTitle(current: SessionUndoNotice): string
{
	return KIND_TITLES[current.kind](current.count);
}

export function resetSessionUndo(): void
{
	entries = [];
	notice = null;
}
