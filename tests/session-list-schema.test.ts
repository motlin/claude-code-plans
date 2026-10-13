import {describe, expect, it} from "vite-plus/test";
import {GroupedSessionsResponse, RecentSessionsResponse, SessionsByIdsResponse} from "../src/lib/api/sessions";
import type {SessionSummaryPayload} from "../src/lib/hook-events";

const WAITING_ON_PERMISSION: SessionSummaryPayload = {
	id: "session-test-100",
	title: "GHA build speed optimization",
	summary: undefined,
	mtime: "2026-10-13T16:50:00.000Z",
	created: "2026-10-13T15:00:00.000Z",
	project: "-Users-example-alice",
	projectName: "alice",
	messageCount: 42,
	gitBranch: undefined,
	archived: false,
	state: "waiting",
	awaitingPermission: true,
	bucket: "blocked",
	liveAgentCount: 0,
	unseen: false,
	blockedSince: "2026-10-13T16:49:00.000Z",
};

/** The payload as JSON delivers it, without the keys that were undefined. */
const wire = JSON.parse(JSON.stringify(WAITING_ON_PERMISSION)) as unknown;

describe("session list response schemas", () => {
	it("keep a session's permission wait in the grouped, recent and by-id lists", () => {
		expect({
			grouped: GroupedSessionsResponse.parse([
				{project: "-Users-example-alice", projectName: "alice", sessionCount: 1, sessions: [wire]},
			])[0]?.sessions[0]?.awaitingPermission,
			recent: RecentSessionsResponse.parse({sessions: [wire], nextCursor: null}).sessions[0]?.awaitingPermission,
			byIds: SessionsByIdsResponse.parse([wire])[0]?.awaitingPermission,
		}).toStrictEqual({grouped: true, recent: true, byIds: true});
	});
});
