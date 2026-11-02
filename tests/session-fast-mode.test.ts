import {describe, expect, it} from "vite-plus/test";

import {fastModeBlockedReason, sessionFastMode} from "../src/lib/session-fast-mode";

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
});

const THIRD_PARTY =
{
	code: "not_first_party",
	line: "Not available with this provider",
	reason: "Fast mode is only available when Claude Code uses the Claude API directly.",
};

const OFF_BY_ENV =
{
	code: "disabled_by_env",
	line: "Off for this session",
	reason: "An environment variable turns fast mode off in this session.",
};

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
