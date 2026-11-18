import {describe, expect, it} from "vite-plus/test";
import {allowed, restrictionKindFor, restrictionTooltip} from "../src/lib/model-restrictions";

describe("allowed (the CLI's availableModels matcher)", () =>
{
	it.each([
		{
			id: "claude-opus-5-5",
			list: ["opus"],
			expected: true,
		},
		{
			id: "claude-opus-5-5",
			list: ["opus", "claude-opus-4-8"],
			expected: false,
		},
		{
			id: "claude-opus-4-8",
			list: ["opus", "claude-opus-4-8"],
			expected: true,
		},
		{
			id: "claude-sonnet-5-5",
			list: ["opus", "claude-opus-4-8"],
			expected: false,
		},
		{
			id: "claude-sonnet-5-5[1m]",
			list: ["sonnet-5-5"],
			expected: true,
		},
		{
			id: "claude-sonnet-5",
			list: [" Claude-Sonnet-5 "],
			expected: true,
		},
		{
			id: "claude-sonnet-5-5",
			list: ["claude-sonnet-5"],
			expected: true,
		},
		{
			id: "claude-sonnet-50",
			list: ["claude-sonnet-5"],
			expected: false,
		},
		{
			id: "claude-haiku-4-5-20251001",
			list: ["haiku-4-5"],
			expected: true,
		},
		{
			id: "claude-fable-5-1",
			list: [],
			expected: false,
		},
		{
			id: "claude-fable-5-1",
			list: undefined,
			expected: true,
		},
	])("$id against $list is $expected", ({id, list, expected}) =>
	{
		expect(allowed(id, list)).toBe(expected);
	});
});

describe("restrictionKindFor", () =>
{
	const rows = ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5"];
	const kinds = (value: string[]) =>
	{
		const kindFor = restrictionKindFor(
			rows,
			{
				value,
				source: "user",
				path: "~/.claude/settings.json",
			},
		);
		return rows.map((id) => kindFor(id));
	};

	it("marks every row the allowlist leaves out", () =>
	{
		expect(kinds(["opus", "sonnet"])).toStrictEqual([undefined, "allowlist", undefined, "allowlist"]);
	});

	it("ignores an allowlist no row matches, so a typo can't lock out every model", () =>
	{
		expect(
			{
				typo: kinds(["opsu"]),
				empty: kinds([]),
			},
		).toStrictEqual(
			{
				typo: [undefined, undefined, undefined, undefined],
				empty: [undefined, undefined, undefined, undefined],
			},
		);
	});

	it("restricts nothing without an allowlist", () =>
	{
		expect(restrictionKindFor(rows, null)("claude-fable-5-1")).toBeUndefined();
	});
});

describe("restrictionTooltip", () =>
{
	it.each([
		{
			source: "user",
			path: "~/.claude/settings.json",
			expected: "Not in availableModels set by your Claude Code settings (~/.claude/settings.json)",
		},
		{
			source: "project",
			path: "~/code/app/.claude/settings.json",
			expected: "Not in availableModels set by this project’s settings (~/code/app/.claude/settings.json)",
		},
		{
			source: "projectLocal",
			path: "~/code/app/.claude/settings.local.json",
			expected:
				"Not in availableModels set by this project’s local settings (~/code/app/.claude/settings.local.json)",
		},
		{
			source: "managed",
			path: "/Library/Application Support/ClaudeCode/managed-settings.json",
			expected:
				"Not in availableModels set by your organization’s managed settings (/Library/Application Support/ClaudeCode/managed-settings.json)",
		},
		{
			source: "managed",
			path: "policy:file",
			expected: "Not in availableModels set by your organization’s managed settings",
		},
		{
			source: "managed",
			path: "policy:plist",
			expected: "Not in availableModels set by your organization’s device policy",
		},
		{
			source: "managed",
			path: "policy:hkcu",
			expected: "Not in availableModels set by your organization’s device policy",
		},
		{
			source: "managed",
			path: "policy:remote",
			expected: "Not in availableModels set by your organization’s policy",
		},
		{
			source: "flag",
			path: "",
			expected: "Not in availableModels set by Claude Code settings",
		},
	])("$source at '$path'", ({source, path, expected}) =>
	{
		expect(
			restrictionTooltip(
				{
					source,
					path,
				},
			),
		).toBe(expected);
	});
});
