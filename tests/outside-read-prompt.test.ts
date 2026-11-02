import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import type {PendingPermissionRequest} from "../src/lib/active-session-store";
import {OPTION_LINE} from "../src/lib/herdr/dialog-rows";
import
{
	isOutsideReadFirstPrompt,
	outsideReadDialogKind,
	readHasSeenOutsideReadPrompt,
} from "../src/lib/outside-read-prompt";
import {READ_OUTSIDE_AUTO_FIRST_PROMPT} from "./fixtures/permission-screens";

/** The real auto-mode payload from dumps/permission-dialog-capture-spike-permission-request-payloads.jsonl. */
const AUTO_READ: PendingPermissionRequest =
{
	toolName: "Read",
	permissionMode: "auto",
	suggestions: [
		{
			type: "addRules",
			rules: [
				{
					toolName: "Read",
					ruleContent: "//tmp/spike/outside/**",
				},
			],
			behavior: "allow",
			destination: "session",
		},
	],
};

function forTool(toolName: string): PendingPermissionRequest
{
	return {
		toolName,
		permissionMode: "auto",
		suggestions: [
			{
				type: "addRules",
				rules: [
					{
						toolName,
						ruleContent: "//tmp/spike/outside/**",
					},
				],
				behavior: "allow",
				destination: "session",
			},
		],
	};
}

describe("isOutsideReadFirstPrompt", () =>
{
	it.each([
		{
			name: "the real auto payload, prompt unseen",
			request: AUTO_READ,
			hasSeen: false,
			expected: true,
		},
		{
			name: "the real auto payload, prompt already seen",
			request: AUTO_READ,
			hasSeen: true,
			expected: false,
		},
		{
			name: "the same payload in default mode",
			request:
			{
				...AUTO_READ,
				permissionMode: "default",
			},
			hasSeen: false,
			expected: false,
		},
		{
			name: "a payload without a permission mode",
			request:
			{
				toolName: AUTO_READ.toolName,
				suggestions: AUTO_READ.suggestions,
			},
			hasSeen: false,
			expected: false,
		},
		{
			name: "Bash",
			request: forTool("Bash"),
			hasSeen: false,
			expected: false,
		},
		{
			name: "Grep",
			request: forTool("Grep"),
			hasSeen: false,
			expected: true,
		},
		{
			name: "Glob",
			request: forTool("Glob"),
			hasSeen: false,
			expected: true,
		},
		{
			name: "a localSettings destination",
			request:
			{
				...AUTO_READ,
				suggestions: [
					{
						type: "addRules",
						rules: [
							{
								toolName: "Read",
								ruleContent: "//tmp/spike/outside/**",
							},
						],
						behavior: "allow",
						destination: "localSettings",
					},
				],
			},
			hasSeen: false,
			expected: false,
		},
		{
			name: "a rule for another tool",
			request:
			{
				...AUTO_READ,
				suggestions: [
					{
						type: "addRules",
						rules: [
							{
								toolName: "Grep",
								ruleContent: "//tmp/spike/outside/**",
							},
						],
						behavior: "allow",
						destination: "session",
					},
				],
			},
			hasSeen: false,
			expected: false,
		},
		{
			name: "a rule that is not a folder glob",
			request:
			{
				...AUTO_READ,
				suggestions: [
					{
						type: "addRules",
						rules: [
							{
								toolName: "Read",
								ruleContent: "//tmp/spike/outside/note.txt",
							},
						],
						behavior: "allow",
						destination: "session",
					},
				],
			},
			hasSeen: false,
			expected: false,
		},
		{
			name: "two suggestions",
			request:
			{
				...AUTO_READ,
				suggestions: [...AUTO_READ.suggestions, ...AUTO_READ.suggestions],
			},
			hasSeen: false,
			expected: false,
		},
		{
			name: "no suggestions",
			request:
			{
				...AUTO_READ,
				suggestions: [],
			},
			hasSeen: false,
			expected: false,
		},
	] satisfies Array<
	{
		name: string;
		request: PendingPermissionRequest;
		hasSeen: boolean;
		expected: boolean;
	}>)("is $expected for $name", ({request, hasSeen, expected}) =>
	{
		expect(isOutsideReadFirstPrompt(request, hasSeen)).toStrictEqual(expected);
	});
});

describe("readHasSeenOutsideReadPrompt", () =>
{
	let dir = "";
	afterEach(() =>
	{
		if (dir !== "")
			rmSync(
				dir,
				{
					recursive: true,
					force: true,
				},
			);
		dir = "";
	});

	function configDir(contents: string | null): string
	{
		dir = mkdtempSync(join(tmpdir(), "outside-read-prompt-"));
		if (contents !== null) writeFileSync(join(dir, ".claude.json"), contents);
		return dir;
	}

	it.each([
		{
			name: "the flag set",
			contents: '{"hasSeenAutoModeOutsideReadPrompt":true}',
			expected: true,
		},
		{
			name: "the flag false",
			contents: '{"hasSeenAutoModeOutsideReadPrompt":false}',
			expected: false,
		},
		{
			name: "the flag a string",
			contents: '{"hasSeenAutoModeOutsideReadPrompt":"true"}',
			expected: false,
		},
		{
			name: "no flag",
			contents: '{"numStartups":3}',
			expected: false,
		},
		{
			name: "malformed JSON",
			contents: "{not json",
			expected: false,
		},
		{
			name: "no file",
			contents: null,
			expected: false,
		},
	])("is $expected with $name", async ({contents, expected}) =>
	{
		expect(await readHasSeenOutsideReadPrompt(configDir(contents))).toStrictEqual(expected);
	});
});

describe("outsideReadDialogKind", () =>
{
	it("reads the flag only for a candidate dialog, from CLAUDE_CONFIG_DIR or the home", async () =>
	{
		const reads: string[] = [];
		const readHasSeen = async (configDir: string): Promise<boolean> =>
		{
			reads.push(configDir);
			return Promise.resolve(false);
		};
		const kinds = [
			await outsideReadDialogKind(AUTO_READ, {}, readHasSeen, "/home/test-user"),
			await outsideReadDialogKind(
				AUTO_READ,
				{
					CLAUDE_CONFIG_DIR: "/tmp/cfg",
				},
				readHasSeen,
				"/home/test-user",
			),
			await outsideReadDialogKind(forTool("Bash"), {}, readHasSeen, "/home/test-user"),
			await outsideReadDialogKind(undefined, {}, readHasSeen, "/home/test-user"),
		];
		expect(
			{
				kinds,
				reads,
			},
		).toStrictEqual(
			{
				kinds: ["outsideReadFirstPrompt", "outsideReadFirstPrompt", "generic", "generic"],
				reads: ["/home/test-user", "/tmp/cfg"],
			},
		);
	});

	it("is generic once the prompt has been seen", async () =>
	{
		expect(await outsideReadDialogKind(AUTO_READ, {}, async () => Promise.resolve(true), "/home/test-user")).toBe(
			"generic",
		);
	});
});

/**
 * The CLI contract this stopgap leans on (CLI 2.1.319 `ZVt`, see
 * dumps/auto-mode-outside-read-first-prompt-cli-2.1.319-excerpts.txt): row 4 is
 * the only allow row that writes nothing lasting, and row 1 writes the global
 * hasSeenAutoModeOutsideReadPrompt flag. A CLI bump that renumbers the rows must
 * go red here; re-capture with scripts/capture-permission-screens.py.
 */
describe("the auto-mode outside-read first prompt's rows (CLI 2.1.319)", () =>
{
	it("keeps the one-time Yes on row 4 and the lasting Yes on row 1", () =>
	{
		const rows = READ_OUTSIDE_AUTO_FIRST_PROMPT.split("\n").flatMap((line) =>
		{
			const match = OPTION_LINE.exec(line);
			return match === null
				? []
				: [
						{
							digit: match[1],
							label: match[2],
						},
					];
		});
		expect(
			{
				row1KeepsAllowing: rows[0]?.label?.startsWith("Yes, and keep allowing") ?? false,
				rows: rows.map(({digit}) => digit),
				row4: rows[3]?.label,
			},
		).toStrictEqual(
			{
				row1KeepsAllowing: true,
				rows: ["1", "2", "3", "4"],
				row4: "Yes, but ask again next time",
			},
		);
	});
});
