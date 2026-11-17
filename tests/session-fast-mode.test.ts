import {describe, expect, it} from "vite-plus/test";

import
{
	type FastModeBlocked,
	fastModeBlockedReason,
	sessionComposerFastMode,
	sessionFastMode,
} from "../src/lib/session-fast-mode";

function assistant(speed: string, extra: Record<string, unknown> = {})
{
	return {
		type: "assistant",
		uuid: `a-${speed}`,
		timestamp: "2026-10-24T10:00:00.000Z",
		message:
		{
			role: "assistant",
			content: [],
			usage:
			{
				input_tokens: 1,
				output_tokens: 1,
				speed,
			},
		},
		...extra,
	};
}

const user =
{
	type: "user",
	uuid: "u1",
	message:
	{
		role: "user",
		content: "hi",
	},
};

describe("sessionFastMode", () =>
{
	it("is on when the last assistant entry ran at fast speed", () =>
	{
		expect(sessionFastMode([assistant("standard"), user, assistant("fast")], {})).toBe(true);
	});

	it("is off when the last assistant entry ran at standard speed, whatever the settings say", () =>
	{
		expect(
			sessionFastMode(
				[assistant("fast"), user, assistant("standard")],
				{
					fastMode: true,
				},
			),
		).toBe(false);
	});

	it("falls back to settings fastMode with no assistant entries", () =>
	{
		expect(
			sessionFastMode(
				[user],
				{
					fastMode: true,
				},
			),
		).toBe(true);
		expect(
			sessionFastMode(
				[],
				{
					fastMode: false,
				},
			),
		).toBe(false);
		expect(sessionFastMode([], {})).toBe(false);
	});

	it("does not carry settings fastMode into a fresh session when it is a per-session opt-in", () =>
	{
		expect(
			sessionFastMode(
				[],
				{
					fastMode: true,
					fastModePerSessionOptIn: true,
				},
			),
		).toBe(false);
	});

	it("ignores sidechain (subagent) assistant entries", () =>
	{
		expect(
			sessionFastMode(
				[
					assistant("standard"),
					assistant(
						"fast",
						{
							isSidechain: true,
						},
					),
				],
				{},
			),
		).toBe(false);
		expect(
			sessionFastMode(
				[
					assistant(
						"fast",
						{
							isSidechain: true,
						},
					),
				],
				{
					fastMode: false,
				},
			),
		).toBe(false);
	});

	it("skips assistant entries that carry no usage speed", () =>
	{
		const noSpeed =
		{
			type: "assistant",
			uuid: "a3",
			message:
			{
				role: "assistant",
				content: [],
				usage:
				{
					input_tokens: 1,
				},
			},
		};
		expect(sessionFastMode([assistant("fast"), noSpeed], {})).toBe(true);
	});

	it("prefers the statusline's fast_mode over a standard-speed turn when newer (cooldown counts as on)", () =>
	{
		expect(
			sessionFastMode(
				[assistant("standard")],
				{},
				{
					fastMode: true,
					updatedAt: "2026-10-24T10:00:01Z",
				},
			),
		).toBe(true);
	});

	it("reflects /fast off from a newer statusline before the next turn", () =>
	{
		expect(
			sessionFastMode(
				[assistant("fast")],
				{},
				{
					fastMode: false,
					updatedAt: "2026-10-24T10:00:05Z",
				},
			),
		).toBe(false);
	});

	it("favors the statusline at the same instant as the last turn", () =>
	{
		expect(
			sessionFastMode(
				[assistant("standard")],
				{},
				{
					fastMode: true,
					updatedAt: "2026-10-24T10:00:00.000Z",
				},
			),
		).toBe(true);
	});

	it("ignores a statusline snapshot older than the newest main-thread assistant entry", () =>
	{
		expect([
			sessionFastMode(
				[assistant("standard")],
				{},
				{
					fastMode: true,
					updatedAt: "2026-10-24T09:59:59Z",
				},
			),
			sessionFastMode(
				[assistant("fast")],
				{},
				{
					fastMode: false,
					updatedAt: "2026-10-24T09:59:59Z",
				},
			),
		]).toStrictEqual([false, true]);
	});

	it("falls back to usage.speed when the statusline has no fast_mode or no update time", () =>
	{
		expect([
			sessionFastMode(
				[assistant("fast")],
				{},
				{
					fastMode: undefined,
					updatedAt: "2026-10-24T10:00:05Z",
				},
			),
			sessionFastMode(
				[assistant("fast")],
				{},
				{
					fastMode: false,
					updatedAt: null,
				},
			),
		]).toStrictEqual([true, true]);
	});

	it("trusts a live on with no turns yet, even for a per-session opt-in", () =>
	{
		expect(
			sessionFastMode(
				[user],
				{
					fastMode: true,
					fastModePerSessionOptIn: true,
				},
				{
					fastMode: true,
					updatedAt: "2026-10-24T10:00:00Z",
				},
			),
		).toBe(true);
	});

	it("does not count a sidechain entry newer than the snapshot as a newer turn", () =>
	{
		expect(
			sessionFastMode(
				[
					assistant("standard"),
					assistant(
						"standard",
						{
							isSidechain: true,
							timestamp: "2026-10-24T10:00:09Z",
						},
					),
				],
				{},
				{
					fastMode: true,
					updatedAt: "2026-10-24T10:00:01Z",
				},
			),
		).toBe(true);
	});
});

const THIRD_PARTY =
{
	code: "not_first_party",
	line: "Not available with this provider",
	reason: "Fast mode is only available when Claude Code uses the Claude API directly.",
} as const;

const OFF_BY_ENV =
{
	code: "disabled_by_env",
	line: "Off for this session",
	reason: "An environment variable turns fast mode off in this session.",
} as const;

describe("fastModeBlockedReason", () =>
{
	it("blocks a third-party provider (Bedrock, Vertex, Foundry)", () =>
	{
		expect([
			fastModeBlockedReason(
				{
					env:
					{
						CLAUDE_CODE_USE_BEDROCK: "1",
					},
				},
			),
			fastModeBlockedReason(
				{
					env:
					{
						CLAUDE_CODE_USE_VERTEX: "true",
					},
				},
			),
			fastModeBlockedReason(
				{
					env:
					{
						CLAUDE_CODE_USE_FOUNDRY: " YES ",
					},
				},
			),
		]).toStrictEqual([THIRD_PARTY, THIRD_PARTY, THIRD_PARTY]);
	});

	it("blocks a session whose environment turns fast mode off", () =>
	{
		expect(
			fastModeBlockedReason(
				{
					env:
					{
						CLAUDE_CODE_DISABLE_FAST_MODE: "1",
					},
				},
			),
		).toStrictEqual(OFF_BY_ENV);
	});

	it("reports the third-party provider first when both apply, as the CLI orders them", () =>
	{
		expect(
			fastModeBlockedReason(
				{
					env:
					{
						CLAUDE_CODE_DISABLE_FAST_MODE: "1",
						CLAUDE_CODE_USE_BEDROCK: "1",
					},
				},
			),
		).toStrictEqual(THIRD_PARTY);
	});

	it("blocks a managed policy that turns fast mode off, with no reason tooltip", () =>
	{
		expect(
			fastModeBlockedReason(
				{
					policy:
					{
						fastMode: false,
					},
				},
			),
		).toStrictEqual(
			{
				code: "preference",
				line: "Not available",
			},
		);
	});

	it("lets a live on or cooldown override only the managed-policy block", () =>
	{
		const policy =
		{
			fastMode: false,
		};
		expect([
			fastModeBlockedReason(
				{
					policy,
					liveOn: true,
				},
			),
			fastModeBlockedReason(
				{
					policy,
					liveOn: false,
				},
			),
			fastModeBlockedReason(
				{
					policy,
				},
			),
			fastModeBlockedReason(
				{
					env:
					{
						CLAUDE_CODE_DISABLE_FAST_MODE: "1",
					},
					liveOn: true,
				},
			),
			fastModeBlockedReason(
				{
					env:
					{
						CLAUDE_CODE_USE_BEDROCK: "1",
					},
					policy,
					liveOn: true,
				},
			),
		]).toStrictEqual([
			null,
			{
				code: "preference",
				line: "Not available",
			},
			{
				code: "preference",
				line: "Not available",
			},
			OFF_BY_ENV,
			THIRD_PARTY,
		]);
	});

	it("leaves an unblocked session alone, using the CLI's truthy env rule", () =>
	{
		expect([
			fastModeBlockedReason({}),
			fastModeBlockedReason(
				{
					env:
					{
						CLAUDE_CODE_DISABLE_FAST_MODE: "0",
					},
				},
			),
			fastModeBlockedReason(
				{
					env:
					{
						CLAUDE_CODE_DISABLE_FAST_MODE: "",
					},
				},
			),
			fastModeBlockedReason(
				{
					env:
					{
						CLAUDE_CODE_USE_BEDROCK: "false",
					},
				},
			),
			fastModeBlockedReason(
				{
					policy:
					{
						fastMode: true,
					},
				},
			),
		]).toStrictEqual([null, null, null, null, null]);
	});
});

describe("sessionComposerFastMode", () =>
{
	const POLICY_BLOCKED =
	{
		code: "preference",
		line: "Not available",
	} as const;

	function server(
		fastMode: boolean | undefined,
		updatedAt: string | null,
		fastModeBlocked: FastModeBlocked | null = null,
	)
	{
		return {
			settingsFastMode: false,
			fastModeBlocked,
			statusline:
				fastMode === undefined
					? {}
					:
						{
							fast_mode: fastMode,
						},
			statuslineUpdatedAt: updatedAt,
		};
	}

	it("turns a cooldown (standard turn, live fast_mode true) on and lifts only a policy block", () =>
	{
		expect([
			sessionComposerFastMode([assistant("standard")], server(true, "2026-10-24T10:00:01Z")),
			sessionComposerFastMode([assistant("standard")], server(true, "2026-10-24T10:00:01Z", POLICY_BLOCKED)),
			sessionComposerFastMode([assistant("standard")], server(true, "2026-10-24T10:00:01Z", OFF_BY_ENV)),
			sessionComposerFastMode([assistant("standard")], server(true, "2026-10-24T09:00:00Z", POLICY_BLOCKED)),
		]).toStrictEqual([
			{
				fastMode: true,
				fastModeBlocked: null,
			},
			{
				fastMode: true,
				fastModeBlocked: null,
			},
			{
				fastMode: true,
				fastModeBlocked: OFF_BY_ENV,
			},
			{
				fastMode: false,
				fastModeBlocked: POLICY_BLOCKED,
			},
		]);
	});

	it("uses the transcript and settings before the composer state arrives", () =>
	{
		expect(sessionComposerFastMode([assistant("fast")], undefined)).toStrictEqual(
			{
				fastMode: true,
				fastModeBlocked: null,
			},
		);
	});
});
