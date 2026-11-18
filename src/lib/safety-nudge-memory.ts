import {z} from "zod";

/*
 * Upstream's per-session nudge memory (`hbe`, account pref `epitaxy-jj-sessions` via `$i(..., {scope:"account"})`).
 * Locally it lives in localStorage, per browser. Upstream `y4` keeps the last 199 sessions plus the one written.
 */
export const SAFETY_NUDGE_SESSIONS_KEY = "epitaxy-jj-sessions";

const MAX_SESSIONS = 200;

/** What a session remembers: the one budgeted nudge kind it showed, and whether the user dismissed its nudges. */
const NudgeMemorySchema = z.object(
	{
		shown: z.string().optional(),
		dismissed: z.literal(true).optional(),
	},
);

export type NudgeMemory = z.infer<typeof NudgeMemorySchema>;

type Sessions = Record<string, NudgeMemory>;

/** Every session's memory; unreadable or malformed storage reads as none. */
function readSessions(): Sessions
{
	try
	{
		const parsed = z
			.record(z.string(), NudgeMemorySchema)
			.safeParse(JSON.parse(localStorage.getItem(SAFETY_NUDGE_SESSIONS_KEY) ?? "{}"));
		return parsed.success ? parsed.data : {};
	}
	catch
	{
		return {};
	}
}

/** Upstream `y4`: the written session moves to the newest end, and only the newest 200 are kept. */
function writeSession(sessionId: string, memory: NudgeMemory): void
{
	const {[sessionId]: _previous, ...others} = readSessions();
	const kept = Object.entries(others).slice(-(MAX_SESSIONS - 1));
	try
	{
		localStorage.setItem(
			SAFETY_NUDGE_SESSIONS_KEY,
			JSON.stringify(Object.fromEntries([...kept, [sessionId, memory]])),
		);
	}
	catch
	{
		// No storage: the nudge may show again next time.
	}
}

export function readNudgeMemory(sessionId: string): NudgeMemory
{
	return readSessions()[sessionId] ?? {};
}

/** Upstream `markShown`: records the first budgeted kind the session showed and never overwrites it. */
export function markNudgeShown(sessionId: string, kind: string): void
{
	const memory = readNudgeMemory(sessionId);
	if (memory.shown !== undefined) return;
	writeSession(
		sessionId,
		{
			...memory,
			shown: kind,
		},
	);
}

/** Upstream `dismiss`: hides every budgeted nudge in the session for good. */
export function dismissNudges(sessionId: string): void
{
	writeSession(
		sessionId,
		{
			...readNudgeMemory(sessionId),
			dismissed: true,
		},
	);
}
