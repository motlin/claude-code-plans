import {describe, expect, it} from "vite-plus/test";

import {familyStubLabel, familyStubTally} from "../src/components/sidebar/family-stub-label";
import type {SessionBucket} from "../src/lib/session-state";

function row(
	bucket: SessionBucket,
	flags:
	{
		unseen?: boolean;
		unseenError?: true;
	} = {},
)
{
	return {
		bucket,
		session:
		{
			unseen: flags.unseen ?? false,
			...(flags.unseenError === undefined
				? {}
				:
					{
						unseenError: flags.unseenError,
					}),
		},
	};
}

describe("family stub label", () =>
{
	it("counts each hidden row once: failed, then waiting, then unread, then working", () =>
	{
		expect(
			familyStubTally([
				row(
					"blocked",
					{
						unseen: true,
						unseenError: true,
					},
				),
				row(
					"working",
					{
						unseen: true,
					},
				),
				row(
					"blocked",
					{
						unseen: true,
					},
				),
				row("working"),
				row("done"),
			]),
		).toStrictEqual(
			{
				count: 5,
				waiting: 1,
				failed: 1,
				unread: 1,
				working: 1,
			},
		);
	});

	it("words the count, its segments and the Show aria label", () =>
	{
		expect([
			familyStubLabel(
				{
					count: 1,
					waiting: 0,
					failed: 0,
					unread: 0,
					working: 0,
				},
				false,
			),
			familyStubLabel(
				{
					count: 3,
					waiting: 0,
					failed: 1,
					unread: 2,
					working: 1,
				},
				true,
			),
			familyStubLabel(
				{
					count: 2,
					waiting: 0,
					failed: 0,
					unread: 1,
					working: 0,
				},
				false,
			).ariaLabel,
			familyStubLabel(
				{
					count: 3,
					waiting: 1,
					failed: 1,
					unread: 0,
					working: 0,
				},
				false,
			),
			familyStubLabel(
				{
					count: 2,
					waiting: 2,
					failed: 0,
					unread: 0,
					working: 0,
				},
				false,
			).segments.waiting,
		]).toStrictEqual([
			{
				label: "1 nested",
				sessions: "1 nested session",
				segments:
				{
					waiting: undefined,
					failed: undefined,
					unread: undefined,
					working: undefined,
				},
				ariaLabel: "Show 1 nested session",
			},
			{
				label: "3 more nested",
				sessions: "3 more nested sessions",
				segments:
				{
					waiting: undefined,
					failed: "1 failed",
					unread: "2 unread",
					working: "1 working",
				},
				ariaLabel: "Show 3 more nested sessions, 1 failed, 2 unread, 1 working",
			},
			"Show 2 nested sessions, 1 unread",
			{
				label: "3 nested",
				sessions: "3 nested sessions",
				segments:
				{
					waiting: "1 needs input",
					failed: "1 failed",
					unread: undefined,
					working: undefined,
				},
				ariaLabel: "Show 3 nested sessions, 1 needs input, 1 failed",
			},
			"2 need input",
		]);
	});
});
