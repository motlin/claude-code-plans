import {describe, expect, it} from "vite-plus/test";
import {waitingSessionsToPrefetch, WAITING_PREFETCH_LIMIT} from "../src/lib/waiting-session-prefetch";

function session(sessionId: string, state: "working" | "waiting" | "idle", blockedSince: string | null = null) {
	return {sessionId, state, blockedSince};
}

describe("waitingSessionsToPrefetch", () => {
	it("picks the sessions waiting on the reader, longest-waiting first, skipping the open one and ones already warmed", () => {
		const sessions = [
			session("working", "working"),
			session("newer", "waiting", "2026-10-25T14:50:00.000Z"),
			session("idle", "idle"),
			session("older", "waiting", "2026-10-25T14:40:00.000Z"),
			session("open", "waiting", "2026-10-25T14:30:00.000Z"),
			session("warmed", "waiting", "2026-10-25T14:20:00.000Z"),
			session("undated", "waiting"),
		];

		expect(waitingSessionsToPrefetch(sessions, {openSessionId: "open", warmed: new Set(["warmed"])})).toStrictEqual(
			["older", "newer", "undated"],
		);
	});

	it("warms at most a handful at once", () => {
		const sessions = Array.from({length: WAITING_PREFETCH_LIMIT + 3}, (_, index) =>
			session(`s${index}`, "waiting", new Date(Date.UTC(2026, 9, 25, 14, index)).toISOString()),
		);

		expect(waitingSessionsToPrefetch(sessions, {openSessionId: undefined, warmed: new Set()})).toStrictEqual(
			Array.from({length: WAITING_PREFETCH_LIMIT}, (_, index) => `s${index}`),
		);
	});
});
