// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	dismissNudges,
	markNudgeShown,
	readNudgeMemory,
	SAFETY_NUDGE_SESSIONS_KEY,
} from "../src/lib/safety-nudge-memory";

function stored(): unknown
{
	return JSON.parse(localStorage.getItem(SAFETY_NUDGE_SESSIONS_KEY) ?? "null");
}

describe("safety nudge memory", () =>
{
	beforeEach(() =>
	{
		localStorage.clear();
	});

	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	it("uses upstream's key and reads an unknown session as empty", () =>
	{
		expect([SAFETY_NUDGE_SESSIONS_KEY, readNudgeMemory("s1")]).toStrictEqual(["epitaxy-jj-sessions", {}]);
	});

	it("records the first kind shown and never overwrites it", () =>
	{
		markNudgeShown("s1", "asks");
		markNudgeShown("s1", "repeat");
		expect([readNudgeMemory("s1"), stored()]).toStrictEqual([
			{
				shown: "asks",
			},
			{
				s1:
				{
					shown: "asks",
				},
			},
		]);
	});

	it("dismisses a session, keeping the kind it showed", () =>
	{
		markNudgeShown("s1", "asks");
		dismissNudges("s1");
		dismissNudges("s2");
		expect(stored()).toStrictEqual(
			{
				s1:
				{
					shown: "asks",
					dismissed: true,
				},
				s2:
				{
					dismissed: true,
				},
			},
		);
	});

	it("keeps the last 200 sessions, dropping the oldest", () =>
	{
		for (let index = 1; index <= 201; index++) dismissNudges(`s${index}`);
		const sessions = Object.keys(stored() as Record<string, unknown>);
		expect([sessions.length, sessions[0], sessions.at(-1), readNudgeMemory("s1")]).toStrictEqual([
			200,
			"s2",
			"s201",
			{},
		]);
	});

	it("moves a rewritten session to the newest end so it survives the cap", () =>
	{
		dismissNudges("s1");
		for (let index = 2; index <= 200; index++) dismissNudges(`s${index}`);
		markNudgeShown("s1", "asks");
		dismissNudges("s201");
		expect([readNudgeMemory("s1"), readNudgeMemory("s2")]).toStrictEqual([
			{
				shown: "asks",
				dismissed: true,
			},
			{},
		]);
	});

	it("reads empty memory without throwing when storage throws or holds garbage", () =>
	{
		localStorage.setItem(SAFETY_NUDGE_SESSIONS_KEY, "{not json");
		const garbage = readNudgeMemory("s1");
		localStorage.setItem(
			SAFETY_NUDGE_SESSIONS_KEY,
			JSON.stringify(
				{
					s1:
					{
						shown: 3,
						dismissed: "yes",
					},
				},
			),
		);
		const wrongShape = readNudgeMemory("s1");
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});
		expect([garbage, wrongShape, readNudgeMemory("s1")]).toStrictEqual([{}, {}, {}]);
		expect(() =>
		{
			dismissNudges("s1");
		}).not.toThrow();
	});
});
