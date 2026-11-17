import {describe, expect, it, vi} from "vite-plus/test";

import type {ActiveSessionEntry} from "../src/lib/active-session-store";
import {ghPrDetailsLookup, parseGhPrDetails} from "../src/lib/pr-details";
import
{
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

const PR_LINK =
{
	number: 42,
	url: "https://github.com/alice/widgets/pull/42",
	repository: "alice/widgets",
};

describe("parseGhPrList", () =>
{
	it("maps `gh pr list --json number,state,isDraft,additions,deletions` rows to a PR status", () =>
	{
		expect(
			[
				'[{"number":6,"state":"OPEN","isDraft":true,"additions":12345,"deletions":678}]',
				'[{"number":7,"state":"OPEN","isDraft":false,"additions":10,"deletions":2}]',
				'[{"number":8,"state":"MERGED","isDraft":false,"additions":0,"deletions":0}]',
				'[{"number":9,"state":"CLOSED","isDraft":false,"additions":1,"deletions":1}]',
				"[]",
			].map(parseGhPrList),
		).toStrictEqual([
			{
				number: 6,
				state: "draft",
				additions: 12345,
				deletions: 678,
			},
			{
				number: 7,
				state: "open",
				additions: 10,
				deletions: 2,
			},
			{
				number: 8,
				state: "merged",
				additions: 0,
				deletions: 0,
			},
			{
				number: 9,
				state: "closed",
				additions: 1,
				deletions: 1,
			},
			null,
		]);
	});

	it("prefers an open PR over newer closed ones on the same branch", () =>
	{
		expect(
			parseGhPrList(
				'[{"number":12,"state":"CLOSED","isDraft":false,"additions":1,"deletions":0},{"number":11,"state":"OPEN","isDraft":false,"additions":4,"deletions":5}]',
			),
		).toStrictEqual(
			{
				number: 11,
				state: "open",
				additions: 4,
				deletions: 5,
			},
		);
	});

	it("rejects output that does not match the strict schema", () =>
	{
		expect(() => parseGhPrList('[{"number":6,"state":"OPEN"}]')).toThrow(
			"Invalid input: expected boolean, received undefined",
		);
		expect(() => parseGhPrList('[{"number":6,"state":"OPEN","isDraft":false}]')).toThrow(
			"Invalid input: expected number, received undefined",
		);
		expect(() =>
			parseGhPrList('[{"number":6,"state":"OPEN","isDraft":false,"additions":1,"deletions":1,"x":1}]'),
		).toThrow(/Unrecognized key: \\"x\\"/);
		expect(() => parseGhPrList("not json")).toThrow("is not valid JSON");
	});
});

describe("parseGhPrView", () =>
{
	it("maps `gh pr view --json number,state,isDraft,additions,deletions` to a PR status", () =>
	{
		expect(parseGhPrView('{"number":42,"state":"OPEN","isDraft":true,"additions":5,"deletions":1}')).toStrictEqual(
			{
				number: 42,
				state: "draft",
				additions: 5,
				deletions: 1,
			},
		);
	});
});

describe("parseGhPrStatusCache", () =>
{
	it("reads ~/.claude/gh-pr-status-cache.json entries keyed by PR url", () =>
	{
		const text = JSON.stringify(
			{
				[PR_LINK.url]:
				{
					number: 42,
					title: "Add widgets",
					state: "DRAFT",
					checks:
					{
						passed: 1,
						failed: 0,
						pending: 0,
					},
					review: null,
					additions: 3,
					deletions: 1,
				},
				"https://github.com/alice/widgets/pull/41":
				{
					number: 41,
					title: "Old",
					state: "MERGED",
					checks:
					{
						passed: 0,
						failed: 0,
						pending: 0,
					},
					review: "APPROVED",
					additions: 0,
					deletions: 0,
				},
				"https://github.com/alice/widgets/pull/40":
				{
					number: 40,
					state: "BOGUS",
				},
			},
		);
		expect([...parseGhPrStatusCache(text)]).toStrictEqual([
			[
				PR_LINK.url,
				{
					number: 42,
					state: "draft",
					url: PR_LINK.url,
					title: "Add widgets",
					checks:
					{
						passed: 1,
						failed: 0,
						pending: 0,
					},
					review: null,
					additions: 3,
					deletions: 1,
				},
			],
			[
				"https://github.com/alice/widgets/pull/41",
				{
					number: 41,
					state: "merged",
					url: "https://github.com/alice/widgets/pull/41",
					title: "Old",
					checks:
					{
						passed: 0,
						failed: 0,
						pending: 0,
					},
					review: "APPROVED",
					additions: 0,
					deletions: 0,
				},
			],
		]);
	});

	it("treats unparseable JSON as an empty cache", () =>
	{
		expect(parseGhPrStatusCache("{")).toStrictEqual(new Map());
	});
});

describe("parseGhPrDetails", () =>
{
	it("reads the head branch, diff stat, failing check names and unresolved review threads from the graphql reply", () =>
	{
		const reply =
		{
			data:
			{
				repository:
				{
					pullRequest:
					{
						headRefName: "feature",
						additions: 12,
						deletions: 3,
						reviewThreads:
						{
							nodes: [
								{
									isResolved: false,
								},
								{
									isResolved: true,
								},
								{
									isResolved: false,
								},
							],
						},
						commits:
						{
							nodes: [
								{
									commit:
									{
										statusCheckRollup:
										{
											contexts:
											{
												nodes: [
													{
														__typename: "CheckRun",
														name: "lint",
														conclusion: "SUCCESS",
													},
													{
														__typename: "CheckRun",
														name: "test",
														conclusion: "FAILURE",
													},
													{
														__typename: "CheckRun",
														name: "build",
														conclusion: null,
													},
													{
														__typename: "CheckRun",
														name: "e2e",
														conclusion: "TIMED_OUT",
													},
													{
														__typename: "StatusContext",
														context: "ci/legacy",
														state: "ERROR",
													},
													{
														__typename: "StatusContext",
														context: "ci/ok",
														state: "SUCCESS",
													},
												],
											},
										},
									},
								},
							],
						},
					},
				},
			},
		};
		expect(parseGhPrDetails(JSON.stringify(reply))).toStrictEqual(
			{
				headBranch: "feature",
				additions: 12,
				deletions: 3,
				failingChecks: ["test", "e2e", "ci/legacy"],
				unresolvedReviewThreads: 2,
			},
		);
	});

	it("treats a commit without a check rollup as no failing checks", () =>
	{
		const reply =
		{
			data:
			{
				repository:
				{
					pullRequest:
					{
						headRefName: "feature",
						additions: 0,
						deletions: 0,
						reviewThreads:
						{
							nodes: [],
						},
						commits:
						{
							nodes: [
								{
									commit:
									{
										statusCheckRollup: null,
									},
								},
							],
						},
					},
				},
			},
		};
		expect(parseGhPrDetails(JSON.stringify(reply))).toStrictEqual(
			{
				headBranch: "feature",
				additions: 0,
				deletions: 0,
				failingChecks: [],
				unresolvedReviewThreads: 0,
			},
		);
	});

	it("rejects a reply that does not match the strict schema", () =>
	{
		expect(() =>
			parseGhPrDetails(
				JSON.stringify(
					{
						data:
						{
							repository: null,
						},
					},
				),
			),
		).toThrow("Invalid input: expected object, received null");
	});
});

describe("ghPrDetailsLookup", () =>
{
	it("builds a gh api graphql argv from a GitHub PR url, and nothing for other urls", () =>
	{
		const lookup = ghPrDetailsLookup(PR_LINK.url);
		expect(
			{
				key: lookup?.key,
				head: lookup?.args.slice(0, 8),
				query: lookup?.args[9]?.startsWith("query=query("),
				other: ghPrDetailsLookup("https://example.com/not-a-pr"),
			},
		).toStrictEqual(
			{
				key: `details:${PR_LINK.url}`,
				head: ["api", "graphql", "-f", "owner=alice", "-f", "repo=widgets", "-F", "number=42"],
				query: true,
				other: null,
			},
		);
	});
});

describe("resolvePrStatus", () =>
{
	const cacheFile = new Map<string, PrStatus>([
		[
			PR_LINK.url,
			{
				number: 41,
				state: "open",
				url: PR_LINK.url,
				title: "Add widgets",
				checks:
				{
					passed: 2,
					failed: 0,
					pending: 1,
				},
				review: "APPROVED",
			},
		],
	]);

	it("uses the pr-link number and url with the cache file state and details first", () =>
	{
		expect(
			resolvePrStatus(
				{
					prLink: PR_LINK,
					cacheFile,
					gh:
					{
						number: 42,
						state: "merged",
					},
				},
			),
		).toStrictEqual(
			{
				number: 42,
				state: "open",
				url: PR_LINK.url,
				title: "Add widgets",
				checks:
				{
					passed: 2,
					failed: 0,
					pending: 1,
				},
				review: "APPROVED",
			},
		);
	});

	it("falls back to gh when the cache file has no entry for the pr-link", () =>
	{
		expect(
			resolvePrStatus(
				{
					prLink: PR_LINK,
					cacheFile: new Map(),
					gh:
					{
						number: 42,
						state: "open",
						additions: 5,
						deletions: 1,
					},
				},
			),
		).toStrictEqual(
			{
				number: 42,
				state: "open",
				url: PR_LINK.url,
				additions: 5,
				deletions: 1,
			},
		);
	});

	it("keeps the pr-link number over a gh branch lookup", () =>
	{
		expect(
			resolvePrStatus(
				{
					prLink: PR_LINK,
					cacheFile: new Map(),
					gh:
					{
						number: 7,
						state: "draft",
					},
				},
			),
		).toStrictEqual(
			{
				number: 42,
				state: "draft",
				url: PR_LINK.url,
			},
		);
	});

	it("uses gh alone without a pr-link, and nothing without any source", () =>
	{
		expect([
			resolvePrStatus(
				{
					prLink: undefined,
					cacheFile,
					gh:
					{
						number: 7,
						state: "open",
					},
				},
			),
			resolvePrStatus(
				{
					prLink: undefined,
					cacheFile,
					gh: null,
				},
			),
			resolvePrStatus(
				{
					prLink: PR_LINK,
					cacheFile: new Map(),
					gh: null,
				},
			),
		]).toStrictEqual([
			{
				number: 7,
				state: "open",
			},
			null,
			null,
		]);
	});
});

describe("ghPrLookup", () =>
{
	it("builds argv: pr view for a pr-link, pr list --head for a feature branch", () =>
	{
		expect([
			ghPrLookup(
				{
					prLink: PR_LINK,
					cwd: "/repo",
					branch: "feature",
				},
			),
			ghPrLookup(
				{
					prLink: undefined,
					cwd: "/repo",
					branch: "feature/x",
				},
			),
			ghPrLookup(
				{
					prLink: undefined,
					cwd: "/repo",
					branch: "main",
				},
			),
			ghPrLookup(
				{
					prLink: undefined,
					cwd: undefined,
					branch: "feature",
				},
			),
			ghPrLookup(
				{
					prLink: undefined,
					cwd: "/repo",
					branch: undefined,
				},
			),
		]).toStrictEqual([
			{
				key: `url:${PR_LINK.url}`,
				args: ["pr", "view", PR_LINK.url, "--json", "number,state,isDraft,additions,deletions"],
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
					"number,state,isDraft,additions,deletions",
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

describe("createPrStatusService", () =>
{
	function setup(runGh: GhRunner, cacheText: string | null = null)
	{
		let now = NOW;
		const onChange = vi.fn<(projectId: string) => void>();
		const service = createPrStatusService(
			{
				runGh,
				readCacheFile: async () => Promise.resolve(cacheText),
				now: () => now,
				onChange,
			},
		);
		return {
			service,
			onChange,
			advance: (ms: number) =>
			{
				now += ms;
			},
		};
	}

	const target =
	{
		projectId: "-repo",
		prLink: undefined,
		cwd: "/repo",
		branch: "feature",
		mtimeMs: NOW - MINUTE,
	};

	it("answers from memory without blocking, then refreshes via gh in the background", async () =>
	{
		const runGh = vi.fn<GhRunner>(async () =>
			Promise.resolve('[{"number":6,"state":"OPEN","isDraft":true,"additions":2,"deletions":1}]'),
		);
		const {service, onChange} = setup(runGh);

		expect(service.lookup(target)).toBeNull();
		await service.idle();

		expect(
			{
				status: service.lookup(target),
				calls: runGh.mock.calls,
				changed: onChange.mock.calls,
			},
		).toStrictEqual(
			{
				status:
				{
					number: 6,
					state: "draft",
					additions: 2,
					deletions: 1,
				},
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
							"number,state,isDraft,additions,deletions",
						],
						"/repo",
					],
				],
				changed: [["-repo"]],
			},
		);
	});

	it("caches gh results until the TTL and backs off after failures", async () =>
	{
		const runGh = vi.fn<GhRunner>(async () => Promise.reject(new Error("rate limited")));
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

	it("prefers the cache file for pr-link sessions and asks gh only for review details", async () =>
	{
		const runGh = vi.fn<GhRunner>(async () =>
			Promise.resolve(
				JSON.stringify(
					{
						data:
						{
							repository:
							{
								pullRequest:
								{
									headRefName: "widgets",
									additions: 12,
									deletions: 3,
									reviewThreads:
									{
										nodes: [
											{
												isResolved: false,
											},
											{
												isResolved: false,
											},
										],
									},
									commits:
									{
										nodes: [
											{
												commit:
												{
													statusCheckRollup:
													{
														contexts:
														{
															nodes: [
																{
																	__typename: "CheckRun",
																	name: "test",
																	conclusion: "FAILURE",
																},
															],
														},
													},
												},
											},
										],
									},
								},
							},
						},
					},
				),
			),
		);
		const cacheText = JSON.stringify(
			{
				[PR_LINK.url]:
				{
					number: 42,
					title: "Add widgets",
					state: "OPEN",
					checks:
					{
						passed: 0,
						failed: 0,
						pending: 0,
					},
					review: null,
					additions: 0,
					deletions: 0,
				},
			},
		);
		const {service} = setup(runGh, cacheText);
		const linked =
		{
			...target,
			prLink: PR_LINK,
		};

		service.lookup(linked);
		await service.idle();
		service.lookup(linked);
		await service.idle();

		expect(
			{
				status: service.lookup(linked),
				calls: runGh.mock.calls.map(([args]) => args.slice(0, 2)),
			},
		).toStrictEqual(
			{
				status:
				{
					number: 42,
					state: "open",
					url: PR_LINK.url,
					title: "Add widgets",
					checks:
					{
						passed: 0,
						failed: 0,
						pending: 0,
					},
					review: null,
					additions: 12,
					deletions: 3,
					headBranch: "widgets",
					failingChecks: ["test"],
					unresolvedReviewThreads: 2,
				},
				calls: [["api", "graphql"]],
			},
		);
	});

	it("reports a change when only a cached PR's checks, review or diff stat change", async () =>
	{
		const entry = (failed: number, deletions = 0) =>
			JSON.stringify(
				{
					[PR_LINK.url]:
					{
						number: 42,
						title: "Add widgets",
						state: "OPEN",
						checks:
						{
							passed: 1,
							failed,
							pending: 0,
						},
						review: null,
						additions: 0,
						deletions,
					},
				},
			);
		let cacheText = entry(0);
		let now = NOW;
		const onChange = vi.fn<(projectId: string) => void>();
		const service = createPrStatusService(
			{
				runGh: async () => Promise.resolve("{}"),
				readCacheFile: async () => Promise.resolve(cacheText),
				now: () => now,
				onChange,
			},
		);
		const linked =
		{
			...target,
			prLink: PR_LINK,
		};

		service.lookup(linked);
		await service.idle();
		onChange.mockClear();
		cacheText = entry(1);
		now += 2 * MINUTE;
		service.lookup(linked);
		await service.idle();
		const checks = service.lookup(linked)?.checks;
		const checksChanged = [...onChange.mock.calls];
		onChange.mockClear();
		cacheText = entry(1, 4);
		now += 2 * MINUTE;
		service.lookup(linked);
		await service.idle();

		expect(
			{
				checks,
				checksChanged,
				deletions: service.lookup(linked)?.deletions,
				deletionsChanged: onChange.mock.calls,
			},
		).toStrictEqual(
			{
				checks:
				{
					passed: 1,
					failed: 1,
					pending: 0,
				},
				checksChanged: [["-repo"]],
				deletions: 4,
				deletionsChanged: [["-repo"]],
			},
		);
	});

	it("skips gh for sessions idle longer than the lookup window", async () =>
	{
		const runGh = vi.fn<GhRunner>(async () => Promise.resolve("[]"));
		const {service} = setup(runGh);

		service.lookup(
			{
				...target,
				mtimeMs: NOW - 30 * DAY,
			},
		);
		await service.idle();

		expect(runGh).not.toHaveBeenCalled();
	});
});

describe("PR state in the session summary", () =>
{
	const entry: SessionEntry =
	{
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
	const idleSession: ActiveSessionEntry =
	{
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

	it("puts an idle session with an open or draft PR in Ready for review", () =>
	{
		const summarize = (prStatus: PrStatus | null) =>
		{
			const payload = toSessionSummaryPayload(
				entry,
				{
					activeSession: idleSession,
					now: NOW,
					prStatus,
				},
			);
			return {
				bucket: payload.bucket,
				prStatus: payload.prStatus,
			};
		};
		expect([
			summarize(
				{
					number: 6,
					state: "draft",
				},
			),
			summarize(
				{
					number: 7,
					state: "open",
				},
			),
			summarize(
				{
					number: 8,
					state: "merged",
				},
			),
			summarize(null),
		]).toStrictEqual([
			{
				bucket: "review",
				prStatus:
				{
					number: 6,
					state: "draft",
				},
			},
			{
				bucket: "review",
				prStatus:
				{
					number: 7,
					state: "open",
				},
			},
			{
				bucket: "done",
				prStatus:
				{
					number: 8,
					state: "merged",
				},
			},
			{
				bucket: "done",
				prStatus: undefined,
			},
		]);
	});
});

describe("PR row glyph", () =>
{
	it("maps each PR state to its upstream git colour state", () =>
	{
		expect(
			(
				[
					{
						number: 6,
						state: "draft",
					},
					{
						number: 7,
						state: "open",
					},
					{
						number: 8,
						state: "merged",
					},
					{
						number: 9,
						state: "closed",
					},
				] as const
			).map(prGlyph),
		).toStrictEqual([
			{
				number: 6,
				state: "draft",
			},
			{
				number: 7,
				state: "opened",
			},
			{
				number: 8,
				state: "merged",
			},
			{
				number: 9,
				state: "closed",
			},
		]);
	});

	it("never puts a PR in the status slot: live states, then the unread dot, else the env glyph (upstream jX)", () =>
	{
		const draft =
		{
			number: 6,
			state: "draft",
		} as const;
		const merged =
		{
			number: 8,
			state: "merged",
		} as const;
		const kind = (
			bucket: "blocked" | "review" | "working" | "done",
			unseen: boolean,
			prStatus: PrStatus | undefined,
			showPrStatus = true,
			unseenError = false,
		) =>
			sessionRowIconKind(
				{
					bucket,
					unseen,
					serverUnseen: false,
					unseenError,
					prStatus,
					showPrStatus,
				},
			);
		expect([
			kind("blocked", false, draft),
			kind("working", false, draft),
			kind("review", false, draft),
			kind("review", true, draft),
			kind("done", true, merged),
			kind("done", false, undefined),
			kind("review", false, draft, false),
			kind("done", true, undefined),
			kind("blocked", true, undefined, true, true),
		]).toStrictEqual(["awaiting", "running", "idle", "ready", "ready", "idle", "ready", "ready", "error"]);
	});
});
