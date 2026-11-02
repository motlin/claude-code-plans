// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import type {SessionListItem} from "../src/lib/api/sessions";
import {
	holdAnswered,
	isAnsweredHeld,
	noteAnsweredPending,
	noteAnsweredSummary,
	releaseAnswered,
	useAnsweredSessionIds,
	withAnsweredHold,
} from "../src/lib/answered-sessions";

function item(overrides: Partial<SessionListItem>): SessionListItem {
	return {
		id: "s",
		title: "Answered",
		mtime: "2026-11-02T00:00:00.000Z",
		created: "2026-11-02T00:00:00.000Z",
		project: "-projects-a",
		projectName: "a",
		messageCount: 1,
		archived: false,
		state: "waiting",
		bucket: "blocked",
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
		...overrides,
	};
}

describe("answered sessions, a session-level hold armed when this tab answers", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		releaseAnswered("s-hold");
		vi.useRealTimers();
	});

	it("holds a session for upstream's 5000ms cap", () => {
		holdAnswered("s-hold", "toolu_1");
		const held = isAnsweredHeld("s-hold");
		vi.advanceTimersByTime(4999);
		const before = isAnsweredHeld("s-hold");
		vi.advanceTimersByTime(1);

		expect({held, before, after: isAnsweredHeld("s-hold")}).toStrictEqual({held: true, before: true, after: false});
	});

	it("restarts the cap when re-armed", () => {
		holdAnswered("s-hold", "toolu_1");
		vi.advanceTimersByTime(3000);
		holdAnswered("s-hold", "toolu_1");
		vi.advanceTimersByTime(4999);
		const before = isAnsweredHeld("s-hold");
		vi.advanceTimersByTime(1);

		expect({before, after: isAnsweredHeld("s-hold")}).toStrictEqual({before: true, after: false});
	});

	it("keeps the hold through a stale waiting summary, and releases on a waiting one after the server confirmed work", () => {
		holdAnswered("s-hold", "toolu_1");
		noteAnsweredSummary("s-hold", "waiting");
		const stale = isAnsweredHeld("s-hold");
		noteAnsweredSummary("s-hold", "working");
		const confirmed = isAnsweredHeld("s-hold");
		noteAnsweredSummary("s-hold", "waiting");

		expect({stale, confirmed, rewaited: isAnsweredHeld("s-hold")}).toStrictEqual({
			stale: true,
			confirmed: true,
			rewaited: false,
		});
	});

	it("releases when a different tool call is pending, and keeps it for the answered one", () => {
		holdAnswered("s-hold", "toolu_1");
		noteAnsweredPending("s-hold", "toolu_1");
		const same = isAnsweredHeld("s-hold");
		noteAnsweredPending("s-hold", "toolu_2");

		expect({same, other: isAnsweredHeld("s-hold")}).toStrictEqual({same: true, other: false});
	});

	it("draws a held waiting session as working, without its permission wait", () => {
		const session = item({awaitingPermission: true});

		expect(withAnsweredHold(session, true)).toStrictEqual(item({state: "working", bucket: "working"}));
	});

	it("returns the same session when not held, not waiting, or blocked on an unseen error", () => {
		const waiting = item({});
		const working = item({state: "working", bucket: "working"});
		const errored = item({unseenError: true});

		expect({
			notHeld: withAnsweredHold(waiting, false) === waiting,
			working: withAnsweredHold(working, true) === working,
			errored: withAnsweredHold(errored, true) === errored,
		}).toStrictEqual({notHeld: true, working: true, errored: true});
	});

	it("re-renders subscribers on hold and release, sharing one empty set while nothing is held", () => {
		const {result} = renderHook(() => useAnsweredSessionIds());
		const empty = result.current;
		act(() => {
			holdAnswered("s-hold", "toolu_1");
		});
		const held = [...result.current];
		act(() => {
			releaseAnswered("s-hold");
		});

		expect({held, released: [...result.current], sameEmpty: result.current === empty}).toStrictEqual({
			held: ["s-hold"],
			released: [],
			sameEmpty: true,
		});
	});
});
