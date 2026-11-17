import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import
{
	collectSessionMentions,
	type MentionRosterRow,
	mentionSessionOptions,
	mentionSessionRoster,
	sanitizeMentionTitle,
	userTextHasSessionMention,
} from "../src/lib/mention-sessions";
import
{
	readSessionMentionRecords,
	recordSessionMentions,
	resolveSessionMentions,
} from "../src/lib/session-mention-records";

function row(
	sessionId: string,
	title: string,
	lastActivityAt: number,
	extra: Partial<MentionRosterRow> = {},
): MentionRosterRow
{
	return {
		sessionId,
		title,
		cwd: "/Users/alice/projects/repo",
		gitBranch: "main",
		lastActivityAt,
		archived: false,
		...extra,
	};
}

describe("sanitizeMentionTitle", () =>
{
	it("drops @ [ ] and line breaks, collapses whitespace and trims, after cutting to 120 characters", () =>
	{
		expect([
			sanitizeMentionTitle("  Fix [the] @bug\n now  "),
			sanitizeMentionTitle(`${"a".repeat(119)}[bc`),
			sanitizeMentionTitle("@[]"),
		]).toStrictEqual(["Fix the bug now", "a".repeat(119), ""]);
	});
});

describe("mentionSessionOptions", () =>
{
	it("lists the newest 3 other live titled sessions for an empty query", () =>
	{
		const roster = mentionSessionRoster(
			[
				row("old", "Old work", 1),
				row(
					"gone",
					"Archived",
					5,
					{
						archived: true,
					},
				),
				row("current", "This one", 4),
				row("blank", " @[] ", 3),
				row("new", "Fix bug", 2),
			],
			"current",
		);

		expect(mentionSessionOptions(roster, "")).toStrictEqual([
			{
				id: "new",
				providerId: "ccp-sessions",
				label: "Fix bug",
				description: "repo · main",
				tooltip: "Fix bug",
				renderedText: "[Fix bug]",
				category: "Sessions",
				kind: "session",
			},
			{
				id: "old",
				providerId: "ccp-sessions",
				label: "Old work",
				description: "repo · main",
				tooltip: "Old work",
				renderedText: "[Old work]",
				category: "Sessions",
				kind: "session",
			},
		]);
	});

	it("matches the title, the title without whitespace, or the branch, and caps a query at 8 rows", () =>
	{
		const many = mentionSessionRoster(
			Array.from(
				{
					length: 10,
				},
				(_, i) => row(`s${i}`, `Task ${i}`, i),
			),
			"current",
		);
		const roster = mentionSessionRoster(
			[
				row("bug", "Fix bug", 2),
				row(
					"feature",
					"Other",
					1,
					{
						gitBranch: "feat/x",
						cwd: null,
					},
				),
				row(
					"bare",
					"Bare",
					0,
					{
						gitBranch: null,
						cwd: null,
					},
				),
			],
			"current",
		);

		expect(
			{
				noSpace: mentionSessionOptions(roster, " FixBug ").map((option) => option.id),
				branch: mentionSessionOptions(roster, "feat/x").map((option) => [option.id, option.description]),
				bare: mentionSessionOptions(roster, "bare")[0]?.description,
				capped: mentionSessionOptions(many, "task").length,
				empty: mentionSessionOptions(many, "").length,
			},
		).toStrictEqual(
			{
				noSpace: ["bug"],
				branch: [["feature", "feat/x"]],
				bare: undefined,
				capped: 8,
				empty: 3,
			},
		);
	});
});

describe("collectSessionMentions", () =>
{
	const roster = [
		{
			sessionId: "bug",
			title: "Fix bug",
		},
		{
			sessionId: "a",
			title: "Twin",
		},
		{
			sessionId: "b",
			title: "Twin",
		},
	];

	it("carries a tracked chip still in the text", () =>
	{
		expect(
			collectSessionMentions(
				"see @[Fix bug] now",
				[
					{
						sessionId: "bug",
						title: "Fix bug",
					},
					{
						sessionId: "deleted-from-text",
						title: "Gone",
					},
				],
				roster,
			),
		).toStrictEqual([
			{
				sessionId: "bug",
				title: "Fix bug",
			},
		]);
	});

	it("vouches for a hand-typed @[Title] only when the title names exactly one session", () =>
	{
		expect(
			{
				unique: collectSessionMentions("@[Fix bug]", [], roster),
				ambiguous: collectSessionMentions("@[Twin]", [], roster),
				unknown: collectSessionMentions("@[Nobody]", [], roster),
			},
		).toStrictEqual(
			{
				unique: [
					{
						sessionId: "bug",
						title: "Fix bug",
					},
				],
				ambiguous: [],
				unknown: [],
			},
		);
	});

	it("carries at most 16 mentions", () =>
	{
		const tracked = Array.from(
			{
				length: 20,
			},
			(_, i) => (
			{
				sessionId: `s${i}`,
				title: `T${i}`,
			}),
		);
		const text = tracked.map((ref) => `@[${ref.title}]`).join(" ");

		expect(collectSessionMentions(text, tracked, []).length).toBe(16);
	});
});

describe("session mention records", () =>
{
	let cacheDir: string;

	beforeEach(async () =>
	{
		cacheDir = await mkdtemp(join(tmpdir(), "ccp-mentions-"));
	});

	afterEach(async () =>
	{
		await rm(
			cacheDir,
			{
				recursive: true,
				force: true,
			},
		);
	});

	it("records sent mentions, repointing a resent title, and resolves known ones with their archived state", async () =>
	{
		await recordSessionMentions(cacheDir, "me", [
			{
				sessionId: "old-bug",
				title: "Fix bug",
			},
			{
				sessionId: "shelved",
				title: "Shelved",
			},
			{
				sessionId: "vanished",
				title: "Vanished",
			},
		]);
		await recordSessionMentions(cacheDir, "me", [
			{
				sessionId: "bug",
				title: "Fix bug",
			},
		]);
		const refs = await readSessionMentionRecords(cacheDir, "me");

		expect(
			{
				refs,
				resolved: resolveSessionMentions(refs, new Set(["bug", "shelved"]), new Set(["shelved"])),
				other: await readSessionMentionRecords(cacheDir, "someone-else"),
			},
		).toStrictEqual(
			{
				refs: [
					{
						sessionId: "shelved",
						title: "Shelved",
					},
					{
						sessionId: "vanished",
						title: "Vanished",
					},
					{
						sessionId: "bug",
						title: "Fix bug",
					},
				],
				resolved: [
					{
						sessionId: "shelved",
						title: "Shelved",
						archived: true,
					},
					{
						sessionId: "bug",
						title: "Fix bug",
						archived: false,
					},
				],
				other: [],
			},
		);
	});
});

describe("userTextHasSessionMention", () =>
{
	it("spots an @[ token in a user prompt's text only", () =>
	{
		expect([
			userTextHasSessionMention(
				{
					type: "user",
					message:
					{
						content: "see @[Fix bug]",
					},
				},
			),
			userTextHasSessionMention(
				{
					type: "user",
					message:
					{
						content: [
							{
								type: "text",
								text: "@[x]",
							},
						],
					},
				},
			),
			userTextHasSessionMention(
				{
					type: "assistant",
					message:
					{
						content: "@[x]",
					},
				},
			),
			userTextHasSessionMention(
				{
					type: "user",
					message:
					{
						content: "plain",
					},
				},
			),
		]).toStrictEqual([true, true, false, false]);
	});
});
