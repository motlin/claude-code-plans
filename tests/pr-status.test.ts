import {describe, expect, it, vi} from "vite-plus/test";

import type {ActiveSessionEntry} from "../src/lib/active-session-store";
import {
	ghPrLookup,
	parseGhPrList,
	parseGhPrStatusCache,
	parseGhPrView,
	prGlyph,
	resolvePrStatus,
	type PrStatus,
} from "../src/lib/pr-status";
import {createPrStatusService, type GhRunner} from "../src/lib/pr-status-service";
import {sessionRowIconKind} from "../src/lib/session-state";
import {toSessionSummaryPayload} from "../src/lib/session-summary";
import type {SessionEntry} from "../src/lib/sessions";

const NOW = 946_598_400_000;
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const PR_LINK = {
	number: 42,
	url: "https://github.com/alice/widgets/pull/42",
	repository: "alice/widgets",
};

describe("parseGhPrList", () => {
	it("maps `gh pr list --json number,state,isDraft` rows to a PR status", () => {
		expect(
			[
				'[{"number":6,"state":"OPEN","isDraft":true}]',
				'[{"number":7,"state":"OPEN","isDraft":false}]',
				'[{"number":8,"state":"MERGED","isDraft":false}]',
				'[{"number":9,"state":"CLOSED","isDraft":false}]',
				"[]",
			].map(parseGhPrList),
		).toStrictEqual([
			{number: 6, state: "draft"},
			{number: 7, state: "open"},
			{number: 8, state: "merged"},
			{number: 9, state: "closed"},
			null,
		]);
	});

	it("prefers an open PR over newer closed ones on the same branch", () => {
		expect(
			parseGhPrList(
				'[{"number":12,"state":"CLOSED","isDraft":false},{"number":11,"state":"OPEN","isDraft":false}]',
			),
		).toStrictEqual({number: 11, state: "open"});
	});

	it("rejects output that does not match the strict schema", () => {
		expect(() => parseGhPrList('[{"number":6,"state":"OPEN"}]')).toThrow();
		expect(() => parseGhPrList('[{"number":6,"state":"OPEN","isDraft":false,"x":1}]')).toThrow();
		expect(() => parseGhPrList("not json")).toThrow();
	});
});

describe("parseGhPrView", () => {
	it("maps `gh pr view --json number,state,isDraft` to a PR status", () => {
		expect(parseGhPrView('{"number":42,"state":"OPEN","isDraft":true}')).toStrictEqual({
			number: 42,
			state: "draft",
		});
	});
});

describe("parseGhPrStatusCache", () => {
	it("reads ~/.claude/gh-pr-status-cache.json entries keyed by PR url", () => {
		const text = JSON.stringify({
			[PR_LINK.url]: {
				number: 42,
				title: "Add widgets",
				state: "DRAFT",
				checks: {passed: 1, failed: 0, pending: 0},
				review: null,
				additions: 3,
				deletions: 1,
			},
			"https://github.com/alice/widgets/pull/41": {
				number: 41,
				title: "Old",
				state: "MERGED",
				checks: {passed: 0, failed: 0, pending: 0},
				review: "APPROVED",
				additions: 0,
				deletions: 0,
			},
			"https://github.com/alice/widgets/pull/40": {number: 40, state: "BOGUS"},
		});
		expect([...parseGhPrStatusCache(text)]).toStrictEqual([
			[
				PR_LINK.url,
				{
					number: 42,
					state: "draft",
					url: PR_LINK.url,
					title: "Add widgets",
					checks: {passed: 1, failed: 0, pending: 0},
					review: null,
				},
			],
			[
				"https://github.com/alice/widgets/pull/41",
				{
					number: 41,
					state: "merged",
					url: "https://github.com/alice/widgets/pull/41",
					title: "Old",
					checks: {passed: 0, failed: 0, pending: 0},
					review: "APPROVED",
				},
			],
		]);
	});

	it("treats unparseable JSON as an empty cache", () => {
		expect(parseGhPrStatusCache("{")).toStrictEqual(new Map());
	});
});

describe("resolvePrStatus", () => {
	const cacheFile = new Map<string, PrStatus>([
		[
			PR_LINK.url,
			{
				number: 41,
				state: "open",
				url: PR_LINK.url,
				title: "Add widgets",
				checks: {passed: 2, failed: 0, pending: 1},
				review: "APPROVED",
			},
		],
	]);

	it("uses the pr-link number and url with the cache file state and details first", () => {
		expect(resolvePrStatus({prLink: PR_LINK, cacheFile, gh: {number: 42, state: "merged"}})).toStrictEqual({
			number: 42,
			state: "open",
			url: PR_LINK.url,
			title: "Add widgets",
			checks: {passed: 2, failed: 0, pending: 1},
			review: "APPROVED",
		});
	});

	it("falls back to gh when the cache file has no entry for the pr-link", () => {
		expect(resolvePrStatus({prLink: PR_LINK, cacheFile: new Map(), gh: {number: 42, state: "open"}})).toStrictEqual(
			{number: 42, state: "open", url: PR_LINK.url},
		);
	});

	it("keeps the pr-link number over a gh branch lookup", () => {
		expect(resolvePrStatus({prLink: PR_LINK, cacheFile: new Map(), gh: {number: 7, state: "draft"}})).toStrictEqual(
			{number: 42, state: "draft", url: PR_LINK.url},
		);
	});

	it("uses gh alone without a pr-link, and nothing without any source", () => {
		expect([
			resolvePrStatus({prLink: undefined, cacheFile, gh: {number: 7, state: "open"}}),
			resolvePrStatus({prLink: undefined, cacheFile, gh: null}),
			resolvePrStatus({prLink: PR_LINK, cacheFile: new Map(), gh: null}),
		]).toStrictEqual([{number: 7, state: "open"}, null, null]);
	});
});

describe("ghPrLookup", () => {
	it("builds argv: pr view for a pr-link, pr list --head for a feature branch", () => {
		expect([
			ghPrLookup({prLink: PR_LINK, cwd: "/repo", branch: "feature"}),
			ghPrLookup({prLink: undefined, cwd: "/repo", branch: "feature/x"}),
			ghPrLookup({prLink: undefined, cwd: "/repo", branch: "main"}),
			ghPrLookup({prLink: undefined, cwd: undefined, branch: "feature"}),
			ghPrLookup({prLink: undefined, cwd: "/repo", branch: undefined}),
		]).toStrictEqual([
			{
				key: `url:${PR_LINK.url}`,
				args: ["pr", "view", PR_LINK.url, "--json", "number,state,isDraft"],
				cwd: undefined,
				kind: "view",
			},
			{
				key: "branch:/repo\u0000feature/x",
				args: [
					"pr",
					"list",
					"--head",
					"feature/x",
					"--state",
					"all",
					"--limit",
					"10",
					"--json",
					"number,state,isDraft",
				],
				cwd: "/repo",
				kind: "list",
			},
			null,
			null,
			null,
		]);
	});
});

describe("createPrStatusService", () => {
	function setup(runGh: GhRunner, cacheText: string | null = null) {
		let now = NOW;
		const onChange = vi.fn<(projectId: string) => void>();
		const service = createPrStatusService({
			runGh,
			readCacheFile: () => Promise.resolve(cacheText),
			now: () => now,
			onChange,
		});
		return {
			service,
			onChange,
			advance: (ms: number) => {
				now += ms;
			},
		};
	}

	const target = {
		projectId: "-repo",
		prLink: undefined,
		cwd: "/repo",
		branch: "feature",
		mtimeMs: NOW - MINUTE,
	};

	it("answers from memory without blocking, then refreshes via gh in the background", async () => {
		const runGh = vi.fn<GhRunner>(() => Promise.resolve('[{"number":6,"state":"OPEN","isDraft":true}]'));
		const {service, onChange} = setup(runGh);

		expect(service.lookup(target)).toBeNull();
		await service.idle();

		expect({
			status: service.lookup(target),
			calls: runGh.mock.calls,
			changed: onChange.mock.calls,
		}).toStrictEqual({
			status: {number: 6, state: "draft"},
			calls: [
				[
					[
						"pr",
						"list",
						"--head",
						"feature",
						"--state",
						"all",
						"--limit",
						"10",
						"--json",
						"number,state,isDraft",
					],
					"/repo",
				],
			],
			changed: [["-repo"]],
		});
	});

	it("caches gh results until the TTL and backs off after failures", async () => {
		const runGh = vi.fn<GhRunner>(() => Promise.reject(new Error("rate limited")));
		const {service, advance} = setup(runGh);

		service.lookup(target);
		await service.idle();
		service.lookup(target);
		await service.idle();
		advance(30 * 1000);
		service.lookup(target);
		await service.idle();
		expect(runGh).toHaveBeenCalledTimes(1);

		advance(2 * MINUTE);
		service.lookup(target);
		await service.idle();
		expect(runGh).toHaveBeenCalledTimes(2);
	});

	it("prefers the cache file for pr-link sessions and never runs gh for them", async () => {
		const runGh = vi.fn<GhRunner>(() => Promise.resolve("{}"));
		const cacheText = JSON.stringify({
			[PR_LINK.url]: {
				number: 42,
				title: "Add widgets",
				state: "OPEN",
				checks: {passed: 0, failed: 0, pending: 0},
				review: null,
				additions: 0,
				deletions: 0,
			},
		});
		const {service} = setup(runGh, cacheText);
		const linked = {...target, prLink: PR_LINK};

		service.lookup(linked);
		await service.idle();

		expect({status: service.lookup(linked), calls: runGh.mock.calls.length}).toStrictEqual({
			status: {
				number: 42,
				state: "open",
				url: PR_LINK.url,
				title: "Add widgets",
				checks: {passed: 0, failed: 0, pending: 0},
				review: null,
			},
			calls: 0,
		});
	});

	it("reports a change when only a cached PR's checks or review change", async () => {
		const entry = (failed: number) =>
			JSON.stringify({
				[PR_LINK.url]: {
					number: 42,
					title: "Add widgets",
					state: "OPEN",
					checks: {passed: 1, failed, pending: 0},
					review: null,
					additions: 0,
					deletions: 0,
				},
			});
		let cacheText = entry(0);
		let now = NOW;
		const onChange = vi.fn<(projectId: string) => void>();
		const service = createPrStatusService({
			runGh: () => Promise.resolve("{}"),
			readCacheFile: () => Promise.resolve(cacheText),
			now: () => now,
			onChange,
		});
		const linked = {...target, prLink: PR_LINK};

		service.lookup(linked);
		await service.idle();
		onChange.mockClear();
		cacheText = entry(1);
		now += 2 * MINUTE;
		service.lookup(linked);
		await service.idle();

		expect({
			checks: service.lookup(linked)?.checks,
			changed: onChange.mock.calls,
		}).toStrictEqual({
			checks: {passed: 1, failed: 1, pending: 0},
			changed: [["-repo"]],
		});
	});

	it("skips gh for sessions idle longer than the lookup window", async () => {
		const runGh = vi.fn<GhRunner>(() => Promise.resolve("[]"));
		const {service} = setup(runGh);

		service.lookup({...target, mtimeMs: NOW - 30 * DAY});
		await service.idle();

		expect(runGh).not.toHaveBeenCalled();
	});
});

describe("PR state in the session summary", () => {
	const entry: SessionEntry = {
		id: "session-pr",
		title: "Add widgets",
		mtime: new Date(NOW - MINUTE),
		created: new Date(NOW - DAY),
		project: "-repo",
		projectName: "repo",
		messageCount: 3,
		gitBranch: "feature",
		isSidechain: false,
	};
	const idleSession: ActiveSessionEntry = {
		sessionId: "session-pr",
		state: "idle",
		cwd: "/repo",
		model: "claude-sonnet-4-6",
		startedAt: NOW - DAY,
		lastActivity: NOW - MINUTE,
		claudeEnv: {},
		tmuxPane: "",
		tmuxServerSocket: "",
		herdrPane: "",
		herdrWorkspace: "",
		herdrSocketPath: "",
		lastSubagentActivityAt: null,
		backgroundTasks: [],
	};

	it("puts an idle session with an open or draft PR in Ready for review", () => {
		const summarize = (prStatus: PrStatus | null) => {
			const payload = toSessionSummaryPayload(entry, {
				activeSession: idleSession,
				now: NOW,
				prStatus,
			});
			return {bucket: payload.bucket, prStatus: payload.prStatus};
		};
		expect([
			summarize({number: 6, state: "draft"}),
			summarize({number: 7, state: "open"}),
			summarize({number: 8, state: "merged"}),
			summarize(null),
		]).toStrictEqual([
			{bucket: "review", prStatus: {number: 6, state: "draft"}},
			{bucket: "review", prStatus: {number: 7, state: "open"}},
			{bucket: "done", prStatus: {number: 8, state: "merged"}},
			{bucket: "done", prStatus: undefined},
		]);
	});
});

describe("PR row glyph", () => {
	it("maps each PR state to its upstream git colour state", () => {
		expect(
			(
				[
					{number: 6, state: "draft"},
					{number: 7, state: "open"},
					{number: 8, state: "merged"},
					{number: 9, state: "closed"},
				] as const
			).map(prGlyph),
		).toStrictEqual([
			{number: 6, state: "draft"},
			{number: 7, state: "opened"},
			{number: 8, state: "merged"},
			{number: 9, state: "closed"},
		]);
	});

	it("shows the PR glyph on finished rows only while Show PR status is on", () => {
		const draft = {number: 6, state: "draft"} as const;
		const merged = {number: 8, state: "merged"} as const;
		const kind = (
			bucket: "blocked" | "review" | "working" | "done",
			unseen: boolean,
			prStatus: PrStatus | undefined,
			showPrStatus = true,
		) => sessionRowIconKind({bucket, unseen, serverUnseen: false, prStatus, showPrStatus});
		expect([
			kind("blocked", false, draft),
			kind("working", false, draft),
			kind("review", false, draft),
			kind("review", true, draft),
			kind("done", true, merged),
			kind("done", false, undefined),
			kind("review", false, draft, false),
			kind("done", true, undefined),
		]).toStrictEqual(["awaiting", "running", "pr", "ready", "pr", "idle", "ready", "ready"]);
	});
});
