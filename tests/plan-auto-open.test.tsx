// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {PaneHostContext, type PaneHostApi} from "../src/components/panes/pane-host-context";
import {PlanAutoOpen} from "../src/components/plan-auto-open";
import {defaultPaneLayout} from "../src/lib/pane-layout";
import {
	INITIAL_PLAN_AUTO_OPEN_TRACK,
	PLAN_AUTO_OPENED_STORAGE_KEY,
	type PlanAutoOpenSnapshot,
	planAutoOpenStep,
	shouldAutoOpenPlan,
} from "../src/lib/plan-auto-open";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

beforeEach(() => {
	localStorage.clear();
});

const seeded = {firstRecordUuid: "u1", liveCount: 5, hasTodos: false, seeded: true} satisfies PlanAutoOpenSnapshot;

describe("shouldAutoOpenPlan", () => {
	it.each<[string, PlanAutoOpenSnapshot, PlanAutoOpenSnapshot, boolean]>([
		["initial load with todos", INITIAL_PLAN_AUTO_OPEN_TRACK, {...seeded, hasTodos: true}, false],
		["live TodoWrite arrival", seeded, {...seeded, liveCount: 6, hasTodos: true}, true],
		["todos already there", {...seeded, hasTodos: true}, {...seeded, liveCount: 6, hasTodos: true}, false],
		[
			"first record changed (session switch)",
			seeded,
			{...seeded, firstRecordUuid: "u2", liveCount: 6, hasTodos: true},
			false,
		],
		["live count did not grow", seeded, {...seeded, hasTodos: true}, false],
		["not seeded", {...seeded, seeded: false}, {...seeded, seeded: false, liveCount: 6, hasTodos: true}, false],
		[
			"empty transcript before",
			{...seeded, firstRecordUuid: undefined},
			{...seeded, liveCount: 6, hasTodos: true},
			false,
		],
	])("%s", (_name, prev, next, expected) => {
		expect(shouldAutoOpenPlan(prev, next)).toBe(expected);
	});
});

describe("planAutoOpenStep", () => {
	it("tracks upstream's sticky seeded and hadTodos flags", () => {
		expect(planAutoOpenStep(seeded, {...seeded, liveCount: 6, hasTodos: true, seeded: false})).toStrictEqual({
			open: true,
			track: {firstRecordUuid: "u1", liveCount: 6, hasTodos: true, seeded: true},
		});
		expect(planAutoOpenStep({...seeded, hasTodos: true}, {...seeded, liveCount: 7, hasTodos: false})).toStrictEqual(
			{
				open: false,
				track: {firstRecordUuid: "u1", liveCount: 7, hasTodos: true, seeded: true},
			},
		);
	});
});

describe("PlanAutoOpen", () => {
	function paneHost(openPane: PaneHostApi["openPane"], planOpen = false): PaneHostApi {
		return {
			layout: defaultPaneLayout(),
			openKinds: planOpen ? ["plan"] : [],
			isOpen: (kind) => planOpen && kind === "plan",
			openPane,
			closePane: () => {},
			togglePane: () => {},
		};
	}

	function view(host: PaneHostApi, props: {sessionId: string; first: string; live: number; todos: boolean}) {
		return (
			<PaneHostContext.Provider value={host}>
				<PlanAutoOpen
					sessionId={props.sessionId}
					firstRecordUuid={props.first}
					liveCount={props.live}
					hasTodos={props.todos}
				/>
			</PaneHostContext.Provider>
		);
	}

	function stored(): unknown {
		const raw = localStorage.getItem(PLAN_AUTO_OPENED_STORAGE_KEY);
		return raw === null ? null : JSON.parse(raw);
	}

	it("opens once on the first live todos, persists it, and not again on a second arrival", () => {
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const host = paneHost(openPane);
		const r = render(view(host, {sessionId: "s1", first: "u1", live: 5, todos: false}));
		r.rerender(view(host, {sessionId: "s1", first: "u1", live: 6, todos: true}));
		const afterFirst = [...openPane.mock.calls];
		r.rerender(view(host, {sessionId: "s1", first: "u1", live: 7, todos: false}));
		r.rerender(view(host, {sessionId: "s1", first: "u1", live: 8, todos: true}));
		expect({afterFirst, calls: openPane.mock.calls, stored: stored()}).toStrictEqual({
			afterFirst: [["plan"]],
			calls: [["plan"]],
			stored: {s1: true},
		});
	});

	it("does not open for a session loaded with todos already present", () => {
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const host = paneHost(openPane);
		const r = render(view(host, {sessionId: "s1", first: "u1", live: 5, todos: true}));
		r.rerender(view(host, {sessionId: "s1", first: "u1", live: 6, todos: true}));
		expect({calls: openPane.mock.calls, stored: stored()}).toStrictEqual({calls: [], stored: null});
	});

	it("skips a session it already opened in an earlier visit", () => {
		localStorage.setItem(PLAN_AUTO_OPENED_STORAGE_KEY, JSON.stringify({s1: true}));
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const host = paneHost(openPane);
		const r = render(view(host, {sessionId: "s1", first: "u1", live: 5, todos: false}));
		r.rerender(view(host, {sessionId: "s1", first: "u1", live: 6, todos: true}));
		expect(openPane.mock.calls).toStrictEqual([]);
	});

	it("marks the session without opening when the Plan pane is already open", () => {
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const host = paneHost(openPane, true);
		render(view(host, {sessionId: "s1", first: "u1", live: 5, todos: false}));
		expect({calls: openPane.mock.calls, stored: stored()}).toStrictEqual({calls: [], stored: {s1: true}});
	});

	it("starts over when the session changes", () => {
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const host = paneHost(openPane);
		const r = render(view(host, {sessionId: "s1", first: "u1", live: 5, todos: false}));
		r.rerender(view(host, {sessionId: "s2", first: "v1", live: 9, todos: true}));
		expect(openPane.mock.calls).toStrictEqual([]);
	});
});
