// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {actAndSettle} from "./act-and-settle";
import {queueFrames} from "./frame-queue";
import type {ComponentProps} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {BackgroundTasksOpenerProvider} from "../src/components/background-tasks-opener-context";
import {ApprovalCardShell, WaitingForInputNotice} from "../src/components/approval-card";
import {PermissionCard, TITLE_READ_HINT, TITLE_UP_HINT} from "../src/components/permission-card";
import {APPROVAL_LEADING_ALLOW_KEY} from "../src/lib/approval-leading-allow";
import {clearLanding, recordLanding} from "../src/lib/approval-slot-landing";
import {isAnsweredHeld, releaseAnswered} from "../src/lib/answered-sessions";
import {clearApprovalAnswered, isApprovalAnswered, useApprovalAnswered} from "../src/lib/answered-approvals";
import
{
	findPendingPermission,
	permissionAnswerKey,
	permissionDecisionForKey,
	permissionWaitToolUseId,
	type PermissionNotification,
	titleReadWatched,
} from "../src/lib/permission-card";
import type {PermissionDialogShape} from "../src/lib/herdr/permission-screen";
import type {PersistentAllowKind, PersistentAllowSave} from "../src/lib/permission-suggestions";

/** The code tile's lazily loaded pierre File, as a bare `diffs-container` holding its code. */
vi.mock("../src/components/code-tile-file", async () =>
{
	const {createElement} = await import("react");
	return {
		CodeTileFile: ({code}: {code: string}) => createElement("diffs-container", null, code),
	};
});

let frameQueue: ReturnType<typeof queueFrames>;
beforeEach(() =>
{
	frameQueue = queueFrames();
});

afterEach(() =>
{
	cleanup();
	localStorage.removeItem(APPROVAL_LEADING_ALLOW_KEY);
	// Uninstall fake timers first: installed over the frame queue, they would put it back after it was restored.
	vi.useRealTimers();
	vi.restoreAllMocks();
	frameQueue.restore();
});

/** Lets every mounted card's paint sentinel see two visible frames. */
function paint()
{
	frameQueue.paint();
}

function assistantToolUse(id: string, name: string, input: Record<string, unknown>, extra = {})
{
	return {
		type: "assistant",
		message:
		{
			content: [
				{
					type: "tool_use",
					id,
					name,
					input,
				},
			],
		},
		...extra,
	};
}

function toolResult(id: string)
{
	return {
		type: "user",
		message:
		{
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					content: "ok",
				},
			],
		},
	};
}

function permissionNotification(overrides: Partial<PermissionNotification> = {}): PermissionNotification
{
	return {
		id: "notification-test-100",
		sessionId: "session-test-100",
		notificationType: "permission_prompt",
		message: "Claude needs your permission to use Bash",
		...overrides,
	};
}

const BASH_RECORDS = [
	assistantToolUse(
		"t1",
		"Read",
		{
			file_path: "/repo/a.ts",
		},
	),
	toolResult("t1"),
	assistantToolUse(
		"t2",
		"Bash",
		{
			command: "rm -rf dist",
			description: "Remove the build output",
		},
	),
];

describe("findPendingPermission", () =>
{
	it("shows the pending Bash command when the hook state has a permission prompt", () =>
	{
		expect(
			findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: true,
					notifications: [permissionNotification()],
					records: BASH_RECORDS,
				},
			),
		).toStrictEqual(
			{
				notificationId: "notification-test-100",
				toolUseId: "t2",
				title:
				{
					action: "run this command",
					meta: null,
				},
				detail: "rm -rf dist",
				detailLang: "bash",
				clampTitle: true,
				description: "Remove the build output",
			},
		);
	});

	it.each([
		{
			input:
			{
				command: "npm run dev",
				description: "Start the dev server",
				run_in_background: true,
			},
			expected:
			{
				title:
				{
					action: "run this command",
					meta: null,
				},
				detail: "npm run dev",
				detailLang: "bash",
				clampTitle: true,
				description: "Start the dev server",
				detailNote: "Keeps running in the background.",
			},
		},
		{
			input:
			{
				command: "curl x",
				description: "Fetch x",
				dangerouslyDisableSandbox: true,
				run_in_background: true,
			},
			expected:
			{
				title:
				{
					action: "run this command",
					meta: null,
				},
				detail: "curl x",
				detailLang: "bash",
				clampTitle: true,
				description: "Fetch x",
				detailNote: "Runs outside Claude’s sandbox. Keeps running in the background.",
				detailReadGate:
				{
					label: "Command",
					hint: "Scroll through the whole command to allow it.",
				},
				perUseOnly: true,
			},
		},
		{
			input:
			{
				command: "curl x",
				description: "curl x",
				dangerouslyDisableSandbox: true,
			},
			expected:
			{
				title:
				{
					action: "run this command",
					meta: null,
				},
				detail: "curl x",
				detailLang: "bash",
				clampTitle: true,
				detailNote: "Runs outside Claude’s sandbox.",
				detailReadGate:
				{
					label: "Command",
					hint: "Scroll through the whole command to allow it.",
				},
				perUseOnly: true,
			},
		},
		{
			input:
			{
				command: "curl x",
				dangerouslyDisableSandbox: true,
				sandbox: "off",
			},
			expected:
			{
				title:
				{
					action: "use Bash",
					meta: null,
				},
				detail: null,
				rows: [
					{
						label: "Command",
						value: "curl x",
					},
					{
						code: true,
						label: "Dangerously disable sandbox",
						value: "true",
					},
					{
						label: "Sandbox",
						value: "off",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
				clickOnly: true,
				perUseOnly: true,
				rowsGateStrict: true,
			},
		},
		{
			input:
			{
				command: "ls",
				timeout: "soon",
			},
			expected:
			{
				title:
				{
					action: "use Bash",
					meta: null,
				},
				detail: null,
				rows: [
					{
						label: "Command",
						value: "ls",
					},
					{
						label: "Timeout",
						value: "soon",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
				clickOnly: true,
			},
		},
		{
			input:
			{
				command: "ls",
				description: "List files",
				timeout: 120000,
			},
			expected:
			{
				title:
				{
					action: "run this command",
					meta: null,
				},
				detail: "ls",
				detailLang: "bash",
				clampTitle: true,
				description: "List files",
				detailNote: "Time limit: 2 minutes.",
			},
		},
		{
			input:
			{
				command: "ls",
				timeout: 45000,
			},
			expected:
			{
				title:
				{
					action: "run this command",
					meta: null,
				},
				detail: "ls",
				detailLang: "bash",
				clampTitle: true,
				detailNote: "Time limit: 45 seconds.",
			},
		},
		{
			input:
			{
				command: "make",
				timeout: 60000,
				run_in_background: true,
			},
			expected:
			{
				title:
				{
					action: "run this command",
					meta: null,
				},
				detail: "make",
				detailLang: "bash",
				clampTitle: true,
				detailNote: "Keeps running in the background. Time limit: 1 minute.",
			},
		},
	])(
		"notes a Bash command's sandbox, background and time-limit flags as upstream does ($input.command)",
		({input, expected}) =>
		{
			expect(
				findPendingPermission(
					{
						sessionId: "session-test-100",
						isActive: true,
						notifications: [permissionNotification()],
						records: [assistantToolUse("t2", "Bash", input)],
					},
				),
			).toStrictEqual(
				{
					notificationId: "notification-test-100",
					toolUseId: "t2",
					...expected,
				},
			);
		},
	);

	it("carries upstream's token warning on a Workflow, whose input.description is only a row", () =>
	{
		expect(
			findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: true,
					notifications: [permissionNotification()],
					records: [
						assistantToolUse(
							"t2",
							"Workflow",
							{
								name: "noop-a",
								description: "Replies ok",
							},
						),
					],
				},
			),
		).toStrictEqual(
			{
				notificationId: "notification-test-100",
				toolUseId: "t2",
				title:
				{
					action: "run the workflow",
					meta: "noop-a",
				},
				detail: null,
				tokenWarning: true,
				rows: [
					{
						label: "Description",
						value: "Replies ok",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		);
	});

	it("carries the persistent allow option the PermissionRequest hook reported for the prompt", () =>
	{
		expect(
			findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: true,
					notifications: [
						permissionNotification(
							{
								persistentAllow: "always",
								persistentAllowSaves: [
									{
										kind: "rule",
										toolName: "Bash",
										ruleContent: "rm -rf dist",
									},
								],
							},
						),
					],
					records: BASH_RECORDS,
				},
			),
		).toStrictEqual(
			{
				notificationId: "notification-test-100",
				toolUseId: "t2",
				title:
				{
					action: "run this command",
					meta: null,
				},
				detail: "rm -rf dist",
				detailLang: "bash",
				clampTitle: true,
				description: "Remove the build output",
				persistentAllow: "always",
				persistentAllowSaves: [
					{
						kind: "rule",
						toolName: "Bash",
						ruleContent: "rm -rf dist",
					},
				],
			},
		);
	});

	it("names a file tool's file over its full path", () =>
	{
		expect(
			findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: true,
					notifications: [permissionNotification()],
					records: [
						assistantToolUse(
							"t3",
							"Write",
							{
								file_path: "/repo/b.ts",
								content: "x",
							},
						),
					],
				},
			),
		).toStrictEqual(
			{
				notificationId: "notification-test-100",
				toolUseId: "t3",
				title:
				{
					action: "write",
					meta: "b.ts",
				},
				detail: "/repo/b.ts",
				detailIsPath: true,
				clampTitle: true,
				fileChange: "preview",
				toolName: "Write",
				toolInput:
				{
					file_path: "/repo/b.ts",
					content: "x",
				},
			},
		);
	});

	it("falls back to the notification message when no tool call is pending in the transcript", () =>
	{
		expect(
			findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: true,
					notifications: [permissionNotification()],
					records: [...BASH_RECORDS, toolResult("t2")],
				},
			),
		).toStrictEqual(
			{
				notificationId: "notification-test-100",
				toolUseId: null,
				title:
				{
					heading: "Claude needs your permission to use Bash",
				},
				detail: null,
			},
		);
	});

	it.each([
		{
			name: "no notification",
			notifications: [],
		},
		{
			name: "another session's permission prompt",
			notifications: [
				permissionNotification(
					{
						sessionId: "session-test-200",
					},
				),
			],
		},
		{
			name: "a non-permission notification",
			notifications: [
				permissionNotification(
					{
						notificationType: "idle_prompt",
					},
				),
			],
		},
	])("is hidden for $name", ({notifications}) =>
	{
		expect(
			findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: true,
					notifications,
					records: BASH_RECORDS,
				},
			),
		).toBeNull();
	});

	it("shows the card from the session's own permission wait when no notification was recorded", () =>
	{
		const records = [
			assistantToolUse(
				"t4",
				"Bash",
				{
					command: "gh pr create --fill",
					description: "Open the oxfmt comment PR and check the other test",
				},
			),
		];

		expect(
			{
				permissionWait: findPendingPermission(
					{
						sessionId: "session-test-100",
						isActive: false,
						notifications: [],
						awaitingPermission: true,
						records,
					},
				),
				inputWait: findPendingPermission(
					{
						sessionId: "session-test-100",
						isActive: false,
						notifications: [],
						awaitingPermission: false,
						records,
					},
				),
			},
		).toStrictEqual(
			{
				permissionWait:
				{
					notificationId: "t4",
					toolUseId: "t4",
					title:
					{
						action: "run this command",
						meta: null,
					},
					detail: "gh pr create --fill",
					detailLang: "bash",
					clampTitle: true,
					description: "Open the oxfmt comment PR and check the other test",
				},
				inputWait: null,
			},
		);
	});

	it("still shows the card when the session is idle and the tool call is waiting on the prompt", () =>
	{
		expect(
			findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: false,
					notifications: [permissionNotification()],
					records: BASH_RECORDS,
				},
			),
		).toStrictEqual(
			{
				notificationId: "notification-test-100",
				toolUseId: "t2",
				title:
				{
					action: "run this command",
					meta: null,
				},
				detail: "rm -rf dist",
				detailLang: "bash",
				clampTitle: true,
				description: "Remove the build output",
			},
		);
	});

	it.each([
		{
			name: "a tool_result answered the call",
			records: [...BASH_RECORDS, toolResult("t2")],
		},
		{
			name: "the turn stopped after the call",
			records: [
				...BASH_RECORDS,
				{
					type: "system",
					subtype: "turn_duration",
					durationMs: 1000,
				},
			],
		},
		{
			name: "no tool call is pending",
			records: [],
		},
	])("is hidden for an idle session when $name", ({records}) =>
	{
		expect(
			findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: false,
					notifications: [permissionNotification()],
					records,
				},
			),
		).toBeNull();
	});

	describe("picking the call the CLI asks about in a batch", () =>
	{
		const SERIAL = [
			assistantToolUse(
				"e1",
				"Edit",
				{
					file_path: "/repo/a",
					old_string: "x",
					new_string: "y",
				},
			),
			assistantToolUse(
				"w1",
				"Write",
				{
					file_path: "/repo/b",
					content: "z",
				},
			),
			assistantToolUse(
				"b1",
				"Bash",
				{
					command: "ls",
				},
			),
		];
		const PARALLEL = [
			assistantToolUse(
				"f1",
				"WebFetch",
				{
					url: "https://a",
					prompt: "p",
				},
			),
			assistantToolUse(
				"r1",
				"Read",
				{
					file_path: "/repo/a",
				},
			),
			toolResult("r1"),
		];
		const TWO_FETCHES = [
			assistantToolUse(
				"f1",
				"WebFetch",
				{
					url: "https://a",
					prompt: "p",
				},
			),
			assistantToolUse(
				"f2",
				"WebFetch",
				{
					url: "https://b",
					prompt: "p",
				},
			),
		];
		const EDIT_CARD =
		{
			notificationId: "notification-test-100",
			toolUseId: "e1",
			title:
			{
				action: "edit",
				meta: "a",
			},
			detail: "/repo/a",
			detailIsPath: true,
			clampTitle: true,
			fileChange: "preview",
			toolName: "Edit",
			toolInput:
			{
				file_path: "/repo/a",
				old_string: "x",
				new_string: "y",
			},
		};

		it.each([true, false])("describes a serial batch's first call, not its last (active %s)", (isActive) =>
		{
			expect(
				findPendingPermission(
					{
						sessionId: "session-test-100",
						isActive,
						notifications: [permissionNotification()],
						records: SERIAL,
					},
				),
			).toStrictEqual(EDIT_CARD);
		});

		it("marks the serial batch's first call as the one waiting", () =>
		{
			expect(
				permissionWaitToolUseId(
					{
						sessionId: "session-test-100",
						notifications: [permissionNotification()],
						records: SERIAL,
					},
				),
			).toBe("e1");
		});

		it("describes a parallel ask whose later sibling already finished", () =>
		{
			const signals =
			{
				sessionId: "session-test-100",
				notifications: [permissionNotification()],
				records: PARALLEL,
			};
			expect(
				{
					inactive: findPendingPermission(
						{
							...signals,
							isActive: false,
						},
					),
					active: findPendingPermission(
						{
							...signals,
							isActive: true,
						},
					),
					waiting: permissionWaitToolUseId(signals),
				},
			).toStrictEqual(
				{
					inactive:
					{
						notificationId: "notification-test-100",
						toolUseId: "f1",
						title:
						{
							action: "fetch",
							meta: "a",
						},
						detail: "https://a",
						detailFirst: true,
						rows: [
							{
								label: "Prompt",
								value: "p",
							},
						],
						rowsTrail: true,
						rowsGate: true,
					},
					active:
					{
						notificationId: "notification-test-100",
						toolUseId: "f1",
						title:
						{
							action: "fetch",
							meta: "a",
						},
						detail: "https://a",
						detailFirst: true,
						rows: [
							{
								label: "Prompt",
								value: "p",
							},
						],
						rowsTrail: true,
						rowsGate: true,
					},
					waiting: "f1",
				},
			);
		});

		it("describes the call the hook's ask names when several are pending", () =>
		{
			const signals =
			{
				sessionId: "session-test-100",
				notifications: [permissionNotification()],
				records: TWO_FETCHES,
				ask:
				{
					toolName: "WebFetch",
					toolInput:
					{
						url: "https://b",
						prompt: "p",
					},
				},
			};
			expect(
				{
					card: findPendingPermission(
						{
							...signals,
							isActive: false,
						},
					),
					waiting: permissionWaitToolUseId(signals),
				},
			).toStrictEqual(
				{
					card:
					{
						notificationId: "notification-test-100",
						toolUseId: "f2",
						title:
						{
							action: "fetch",
							meta: "b",
						},
						detail: "https://b",
						detailFirst: true,
						rows: [
							{
								label: "Prompt",
								value: "p",
							},
						],
						rowsTrail: true,
						rowsGate: true,
					},
					waiting: "f2",
				},
			);
		});

		it("falls back to the first pending call when the ask matches none", () =>
		{
			expect(
				permissionWaitToolUseId(
					{
						sessionId: "session-test-100",
						notifications: [permissionNotification()],
						records: TWO_FETCHES,
						ask:
						{
							toolName: "WebFetch",
							toolInput:
							{
								url: "https://c",
								prompt: "p",
							},
						},
					},
				),
			).toBe("f1");
		});
	});

	it("is hidden while an AskUserQuestion is the pending tool call", () =>
	{
		expect(
			findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: true,
					notifications: [permissionNotification()],
					records: [
						assistantToolUse(
							"t4",
							"AskUserQuestion",
							{
								questions: [],
							},
						),
					],
				},
			),
		).toBeNull();
	});
});

const PRIMARY = "text-primary [unicode-bidi:plaintext]";

describe("titleReadWatched, as upstream's _w", () =>
{
	it("gates a title with a meta or a heading, or an origin-tagged action over 80 characters, unless a clamped title sits over a detail", () =>
	{
		const action = (meta: string | null) => (
		{
			action: "run",
			meta,
		});
		expect([
			titleReadWatched(
				{
					title: action("x"),
					clampTitle: false,
					hasDetail: false,
				},
			),
			titleReadWatched(
				{
					title: action(null),
					clampTitle: false,
					hasDetail: false,
				},
			),
			titleReadWatched(
				{
					title: action("x"),
					clampTitle: true,
					hasDetail: true,
				},
			),
			titleReadWatched(
				{
					title: action("x"),
					clampTitle: true,
					hasDetail: false,
				},
			),
			titleReadWatched(
				{
					title:
					{
						heading: "Claude needs your permission",
					},
					clampTitle: false,
					hasDetail: false,
				},
			),
			titleReadWatched(
				{
					title:
					{
						action: "a".repeat(81),
						meta: null,
						origin: "srv",
					},
					clampTitle: false,
					hasDetail: false,
				},
			),
			titleReadWatched(
				{
					title:
					{
						action: "a".repeat(80),
						meta: null,
						origin: "srv",
					},
					clampTitle: false,
					hasDetail: false,
				},
			),
		]).toStrictEqual([true, false, false, true, true, true, false]);
	});

	it("words the title hints as upstream's 1oftTg and H9kdxn, with a typographic apostrophe", () =>
	{
		expect(
			{
				read: TITLE_READ_HINT,
				up: TITLE_UP_HINT,
				apostrophe: TITLE_UP_HINT.codePointAt(TITLE_UP_HINT.indexOf("re") - 1),
			},
		).toStrictEqual(
			{
				read: "Scroll the title to its end to allow this.",
				up: "Scroll up to see what you\u2019re allowing.",
				apostrophe: 0x2019,
			},
		);
	});
});

describe("permission title copy", () =>
{
	it.each([
		{
			tool: "Bash",
			input:
			{
				command: "rm -rf dist",
				description: "Remove the build output",
			},
			title: "Allow Claude to run this command?",
			parts: [[PRIMARY, "run this command"]],
			valueClass: "line-clamp-2",
			label: "Permission request: run this command",
			detail: "$ rm -rf dist",
			detailDir: null,
			isolated: [],
		},
		{
			tool: "Read",
			input:
			{
				file_path: "/repo/src/a.ts",
			},
			title: "Allow Claude to read a.ts?",
			parts: [
				[PRIMARY, "read"],
				[PRIMARY, "a.ts"],
			],
			valueClass: "line-clamp-2",
			label: "Permission request: read",
			detail: "/repo/src/a.ts",
			detailDir: "ltr",
			isolated: [],
		},
		{
			tool: "Grep",
			input:
			{
				pattern: "TODO",
				path: "/repo",
			},
			title: "Allow Claude to search files?",
			parts: [[PRIMARY, "search files"]],
			valueClass: null,
			label: "Permission request: search files",
			detail: "TODO",
			detailDir: null,
			isolated: [],
		},
		{
			tool: "mcp__github__create_issue",
			input:
			{
				title: "Bug",
				labels: ["a"],
			},
			title: "Allow Claude to use create issue (github)?",
			parts: [[PRIMARY, "use create issue (github)"]],
			valueClass: null,
			label: "Permission request: use create issue (github)",
			detail: null,
			detailDir: null,
			isolated: [],
		},
		{
			tool: "Workflow",
			input:
			{
				name: "upstream-sync-noop",
				description: "Does nothing",
			},
			title: "Allow Claude to run the workflow upstream-sync-noop?",
			parts: [
				[PRIMARY, "run the workflow"],
				[PRIMARY, "upstream-sync-noop"],
			],
			valueClass: null,
			label: "Permission request: run the workflow",
			detail: null,
			detailDir: null,
			isolated: [],
		},
		{
			tool: "Edit",
			input:
			{
				file_path: "/repo/src/evil\u202Ests.ts",
				old_string: "a",
				new_string: "b",
			},
			title: "Allow Claude to edit evil\u202Ests.ts?",
			parts: [
				[PRIMARY, "edit"],
				[PRIMARY, "evil\u202Ests.ts"],
			],
			valueClass: "line-clamp-2",
			label: "Permission request: edit",
			detail: "/repo/src/evil[U+202E]sts.ts",
			detailDir: "ltr",
			isolated: [["[unicode-bidi:isolate-override]", "/repo/src/evil[U+202E]sts.ts"]],
		},
	])(
		"titles $tool $input as upstream does",
		({tool, input, title, parts, valueClass, label, detail, detailDir, isolated}) =>
		{
			const pending = findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: true,
					notifications: [permissionNotification()],
					records: [assistantToolUse("t9", tool, input)],
				},
			)!;
			const {container} = render(
				<PermissionCard
					title={pending.title}
					detail={pending.detail}
					detailLang={pending.detailLang ?? null}
					clampTitle={pending.clampTitle === true}
					detailIsPath={pending.detailIsPath === true}
					canAnswer
					onDecision={async () =>
					{
					}}
				/>,
			);
			const card = container.querySelector("[data-approval-card-root]")!;
			const value = card.querySelector("[data-permission-title] [data-permission-title-value]");
			const detailElement = card.querySelector("[data-permission-detail]");
			expect(
				{
					title: value?.textContent,
					parts: [...(value?.children ?? [])].map((span) => [span.className, span.textContent]),
					valueClass: value?.getAttribute("class") ?? null,
					approvalValue: value?.hasAttribute("data-approval-value"),
					parentIsTitle: value?.parentElement?.hasAttribute("data-permission-title"),
					label: card.getAttribute("aria-label"),
					detail: detailElement?.textContent ?? null,
					detailDir: detailElement?.getAttribute("dir") ?? null,
					isolated: [...(detailElement?.querySelectorAll("span[dir=ltr]") ?? [])].map((span) => [
						span.className,
						span.textContent,
					]),
				},
			).toStrictEqual(
				{
					title,
					parts,
					valueClass,
					approvalValue: valueClass === null,
					parentIsTitle: true,
					label,
					detail,
					detailDir,
					isolated,
				},
			);
		},
	);

	it.each([
		{
			title:
			{
				action: `use ${"x".repeat(200)} (github)`,
				meta: null,
				origin: "github",
			},
			label: `Permission request: use ${"x".repeat(146)}, truncated, from github`,
		},
		{
			title:
			{
				action: `use ${"x".repeat(200)} (github)`,
				meta: null,
			},
			label: `Permission request: use ${"x".repeat(146)}, truncated`,
		},
		{
			title:
			{
				action: "use create issue (github)",
				meta: null,
				origin: "github",
			},
			label: "Permission request: use create issue (github)",
		},
		{
			title:
			{
				action: `use  ${"😀".repeat(160)}`,
				meta: null,
			},
			label: `Permission request: use ${"😀".repeat(146)}, truncated`,
		},
	])("caps the card label at 150 code points like upstream's iy ($label)", ({title, label}) =>
	{
		const {container} = render(
			<PermissionCard
				title={title}
				detail={null}
				detailLang={null}
				clampTitle={false}
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);
		expect(container.querySelector("[data-approval-card-root]")?.getAttribute("aria-label")).toBe(label);
	});

	it.each([
		{
			tool: "Glob",
			input:
			{
				pattern: "**/*.ts",
			},
			expected:
			{
				title:
				{
					action: "find files",
					meta: null,
				},
				detail: "**/*.ts",
				detailFirst: true,
			},
		},
		{
			tool: "Grep",
			input:
			{
				pattern: "TODO",
				path: "/repo",
			},
			expected:
			{
				title:
				{
					action: "search files",
					meta: null,
				},
				detail: "TODO",
				detailFirst: true,
				rows: [
					{
						label: "Path",
						value: "/repo",
						clampLines: 6,
					},
				],
				rowsUnvoiced: true,
			},
		},
		{
			tool: "Grep",
			input:
			{
				pattern: "foo",
				path: "src",
				output_mode: "content",
				"-i": true,
			},
			expected:
			{
				title:
				{
					action: "search files",
					meta: null,
				},
				detail: "foo",
				detailFirst: true,
				rows: [
					{
						label: "Path",
						value: "src",
						clampLines: 6,
					},
					{
						label: "Output mode",
						value: "content",
						clampLines: 6,
					},
					{
						label: "-i",
						labelCode: true,
						value: "true",
						code: true,
						clampLines: 6,
					},
				],
				rowsUnvoiced: true,
			},
		},
		{
			tool: "Grep",
			input:
			{
				pattern: "foo",
				...Object.fromEntries(
					Array.from(
						{
							length: 13,
						},
						(_, index) => [`opt${index}`, "x"],
					),
				),
			},
			expected:
			{
				title:
				{
					action: "search files",
					meta: null,
				},
				detail: "foo",
				detailFirst: true,
				rows: Array.from(
					{
						length: 13,
					},
					(_, index) => (
					{
						label: `Opt${index}`,
						value: "x",
						clampLines: 6,
					}),
				),
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		},
		{
			tool: "WebSearch",
			input:
			{
				query: "vitest jsdom",
			},
			expected:
			{
				title:
				{
					action: "search the web",
					meta: null,
				},
				detail: "vitest jsdom",
				detailFirst: true,
			},
		},
		{
			tool: "WebSearch",
			input:
			{
				query: "vitest",
				allowed_domains: ["a.com", "b.com"],
			},
			expected:
			{
				title:
				{
					action: "search the web",
					meta: null,
				},
				detail: "vitest",
				detailFirst: true,
				rows: [
					{
						label: "Allowed domains",
						value: "• a.com\n• b.com",
						code: true,
						clampLines: 6,
					},
				],
				rowsUnvoiced: true,
			},
		},
		{
			tool: "WebFetch",
			input:
			{
				url: "https://a.com/x",
				prompt: "sum",
			},
			expected:
			{
				title:
				{
					action: "fetch",
					meta: "a.com",
				},
				detail: "https://a.com/x",
				detailFirst: true,
				rows: [
					{
						label: "Prompt",
						value: "sum",
					},
				],
				rowsTrail: true,
				rowsGate: true,
			},
		},
		{
			tool: "WebFetch",
			input:
			{
				url: "https://a.com/x",
				prompt: " ",
			},
			expected:
			{
				title:
				{
					action: "fetch",
					meta: "a.com",
				},
				detail: "https://a.com/x",
				detailFirst: true,
			},
		},
		{
			tool: "WebFetch",
			input: {},
			expected:
			{
				title:
				{
					action: "fetch a web page",
					meta: null,
				},
				detail: null,
			},
		},
		{
			tool: "Skill",
			input:
			{
				skill: "commit",
				args: "--all",
			},
			expected:
			{
				title:
				{
					action: "run skill",
					meta: "/commit",
				},
				detail: "--all",
			},
		},
		{
			tool: "Agent",
			input:
			{
				description: "Find the bug",
				prompt: "look",
			},
			expected:
			{
				title:
				{
					action: "run an agent",
					meta: null,
				},
				detail: null,
				description: "Find the bug",
				rows: [
					{
						label: "Prompt",
						value: "look",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		},
		{
			tool: "Task",
			input:
			{
				description: "Find the bug",
				prompt: "look",
			},
			expected:
			{
				title:
				{
					action: "run an agent",
					meta: null,
				},
				detail: null,
				description: "Find the bug",
				rows: [
					{
						label: "Prompt",
						value: "look",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		},
		{
			tool: "Workflow",
			input:
			{
				name: "upstream-sync-noop",
				description: "Does nothing",
			},
			expected:
			{
				title:
				{
					action: "run the workflow",
					meta: "upstream-sync-noop",
				},
				detail: null,
				tokenWarning: true,
				rows: [
					{
						label: "Description",
						value: "Does nothing",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		},
		{
			tool: "Agent",
			input:
			{
				description: "Find x",
				prompt: "Look",
				subagent_type: "Explore",
			},
			expected:
			{
				title:
				{
					action: "run an agent",
					meta: null,
				},
				detail: null,
				description: "Find x",
				rows: [
					{
						label: "Prompt",
						value: "Look",
					},
					{
						label: "Subagent type",
						value: "Explore",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		},
		{
			tool: "Workflow",
			input:
			{
				script: "export default {}",
			},
			expected:
			{
				title:
				{
					action: "run a workflow",
					meta: null,
				},
				detail: null,
				tokenWarning: true,
				folds: [
					{
						label: "Script",
						text: "export default {}",
						lined: true,
					},
				],
			},
		},
		{
			tool: "Workflow",
			input:
			{
				scriptPath: "/s/runs/sync-wf.js",
			},
			expected:
			{
				title:
				{
					action: "run the workflow",
					meta: "sync-wf",
				},
				detail: null,
				tokenWarning: true,
				rows: [
					{
						label: "Script path",
						value: "/s/runs/sync-wf.js",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		},
		{
			tool: "Workflow",
			input:
			{
				script: "export const meta = {\n  name: 'noop',\n  description: \"Says\\nok\",\n}\nrun(\u202e)\n",
			},
			expected:
			{
				title:
				{
					action: "run the workflow",
					meta: "noop",
				},
				detail: null,
				description: "Says ok",
				tokenWarning: true,
				folds: [
					{
						label: "Script",
						text: "export const meta = {\n  name: 'noop',\n  description: \"Says\\nok\",\n}\nrun([U+202E])\n",
						lined: true,
					},
				],
			},
		},
		{
			tool: "Read",
			input:
			{
				file_path: "/repo/a.ts",
			},
			expected:
			{
				title:
				{
					action: "read",
					meta: "a.ts",
				},
				detail: "/repo/a.ts",
				detailIsPath: true,
				clampTitle: true,
			},
		},
		{
			tool: "Read",
			input:
			{
				file_path: "/repo/a.ts",
				offset: 5,
				limit: 1,
			},
			expected:
			{
				title:
				{
					action: "read",
					meta: "a.ts",
				},
				detail: "/repo/a.ts",
				detailIsPath: true,
				detailNote: "Line 5",
				clampTitle: true,
			},
		},
		{
			tool: "Read",
			input:
			{
				file_path: "/repo/a.ts",
				offset: 5,
				limit: 10,
			},
			expected:
			{
				title:
				{
					action: "read",
					meta: "a.ts",
				},
				detail: "/repo/a.ts",
				detailIsPath: true,
				detailNote: "Lines 5 to 14",
				clampTitle: true,
			},
		},
		{
			tool: "Read",
			input:
			{
				file_path: "/repo/a.ts",
				offset: 5,
			},
			expected:
			{
				title:
				{
					action: "read",
					meta: "a.ts",
				},
				detail: "/repo/a.ts",
				detailIsPath: true,
				detailNote: "From line 5",
				clampTitle: true,
			},
		},
		{
			tool: "Read",
			input:
			{
				file_path: "/repo/a.pdf",
				limit: 10,
				pages: "3",
			},
			expected:
			{
				title:
				{
					action: "read",
					meta: "a.pdf",
				},
				detail: "/repo/a.pdf",
				detailIsPath: true,
				detailNote: "First 10 lines, Page 3",
				clampTitle: true,
			},
		},
		{
			tool: "Read",
			input:
			{
				file_path: "/repo/a.pdf",
				pages: "1-3",
			},
			expected:
			{
				title:
				{
					action: "read",
					meta: "a.pdf",
				},
				detail: "/repo/a.pdf",
				detailIsPath: true,
				detailNote: "Pages 1-3",
				clampTitle: true,
			},
		},
		{
			tool: "Read",
			input:
			{
				file_path: "/repo/a.pdf",
				pages: "intro",
			},
			expected:
			{
				title:
				{
					action: "read",
					meta: "a.pdf",
				},
				detail: "/repo/a.pdf",
				detailIsPath: true,
				clampTitle: true,
				rows: [
					{
						label: "Pages",
						value: "intro",
					},
				],
				rowsUnvoiced: true,
			},
		},
		{
			tool: "Write",
			input:
			{
				file_path: "/repo/b.ts",
				content: "",
			},
			expected:
			{
				title:
				{
					action: "write",
					meta: "b.ts",
				},
				detail: "/repo/b.ts",
				detailIsPath: true,
				detailNote: "Leaves the file empty.",
				clampTitle: true,
			},
		},
		{
			tool: "Edit",
			input:
			{
				file_path: "/repo/b.ts",
				old_string: "a",
				new_string: "b",
				replace_all: true,
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "b.ts",
				},
				detail: "/repo/b.ts",
				detailIsPath: true,
				detailNote: "Replaces every match in the file.",
				clampTitle: true,
				fileChange: "preview",
			},
		},
		{
			tool: "Edit",
			input:
			{
				file_path: "/a/b.ts",
				old_string: "x",
				new_string: "y",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "b.ts",
				},
				detail: "/a/b.ts",
				detailIsPath: true,
				clampTitle: true,
				fileChange: "preview",
			},
		},
		{
			tool: "Edit",
			input:
			{
				file_path: "/a/b.ts",
				old_string: 5,
				new_string: "y",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "b.ts",
				},
				detail: "/a/b.ts",
				detailIsPath: true,
				clampTitle: true,
			},
		},
		{
			tool: "Write",
			input:
			{
				file_path: "/a/b.ts",
				content: "x".repeat(200_001),
			},
			expected:
			{
				title:
				{
					action: "write",
					meta: "b.ts",
				},
				detail: "/a/b.ts",
				detailIsPath: true,
				clampTitle: true,
				fileChange: "too_large",
			},
		},
		{
			tool: "Write",
			input:
			{
				file_path: "/a/b.ts",
				content: "x".repeat(200_000),
			},
			expected:
			{
				title:
				{
					action: "write",
					meta: "b.ts",
				},
				detail: "/a/b.ts",
				detailIsPath: true,
				clampTitle: true,
				fileChange: "preview",
			},
		},
		{
			tool: "MultiEdit",
			input:
			{
				file_path: "/a/b.ts",
				edits: [
					{
						old_string: "a",
						new_string: "b",
						replace_all: true,
					},
				],
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "b.ts",
				},
				detail: "/a/b.ts",
				detailIsPath: true,
				detailNote: "Replaces every match in the file.",
				clampTitle: true,
				fileChange: "preview",
			},
		},
		{
			tool: "MultiEdit",
			input:
			{
				file_path: "/a/b.ts",
				edits: [
					{
						old_string: "a",
						new_string: "b",
					},
					"c",
				],
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "b.ts",
				},
				detail: "/a/b.ts",
				detailIsPath: true,
				clampTitle: true,
			},
		},
		{
			tool: "MultiEdit",
			input:
			{
				file_path: "/repo/b.ts",
				edits: [],
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "b.ts",
				},
				detail: "/repo/b.ts",
				detailIsPath: true,
				clampTitle: true,
			},
		},
		{
			tool: "NotebookEdit",
			input:
			{
				notebook_path: "/repo/n.ipynb",
				cell_id: "c1",
				new_source: "x = 1\ny = 2\n",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "n.ipynb",
				},
				detail: "/repo/n.ipynb",
				detailIsPath: true,
				clampTitle: true,
				detailNote: "Replaces cell c1.",
				folds: [
					{
						label: "New cell content",
						text: "x = 1\ny = 2\n",
						open: true,
						lined: true,
					},
				],
			},
		},
		{
			tool: "NotebookEdit",
			input:
			{
				notebook_path: "/repo/n.ipynb",
				cell_id: "c1",
				edit_mode: "insert",
				cell_type: "code",
				new_source: "x",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "n.ipynb",
				},
				detail: "/repo/n.ipynb",
				detailIsPath: true,
				clampTitle: true,
				detailNote: "Adds a new cell after cell c1. Cell type: code.",
				folds: [
					{
						label: "New cell content",
						text: "x",
						open: true,
						lined: true,
					},
				],
			},
		},
		{
			tool: "NotebookEdit",
			input:
			{
				notebook_path: "/repo/n.ipynb",
				edit_mode: "insert",
				new_source: "x",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "n.ipynb",
				},
				detail: "/repo/n.ipynb",
				detailIsPath: true,
				clampTitle: true,
				detailNote: "Adds a new cell at the top.",
				folds: [
					{
						label: "New cell content",
						text: "x",
						open: true,
						lined: true,
					},
				],
			},
		},
		{
			tool: "NotebookEdit",
			input:
			{
				notebook_path: "/repo/n.ipynb",
				cell_id: "",
				edit_mode: "insert",
				new_source: "",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "n.ipynb",
				},
				detail: "/repo/n.ipynb",
				detailIsPath: true,
				clampTitle: true,
				detailNote: "Adds a new cell at the top.",
				folds: [
					{
						label: "New cell content",
						text: "",
						open: true,
						lined: true,
					},
				],
			},
		},
		{
			tool: "NotebookEdit",
			input:
			{
				notebook_path: "/repo/n.ipynb",
				cell_id: "c2",
				edit_mode: "delete",
				cell_type: "code",
				new_source: "",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "n.ipynb",
				},
				detail: "/repo/n.ipynb",
				detailIsPath: true,
				clampTitle: true,
				detailNote: "Deletes cell c2.",
			},
		},
		{
			tool: "NotebookEdit",
			input:
			{
				notebook_path: "/repo/n.ipynb",
				cell_id: "my cell",
				new_source: "x",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "n.ipynb",
				},
				detail: "/repo/n.ipynb",
				detailIsPath: true,
				clampTitle: true,
				rows: [
					{
						label: "Notebook path",
						value: "/repo/n.ipynb",
					},
					{
						label: "Cell ID",
						value: "my cell",
					},
					{
						label: "New source",
						value: "x",
					},
				],
				rowsGate: true,
			},
		},
		{
			tool: "NotebookEdit",
			input:
			{
				notebook_path: "/repo/n.ipynb",
				cell_id: "c1",
				new_source: "x",
				extra: "1",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "n.ipynb",
				},
				detail: "/repo/n.ipynb",
				detailIsPath: true,
				clampTitle: true,
				rows: [
					{
						label: "Notebook path",
						value: "/repo/n.ipynb",
					},
					{
						label: "Cell ID",
						value: "c1",
					},
					{
						label: "New source",
						value: "x",
					},
					{
						label: "Extra",
						value: "1",
					},
				],
				rowsGate: true,
			},
		},
		{
			tool: "NotebookEdit",
			input:
			{
				notebook_path: "/repo/n.ipynb",
				cell_type: "raw",
				edit_mode: "insert",
				new_source: "x",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "n.ipynb",
				},
				detail: "/repo/n.ipynb",
				detailIsPath: true,
				clampTitle: true,
				rows: [
					{
						label: "Notebook path",
						value: "/repo/n.ipynb",
					},
					{
						label: "Cell type",
						value: "raw",
					},
					{
						label: "Edit mode",
						value: "insert",
					},
					{
						label: "New source",
						value: "x",
					},
				],
				rowsGate: true,
			},
		},
		{
			tool: "NotebookEdit",
			input:
			{
				notebook_path: "/repo/n.ipynb",
				new_source: "x",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "n.ipynb",
				},
				detail: "/repo/n.ipynb",
				detailIsPath: true,
				clampTitle: true,
				rows: [
					{
						label: "Notebook path",
						value: "/repo/n.ipynb",
					},
					{
						label: "New source",
						value: "x",
					},
				],
				rowsGate: true,
			},
		},
		{
			tool: "NotebookEdit",
			input:
			{
				notebook_path: "/repo/n.ipynb",
				cell_id: "c1",
				cell_type: "markdown",
				new_source: "x\u202Ey\r\n",
			},
			expected:
			{
				title:
				{
					action: "edit",
					meta: "n.ipynb",
				},
				detail: "/repo/n.ipynb",
				detailIsPath: true,
				clampTitle: true,
				detailNote: "Replaces cell c1. Cell type: markdown.",
				folds: [
					{
						label: "New cell content",
						text: "x[U+202E]y[U+000D]\n",
						open: true,
						lined: true,
					},
				],
			},
		},
		{
			tool: "Monitor",
			input:
			{
				command: "tail -f log",
				description: "Watch the log",
			},
			expected:
			{
				title:
				{
					action: "run and watch a command",
					meta: null,
				},
				detail: "tail -f log",
				detailLang: "bash",
				detailFirst: true,
			},
		},
		{
			tool: "Monitor",
			input:
			{
				url: "wss://example.test",
			},
			expected:
			{
				title:
				{
					action: "open and watch a connection",
					meta: null,
				},
				detail: null,
				rows: [
					{
						label: "URL",
						value: "wss://example.test",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		},
		{
			tool: "CronCreate",
			input:
			{
				cron: "0 9 * * *",
				prompt: "Check the build",
			},
			expected:
			{
				title:
				{
					action: "schedule a prompt",
					meta: null,
				},
				detail: "Check the build",
				detailFirst: true,
				rows: [
					{
						label: "Cron",
						value: "0 9 * * *",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		},
		{
			tool: "EnterWorktree",
			input:
			{
				name: "feature-a",
			},
			expected:
			{
				title:
				{
					action: "create a worktree",
					meta: null,
				},
				detail: null,
				rows: [
					{
						label: "Name",
						value: "feature-a",
						clampLines: 6,
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
			},
		},
		{
			tool: "EnterWorktree",
			input:
			{
				path: "/repo/.worktrees/a",
			},
			expected:
			{
				title:
				{
					action: "move to a worktree",
					meta: null,
				},
				detail: null,
				rows: [
					{
						label: "Path",
						value: "/repo/.worktrees/a",
						clampLines: 6,
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
			},
		},
		{
			tool: "ExitWorktree",
			input: {},
			expected:
			{
				title:
				{
					action: "leave the worktree",
					meta: null,
				},
				detail: null,
			},
		},
		{
			tool: "ExitWorktree",
			input:
			{
				action: "remove",
			},
			expected:
			{
				title:
				{
					action: "delete the worktree and its branch",
					meta: null,
				},
				detail: null,
				rows: [
					{
						label: "Action",
						value: "remove",
						clampLines: 6,
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
			},
		},
		...(
			[
				["TaskCreate", "create a task"],
				["TaskUpdate", "update a task"],
				["TaskGet", "read a task"],
				["TaskList", "list its tasks"],
				["TaskStop", "stop a task"],
				["TaskOutput", "read a task’s output"],
				["TodoWrite", "update its to-do list"],
				["CronDelete", "delete a scheduled prompt"],
				["CronList", "list its scheduled prompts"],
				["ScheduleWakeup", "schedule a wake-up"],
				["SendMessage", "send a message to an agent"],
				["ListAgents", "list its agents"],
				["EnterPlanMode", "start planning"],
				["ReportFindings", "report its findings"],
				["KillBash", "stop a command"],
				["KillShell", "stop a command"],
				["BashOutput", "read a command’s output"],
				["LS", "list a folder"],
				["ToolSearch", "load tools"],
				["REPL", "run code"],
				["JavaScript", "run code"],
			] as const
		).map(([tool, action]) => (
		{
			tool,
			input: {},
			expected:
			{
				title:
				{
					action,
					meta: null,
				},
				detail: null,
			},
		})),
		{
			tool: "ToolSearch",
			input:
			{
				query: "select:Read",
			},
			expected:
			{
				title:
				{
					action: "load tools",
					meta: null,
				},
				detail: null,
				rows: [
					{
						label: "Query",
						value: "select:Read",
						clampLines: 6,
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
			},
		},
		{
			tool: "TaskCreate",
			input:
			{
				subject: "x",
			},
			expected:
			{
				title:
				{
					action: "create a task",
					meta: null,
				},
				detail: null,
				rows: [
					{
						label: "Subject",
						value: "x",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		},
		{
			tool: "SendMessage",
			input:
			{
				type: "message",
				recipient: "a",
				content: "hi",
			},
			expected:
			{
				title:
				{
					action: "send a message to an agent",
					meta: null,
				},
				detail: null,
				rows: [
					{
						label: "Recipient",
						value: "a",
					},
					{
						label: "Content",
						value: "hi",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		},
		{
			tool: "mcp__srv__do",
			input:
			{
				q: "a",
			},
			expected:
			{
				title:
				{
					action: "use do (srv)",
					meta: null,
					origin: "srv",
				},
				detail: null,
				rows: [
					{
						label: "Q",
						value: "a",
					},
				],
				rowsUnvoiced: true,
				rowsTrail: true,
				rowsGate: true,
			},
		},
	] as
	{
		tool: string;
		input: Record<string, unknown>;
		expected: Record<string, unknown>;
	}[])("copies upstream's $tool permission copy for $input", ({tool, input, expected}) =>
	{
		const
		{
			notificationId: _notificationId,
			toolUseId: _toolUseId,
			toolName: _toolName,
			toolInput: _toolInput,
			...copy
		} = findPendingPermission(
			{
				sessionId: "session-test-100",
				isActive: true,
				notifications: [permissionNotification()],
				records: [assistantToolUse("t9", tool, input)],
			},
		)!;
		expect(copy).toStrictEqual(expected);
	});

	it("carries a previewed file tool's name and input for its diff, and no other tool's", () =>
	{
		const pendingFor = (tool: string, input: Record<string, unknown>) =>
		{
			const pending = findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: true,
					notifications: [permissionNotification()],
					records: [assistantToolUse("t9", tool, input)],
				},
			)!;
			return {
				toolName: pending.toolName,
				toolInput: pending.toolInput,
			};
		};
		const edit =
		{
			file_path: "/a/b.ts",
			old_string: "x",
			new_string: "y",
		};
		expect([
			pendingFor("Edit", edit),
			pendingFor(
				"Write",
				{
					file_path: "/a/b.ts",
					content: "",
				},
			),
			pendingFor(
				"Read",
				{
					file_path: "/a/b.ts",
				},
			),
		]).toStrictEqual([
			{
				toolName: "Edit",
				toolInput: edit,
			},
			{
				toolName: undefined,
				toolInput: undefined,
			},
			{
				toolName: undefined,
				toolInput: undefined,
			},
		]);
	});

	it("holds its session as answered at the click, before the decision settles", () =>
	{
		render(
			<PermissionCard
				title={
				{
					action: "run",
					meta: null,
				}}
				detail="ls"
				canAnswer
				sessionId="s-permission"
				answerKey="toolu_permission"
				onDecision={async () => new Promise<void>(() => {})}
			/>,
		);
		paint();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Allow/,
				},
			),
		);
		const held = isAnsweredHeld("s-permission");
		releaseAnswered("s-permission");

		expect(held).toBe(true);
	});

	it("draws the notification text as the heading when no tool call describes the prompt", () =>
	{
		const {container} = render(
			<PermissionCard
				title={
				{
					heading: "Claude needs your permission to use Bash",
				}}
				detail={null}
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);
		const card = container.querySelector("[data-approval-card-root]")!;
		expect(
			{
				title: card.querySelector("[data-permission-title]")?.textContent,
				label: card.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				title: "Claude needs your permission to use Bash",
				label: "Permission request",
			},
		);
	});
});

describe("permissionDecisionForKey", () =>
{
	const plain =
	{
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
	};

	it.each([
		{
			event:
			{
				...plain,
				key: "Escape",
			},
			decision: "deny",
		},
		{
			event:
			{
				...plain,
				key: "Enter",
				metaKey: true,
			},
			decision: "allow",
		},
		{
			event:
			{
				...plain,
				key: "Enter",
				ctrlKey: true,
			},
			decision: "allow",
		},
		{
			event:
			{
				...plain,
				key: "Enter",
				metaKey: true,
				shiftKey: true,
			},
			decision: "always",
		},
		{
			event:
			{
				...plain,
				key: "Enter",
				metaKey: true,
				altKey: true,
			},
			decision: null,
		},
		{
			event:
			{
				...plain,
				key: "Enter",
			},
			decision: null,
		},
		{
			event:
			{
				...plain,
				key: "1",
			},
			decision: null,
		},
		{
			event:
			{
				...plain,
				key: "2",
			},
			decision: null,
		},
		{
			event:
			{
				...plain,
				key: "Escape",
				shiftKey: true,
			},
			decision: null,
		},
	])("maps $event.key to $decision", ({event, decision}) =>
	{
		expect(permissionDecisionForKey(event)).toStrictEqual(decision);
	});
});

/** A pending answer the test settles by hand. */
function deferredAnswer()
{
	let resolve!: () => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<undefined>((onResolve, onReject) =>
	{
		resolve = () =>
		{
			onResolve(undefined);
		};
		reject = onReject;
	});
	return {
		promise,
		resolve,
		reject,
	};
}

function heldButtons()
{
	return screen.getAllByRole("button").map((button) => (
	{
		text: button.textContent,
		label: button.getAttribute("aria-label"),
		busy: button.getAttribute("aria-busy"),
		disabled: button.hasAttribute("disabled"),
	}));
}

function renderCard({
	canAnswer = true,
	persistentAllow = null,
	saves = null,
	dialog,
}:
{
	canAnswer?: boolean;
	persistentAllow?: PersistentAllowKind | null;
	saves?: readonly PersistentAllowSave[] | null;
	dialog?: PermissionDialogShape | "unknown";
} = {})
{
	const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => {});
	const card = (shape: PermissionDialogShape | "unknown" | undefined) => (
		<div>
			<div data-focus-region="composer">
				<div data-composer-card>
					<textarea aria-label="Prompt" />
				</div>
			</div>
			<PermissionCard
				title={
				{
					action: "run this command",
					meta: null,
				}}
				detail="rm -rf dist"
				detailLang="bash"
				clampTitle
				description="Remove the build output"
				canAnswer={canAnswer}
				persistentAllow={persistentAllow}
				persistentAllowSaves={saves}
				{...(shape === undefined
					? {}
					:
						{
							dialog: shape,
						})}
				onDecision={onDecision}
			/>
		</div>
	);
	const utils = render(card(dialog));
	paint();
	return {
		...utils,
		onDecision,
		rerenderDialog: (shape: PermissionDialogShape | "unknown") =>
		{
			utils.rerender(card(shape));
		},
	};
}

describe("PermissionCard", () =>
{
	it("renders the title, command block, and upstream's Deny (Esc, no keycap) / Allow once (⌘⏎)", () =>
	{
		const {container} = renderCard();
		const card = container.querySelector("[data-approval-card-root]")!;
		const deny = screen.getByRole(
			"button",
			{
				name: /^Deny/,
			},
		);
		const allow = screen.getByRole(
			"button",
			{
				name: /^Allow once/,
			},
		);
		expect(
			{
				label: card.getAttribute("aria-label"),
				rootDigits: card.getAttribute("data-approval-card-digits"),
				title: card.querySelector("[data-permission-title]")?.textContent,
				command: card.querySelector("[data-permission-detail]")?.textContent,
				denyKeys: [...deny.querySelectorAll("kbd")].map((kbd) => kbd.textContent),
				allowKeys: [...allow.querySelectorAll("kbd")].map((kbd) => kbd.textContent),
				denyShortcut: deny.getAttribute("aria-keyshortcuts"),
				allowShortcut: allow.getAttribute("aria-keyshortcuts"),
				denyData: Object.fromEntries(Object.entries(deny.dataset)),
				allowData: Object.fromEntries(Object.entries(allow.dataset)),
				digits: [deny, allow].map((button) =>
				{
					const label = button.querySelector<HTMLElement>("[data-approval-digit]");
					return [label?.dataset["approvalDigit"], label?.textContent];
				}),
			},
		).toStrictEqual(
			{
				label: "Permission request: run this command",
				rootDigits: "2",
				title: "Allow Claude to run this command?",
				command: "$ rm -rf dist",
				denyKeys: [],
				allowKeys: ["Ctrl", "⏎Enter"],
				denyShortcut: "Escape",
				allowShortcut: "Control+Enter",
				denyData:
				{
					approvalVariant: "secondary",
				},
				allowData:
				{
					approvalVariant: "primary",
					approvalPrimary: "",
				},
				digits: [
					["1", "Deny"],
					["2", "Allow once"],
				],
			},
		);
	});

	it("counts upstream's live digits on the root (3 with a persistent option, either lead), and none on a deny-first or read-only card; the labels stay 1/2 and plain-button labels truncate like upstream", () =>
	{
		const facts = (setup: () => ReturnType<typeof renderCard>) =>
		{
			const {container, unmount} = setup();
			const root = container.querySelector("[data-approval-card-root]")!;
			const fact =
			{
				root: root.getAttribute("data-approval-card-digits"),
				labels: [...root.querySelectorAll<HTMLElement>("[data-approval-digit]")].map((label) => [
					label.dataset["approvalDigit"],
					label.textContent,
					label.className,
				]),
			};
			unmount();
			return fact;
		};
		const leading = (lead: "once" | "always") =>
		{
			localStorage.setItem(APPROVAL_LEADING_ALLOW_KEY, lead);
			return renderCard(
				{
					persistentAllow: "always",
				},
			);
		};
		const truncates = "min-w-0 [unicode-bidi:plaintext] truncate";
		const deniesFirst = [
			["1", "Deny", truncates],
			["2", "Allow once", truncates],
		];
		expect(
			{
				plain: facts(() => renderCard()),
				leadsOnce: facts(() => leading("once")),
				leadsAlways: facts(() => leading("always")),
				denyFirst: facts(() =>
					renderCard(
						{
							dialog: "unknown",
						},
					),
				),
				readOnly: facts(() =>
					renderCard(
						{
							canAnswer: false,
						},
					),
				),
			},
		).toStrictEqual(
			{
				plain:
				{
					root: "2",
					labels: deniesFirst,
				},
				leadsOnce:
				{
					root: "3",
					labels: [
						["1", "Deny", truncates],
						["2", "Allow once", ""],
					],
				},
				leadsAlways:
				{
					root: "3",
					labels: [
						["1", "Deny", truncates],
						["2", "Always allow", ""],
					],
				},
				denyFirst:
				{
					root: null,
					labels: deniesFirst,
				},
				readOnly:
				{
					root: null,
					labels: deniesFirst,
				},
			},
		);
	});

	it("lays out upstream's actions row: justified to the end, Deny first, then the allow group", () =>
	{
		const {container} = renderCard(
			{
				persistentAllow: "always",
			},
		);
		const row = container.querySelector<HTMLElement>("[data-approval-card-actions]")!;
		const group = row.querySelector<HTMLElement>("[data-approval-allow]");
		const classes = (element: Element | null) => new Set(element?.getAttribute("class")?.split(/\s+/));
		const has = (element: Element | null, names: string[]) => names.filter((name) => classes(element).has(name));
		expect(
			{
				row: has(row, [
					"flex",
					"flex-wrap",
					"items-start",
					"justify-end",
					"justify-between",
					"gap-x-md",
					"gap-y-sm",
				]),
				children: [...row.children].map((child) => child.textContent),
				group: group?.getAttribute("class"),
				grouped: [...(group?.querySelectorAll("button") ?? [])].map((button) => button.textContent),
				split: (() =>
				{
					const split = group?.querySelector<HTMLElement>("[data-cds=SplitDropdownButton]");
					const [primary, caret] = [...(split?.querySelectorAll("button") ?? [])];
					const sizing = [
						"h-control",
						"text-body",
						"px-[min(var(--cds-pad-md),var(--cds-button-pad-max,var(--cds-pad-md)))]",
						"rounded-[var(--upstream-radius)]",
						"w-[var(--split-h)]",
						"px-1",
						"h-6",
						"px-2",
						"rounded-r5",
					];
					const pick = (element: Element | undefined) =>
						sizing.filter((name) => element?.classList.contains(name));
					return {
						h: split?.style.getPropertyValue("--split-h"),
						root: pick(split ?? undefined),
						primary: pick(primary),
						caret: pick(caret),
						caretIcon: caret?.querySelector("svg")?.classList.contains("size-4"),
					};
				})(),
			},
		).toStrictEqual(
			{
				row: ["flex", "flex-wrap", "items-start", "justify-end", "gap-x-md", "gap-y-sm"],
				children: ["Deny", "Always allow"],
				group: "flex min-w-0 flex-wrap items-start gap-sm",
				grouped: ["Always allow", ""],
				split:
				{
					h: "var(--cds-h-control)",
					root: ["rounded-[var(--upstream-radius)]"],
					primary: [
						"h-control",
						"text-body",
						"px-[min(var(--cds-pad-md),var(--cds-button-pad-max,var(--cds-pad-md)))]",
						"rounded-[var(--upstream-radius)]",
					],
					caret: ["h-control", "rounded-[var(--upstream-radius)]", "w-[var(--split-h)]", "px-1"],
					caretIcon: true,
				},
			},
		);
	});

	it("draws upstream's inline card presentation: outlined, transparent, unshadowed, its own container", () =>
	{
		// Upstream's class strings carry `text-code` alone: the utility itself brings the mono face.
		const pathCard = render(
			<PermissionCard
				title={
				{
					action: "find files",
					meta: null,
				}}
				detail="**/*.ts"
				detailLang={null}
				clampTitle={false}
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);
		const pathDetail = pathCard.container.querySelector("[data-permission-detail]")?.getAttribute("class");
		pathCard.unmount();
		const {container} = renderCard();
		const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		const missing = (element: Element | null, expected: string[]) =>
		{
			const actual = new Set(element?.getAttribute("class")?.split(/\s+/));
			return expected.filter((name) => !actual.has(name));
		};
		expect(
			{
				presentation: card.dataset["approvalPresentation"],
				card: missing(card, ["card-ring", "@container", "rounded-card", "p-lg", "text-body"]),
				dockLook: ["shadow-[var(--approval-card-shadow)]", "bg-surface-2"].filter((name) =>
					card.classList.contains(name),
				),
				title: card.querySelector("[data-permission-title]")?.getAttribute("class"),
				value: card.querySelector("[data-permission-detail]")?.getAttribute("class"),
				wrapper: card
					.querySelector("[data-permission-detail] > [data-approval-value] > div")
					?.getAttribute("class"),
				wrapperDir: card
					.querySelector("[data-permission-detail] > [data-approval-value] > div")
					?.getAttribute("dir"),
				codeCard: card
					.querySelector("[data-permission-detail] > [data-approval-value] > div > div")
					?.getAttribute("class"),
				gutter: card.querySelector("[data-permission-detail] .select-none")?.textContent,
				gutterHidden: card.querySelector("[data-permission-detail] .select-none")?.getAttribute("aria-hidden"),
				gutterOmitted: card
					.querySelector("[data-permission-detail] .select-none")
					?.getAttribute("data-find-omitted"),
				pathDetail,
				deny: missing(
					screen.getByRole(
						"button",
						{
							name: /^Deny/,
						},
					),
					[
						"h-control",
						"rounded-[var(--upstream-radius)]",
						"px-[min(var(--cds-pad-md),var(--cds-button-pad-max,var(--cds-pad-md)))]",
						"text-body",
						"bg-fill-secondary",
						"[:root:not([data-cds-fizzy-lake~=color])_&]:shadow-field-drop",
					],
				),
				allow: missing(
					screen.getByRole(
						"button",
						{
							name: /^Allow once/,
						},
					),
					[
						"h-control",
						"rounded-[var(--upstream-radius)]",
						"px-[min(var(--cds-pad-md),var(--cds-button-pad-max,var(--cds-pad-md)))]",
						"text-body",
						"bg-primary",
						"text-surface-1",
					],
				),
			},
		).toStrictEqual(
			{
				presentation: "card",
				card: [],
				dockLook: [],
				title: "text-body min-w-0 break-words",
				value: "flow-root",
				wrapper: "contents",
				wrapperDir: "ltr",
				codeCard: "epitaxy-diff epitaxy-code-card rounded-lg flex overflow-clip px-md py-xs text-code",
				pathDetail:
					"epitaxy-code-size bg-alpha-1 rounded-r4 py-md px-lg text-code text-secondary whitespace-pre-wrap break-words select-text [unicode-bidi:plaintext]",
				gutter: "$ ",
				gutterHidden: "true",
				gutterOmitted: "",
				deny: [],
				allow: [],
			},
		);
	});

	it("prompts a PowerShell command with upstream's `> ` gutter", () =>
	{
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "run this command",
					meta: null,
				}}
				detail="Get-ChildItem"
				detailLang="powershell"
				clampTitle={false}
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);
		expect(container.querySelector("[data-permission-detail] .select-none")?.textContent).toBe("> ");
	});

	it("spaces the card as upstream's inline permission card: 480px wide, 24px gaps, a tinted title band and 12px details", () =>
	{
		const {container} = renderCard();
		const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		const body = card.querySelector<HTMLElement>("[data-approval-card-body]")!;
		const region = card.querySelector<HTMLElement>("[data-testid=approval-title-region]");
		const title = card.querySelector<HTMLElement>("[data-permission-title]")!;
		const value = card.querySelector<HTMLElement>("[data-permission-detail]")!;
		const classes = (element: Element | null) => new Set(element?.getAttribute("class")?.split(/\s+/));
		const has = (element: Element | null, names: string[]) => names.filter((name) => classes(element).has(name));
		expect(
			{
				card: has(card, [
					"gap-[24px]",
					"w-full",
					"max-w-[480px]",
					"gap-3",
					"!pt-0",
					"overflow-clip",
					"max-h-[60vh]",
					"max-h-[max(60vh,calc(16rem*var(--cds-rem-scale,1)))]",
					"max-h-[var(--approval-conversation-cap,max(60vh,calc(16rem*var(--cds-rem-scale,1))))]",
					"mb-[calc(-1*var(--approval-conversation-end-reclaim,0px))]",
					"epitaxy-tool-card-in-flow",
				]),
				regionIsFirstChild: card.firstElementChild === region,
				region: region?.getAttribute("class"),
				band: region?.firstElementChild?.getAttribute("class"),
				titleChain: [
					title.parentElement?.getAttribute("class"),
					title.parentElement?.parentElement?.getAttribute("class"),
					title.parentElement?.parentElement?.parentElement?.getAttribute("class"),
				],
				titleRowInBand:
					title.parentElement?.parentElement?.parentElement?.parentElement === region?.firstElementChild,
				body: has(body, ["gap-[24px]", "gap-2.5", "-mt-[18px]", "-mt-1"]),
				details: value.parentElement?.getAttribute("class"),
				detailsAreBodyChild: value.parentElement?.parentElement === body,
				detailsText: [...(value.parentElement?.children ?? [])].map((child) => child.textContent),
			},
		).toStrictEqual(
			{
				card: [
					"gap-[24px]",
					"w-full",
					"max-w-[480px]",
					"!pt-0",
					"overflow-clip",
					"max-h-[var(--approval-conversation-cap,max(60vh,calc(16rem*var(--cds-rem-scale,1))))]",
					"mb-[calc(-1*var(--approval-conversation-end-reclaim,0px))]",
					"epitaxy-tool-card-in-flow",
				],
				regionIsFirstChild: true,
				region: "epitaxy-scroll-clamp scroll-fade-y focus-visible:outline-hidden focus-visible:shadow-focus shrink-0 overflow-y-auto max-h-[max(2rem,min(30vh,calc(60vh-10rem)))] -mx-pad-lg px-lg",
				band: "-mx-pad-lg flex flex-col gap-xs px-lg bg-alpha-1 py-md",
				titleChain: [
					"flex items-start gap-xs min-w-0",
					"flex flex-1 min-w-0 flex-col gap-[2px]",
					"text-primary min-h-[24px] shrink-0 flex items-center gap-1",
				],
				titleRowInBand: true,
				body: ["gap-[24px]", "-mt-[18px]"],
				details: "flex flex-col gap-[12px] empty:hidden",
				detailsAreBodyChild: true,
				detailsText: ["Remove the build output", "$ rm -rf dist"],
			},
		);
	});

	it("paints the docked card as upstream's dock root: a sidebar backdrop child, 12px gaps, no presentation attribute", () =>
	{
		const look = ["bg-surface-2", "shadow-[var(--approval-card-shadow)]", "bg-surface-popover"];
		const {container} = render(
			<>
				<ApprovalCardShell
					presentation="dock"
					body={<span>Plan</span>}
					actions={<button type="button">Ok</button>}
				/>
				<WaitingForInputNotice />
			</>,
		);
		const has = (element: Element | null) => look.filter((name) => element?.classList.contains(name));
		const dock = container.querySelector<HTMLElement>("[data-approval-card-root]");
		expect(
			{
				presentation: dock?.getAttribute("data-approval-presentation") ?? null,
				// Upstream's root carries a literal p-[12px]; only the inline "card" presentation's rule lifts it to pad-lg.
				card: dock?.getAttribute("class"),
				backdrop: dock?.firstElementChild?.outerHTML,
				body: dock?.querySelector("[data-approval-card-body]")?.getAttribute("class"),
				notice: has(container.querySelector("[data-waiting-input-notice]")),
			},
		).toStrictEqual(
			{
				presentation: null,
				card: "epitaxy-approval-card @container relative isolate flex max-h-[60vh] flex-col rounded-card p-3 text-body text-primary origin-top focus-visible:outline-1 focus-visible:outline-fill-accent focus-visible:outline-offset-2 gap-[12px]",
				backdrop:
					'<div aria-hidden="true" data-surface="sidebar" class="absolute inset-0 -z-[1] rounded-[inherit] pointer-events-none bg-surface-2 shadow-[var(--approval-card-shadow)]"></div>',
				body: "epitaxy-scroll-clamp scroll-fade-y focus-visible:outline-hidden focus-visible:shadow-focus epitaxy-approval-body -mx-3 -mt-1 -mb-2 flex min-h-0 flex-col overflow-y-auto px-3 pt-1 pb-2 [&>*]:shrink-0 empty:hidden [&:has(~.epitaxy-approval-notices)]:shrink-[1000] [&:has(~.epitaxy-approval-notices)]:min-h-9 [&:has(~.epitaxy-approval-notices):has([data-approval-value])]:min-h-18 gap-[12px] overscroll-contain",
				notice: ["bg-surface-2", "shadow-[var(--approval-card-shadow)]"],
			},
		);
	});

	it("keeps the question and plan cards' shells without a title band", () =>
	{
		const {container} = render(
			<ApprovalCardShell
				presentation="card"
				body={<span>Plan</span>}
				actions={<button type="button">Ok</button>}
			/>,
		);
		const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		expect(
			{
				region: card.querySelector("[data-testid=approval-title-region]"),
				card: card.getAttribute("class"),
				body: card.querySelector("[data-approval-card-body]")?.getAttribute("class"),
			},
		).toStrictEqual(
			{
				region: null,
				card: "epitaxy-approval-card @container relative isolate flex max-h-[60vh] flex-col rounded-card p-lg text-body text-primary origin-top focus-visible:outline-1 focus-visible:outline-fill-accent focus-visible:outline-offset-2 card-ring w-full max-w-[480px] gap-[24px]",
				body: "epitaxy-scroll-clamp scroll-fade-y focus-visible:outline-hidden focus-visible:shadow-focus epitaxy-approval-body -mx-pad-lg -mt-1 -mb-2 flex min-h-0 flex-col overflow-y-auto px-lg pt-1 pb-2 [&>*]:shrink-0 empty:hidden [&:has(~.epitaxy-approval-notices)]:shrink-[1000] [&:has(~.epitaxy-approval-notices)]:min-h-9 [&:has(~.epitaxy-approval-notices):has([data-approval-value])]:min-h-18 gap-[24px]",
			},
		);
	});

	it("makes an overflowing body upstream's focusable 'Request details' group inside the card, and a fitting one plain", () =>
	{
		const callbacks: ResizeObserverCallback[] = [];
		vi.stubGlobal(
			"ResizeObserver",
			class
			{
				constructor(callback: ResizeObserverCallback)
				{
					callbacks.push(callback);
				}
				observe()
				{
				}
				unobserve()
				{
				}
				disconnect()
				{
				}
			},
		);
		const {container} = render(
			<ApprovalCardShell
				presentation="dock"
				body={<pre>{"line\n".repeat(80)}</pre>}
				actions={<button type="button">Ok</button>}
			/>,
		);
		const body = container.querySelector<HTMLElement>("[data-approval-card-body]")!;
		const fits = body.getAttribute("role");
		vi.spyOn(body, "scrollHeight", "get").mockReturnValue(1600);
		vi.spyOn(body, "clientHeight", "get").mockReturnValue(300);
		act(() =>
		{
			for (const callback of callbacks) callback([], {} as ResizeObserver);
		});
		const group = screen.getByRole(
			"group",
			{
				name: "Request details",
			},
		);
		expect(
			{
				fits,
				isBody: group === body,
				inCard: group.closest("[data-approval-card-root]") !== null,
				tabIndex: group.getAttribute("tabindex"),
			},
		).toStrictEqual(
			{
				fits: null,
				isBody: true,
				inCard: true,
				tabIndex: "0",
			},
		);
		vi.unstubAllGlobals();
	});

	it("makes the description and title band upstream's 'Description' and 'Request' scroll clamps, focusable only while they overflow", () =>
	{
		const callbacks: ResizeObserverCallback[] = [];
		vi.stubGlobal(
			"ResizeObserver",
			class
			{
				constructor(callback: ResizeObserverCallback)
				{
					callbacks.push(callback);
				}
				observe()
				{
				}
				unobserve()
				{
				}
				disconnect()
				{
				}
			},
		);
		const {container} = renderCard();
		const description = screen.getByText("Remove the build output");
		const region = container.querySelector<HTMLElement>("[data-testid=approval-title-region]")!;
		const attributes = (element: Element) => (
		{
			tabindex: element.getAttribute("tabindex"),
			role: element.getAttribute("role"),
			"aria-label": element.getAttribute("aria-label"),
			"data-fixed-code-size": element.getAttribute("data-fixed-code-size"),
		});
		const fits = [attributes(description), attributes(region)];
		for (const element of [description, region])
		{
			vi.spyOn(element, "scrollHeight", "get").mockReturnValue(160);
			vi.spyOn(element, "clientHeight", "get").mockReturnValue(57);
		}
		act(() =>
		{
			for (const callback of callbacks) callback([], {} as ResizeObserver);
		});
		expect(
			{
				fits,
				overflows: [attributes(description), attributes(region)],
				groups: [
					screen.getByRole(
						"group",
						{
							name: "Description",
						},
					) === description,
					screen.getByRole(
						"group",
						{
							name: "Request",
						},
					) === region,
				],
			},
		).toStrictEqual(
			{
				fits: [
					{
						tabindex: null,
						role: null,
						"aria-label": null,
						"data-fixed-code-size": "",
					},
					{
						tabindex: null,
						role: null,
						"aria-label": null,
						"data-fixed-code-size": "",
					},
				],
				overflows: [
					{
						tabindex: "0",
						role: "group",
						"aria-label": "Description",
						"data-fixed-code-size": "",
					},
					{
						tabindex: "0",
						role: "group",
						"aria-label": "Request",
						"data-fixed-code-size": "",
					},
				],
				groups: [true, true],
			},
		);
		vi.unstubAllGlobals();
	});

	it("draws a Bash command's description and time-limit note under the title band", () =>
	{
		const pending = findPendingPermission(
			{
				sessionId: "session-test-100",
				isActive: true,
				notifications: [permissionNotification()],
				records: [
					assistantToolUse(
						"t9",
						"Bash",
						{
							command: "ls",
							description: "List files",
							timeout: 120000,
						},
					),
				],
			},
		)!;
		const {container} = render(
			<PermissionCard
				title={pending.title}
				detail={pending.detail}
				detailLang={pending.detailLang ?? null}
				detailNote={pending.detailNote ?? null}
				description={pending.description ?? null}
				clampTitle={pending.clampTitle === true}
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);
		const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		const details = card.querySelector("[data-permission-detail]")?.parentElement;
		expect(
			{
				title: card.querySelector("[data-permission-title]")?.textContent,
				label: card.getAttribute("aria-label"),
				details: [...(details?.children ?? [])].map((child) => child.textContent),
			},
		).toStrictEqual(
			{
				title: "Allow Claude to run this command?",
				label: "Permission request: run this command",
				details: ["List files", "$ ls", "Time limit: 2 minutes."],
			},
		);
	});

	it("draws upstream's detail note under a background Bash command", () =>
	{
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "run",
					meta: "Start the dev server",
				}}
				detail="npm run dev"
				detailNote="Keeps running in the background."
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);
		const value = container.querySelector("[data-permission-detail]")!;
		const note = value.nextElementSibling;
		expect(
			{
				tag: note?.tagName,
				className: note?.getAttribute("class"),
				text: note?.textContent,
			},
		).toStrictEqual(
			{
				tag: "P",
				className: "text-footnote text-muted-as-secondary select-text break-words [unicode-bidi:plaintext]",
				text: "Keeps running in the background.",
			},
		);
	});

	it("draws a Workflow's description, upstream's token warning, whose background tasks pane link opens Background tasks, and its folded Script last", () =>
	{
		const open = vi.fn<() => void>();
		const {container} = render(
			<BackgroundTasksOpenerProvider
				value={
				{
					open,
					running: new Map(),
				}}
			>
				<PermissionCard
					title={
					{
						action: "run a workflow",
						meta: "noop-a",
					}}
					detail={null}
					description="Replies ok"
					tokenWarning
					folds={[
						{
							label: "Script",
							text: "export const meta = {name:'n'}\nrun()\n",
							lined: true,
						},
					]}
					canAnswer
					onDecision={async () =>
					{
					}}
				/>
			</BackgroundTasksOpenerProvider>,
		);
		const details = [...(container.querySelector("[data-approval-card-body] > div")?.children ?? [])];
		const script = screen.getByRole(
			"button",
			{
				name: "Script",
			},
		);
		expect(
			{
				details: details.map((element) => [element.getAttribute("class"), element.textContent]),
				expanded: script.getAttribute("aria-expanded"),
				lines: container.querySelectorAll("[data-line]").length,
			},
		).toStrictEqual(
			{
				details: [
					[
						"epitaxy-scroll-clamp scroll-fade-y focus-visible:outline-hidden focus-visible:shadow-focus text-body text-secondary select-text break-words max-h-[calc(3*var(--text-body--line-height))] overflow-y-auto scroll-fade-size-[calc(1*var(--text-body--line-height))] [unicode-bidi:plaintext]",
						"Replies ok",
					],
					[
						"rounded-lg bg-alpha-1 px-lg py-2.5 text-body text-secondary select-text break-words",
						"Dynamic workflows run many subagents in parallel and can use a lot of your usage limit. Stop them any time from the background tasks pane.",
					],
					["flow-root", "Script"],
				],
				expanded: "false",
				lines: 0,
			},
		);
		fireEvent.click(script);
		expect(
			[...container.querySelectorAll("[data-line]")].map((line) => [
				line.getAttribute("data-line"),
				line.textContent,
			]),
		).toStrictEqual([
			["1", "export const meta = {name:'n'}\n"],
			["2", "run()\n"],
		]);
		const backgroundTasksLink = screen.getByRole(
			"button",
			{
				name: "background tasks pane",
			},
		);
		expect([backgroundTasksLink.className, backgroundTasksLink.getAttribute("data-cds")]).toStrictEqual([
			"cds-reset text-link inline cursor-pointer",
			"TextLink",
		]);
		fireEvent.click(backgroundTasksLink);
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("hides the persistent option when the dialog has none", () =>
	{
		renderCard();
		expect(screen.getAllByRole("button").map((button) => button.textContent)).toStrictEqual([
			"Deny",
			"Allow onceCtrl⏎Enter",
		]);
	});

	it.each(["always", "perChat"] as const)(
		"leads with upstream's web Always allow split button, with no scope, for a %s option and sends the persistent decision",
		(persistentAllow) =>
		{
			const {onDecision} = renderCard(
				{
					persistentAllow,
				},
			);
			const persistent = screen.getByRole(
				"button",
				{
					name: "Always allow",
				},
			);
			const split = persistent.closest<HTMLElement>("[data-cds=SplitDropdownButton]");
			const labelSpan = persistent.querySelector<HTMLElement>("[data-approval-digit]");
			const facts =
			{
				buttons: screen
					.getAllByRole("button")
					.map((button) => button.getAttribute("aria-label") ?? button.textContent),
				group: split?.getAttribute("aria-label"),
				primaryFill: persistent.className.split(/\s+/).includes("bg-fill-primary"),
				labelData: labelSpan === null ? null : Object.fromEntries(Object.entries(labelSpan.dataset)),
				scope: [...persistent.querySelectorAll(".sr-only")].map((span) => [span.className, span.textContent]),
			};
			fireEvent.click(persistent);
			expect(
				{
					...facts,
					calls: onDecision.mock.calls,
				},
			).toStrictEqual(
				{
					buttons: ["Deny", "Always allow", "More allow options"],
					group: "Always allow",
					primaryFill: true,
					labelData:
					{
						approvalDigit: "2",
						approvalPrimary: "",
					},
					scope: [],
					calls: [["always"]],
				},
			);
		},
	);

	it("keeps Allow once in the split button's More allow options menu", async () =>
	{
		const {onDecision} = renderCard(
			{
				persistentAllow: "always",
			},
		);
		await actAndSettle(() =>
		{
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "More allow options",
					},
				),
			);
		});
		const items = screen.getAllByRole("menuitem");
		const facts =
		{
			items: items.map((item) => item.textContent),
			shortcut: items[0]?.getAttribute("aria-keyshortcuts"),
		};
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: /^Allow once/,
				},
			),
		);
		expect(
			{
				...facts,
				calls: onDecision.mock.calls,
			},
		).toStrictEqual(
			{
				items: ["Allow onceCtrl+Enter"],
				shortcut: "Control+Enter",
				calls: [["allow"]],
			},
		);
	});

	describe("leading-allow preference, as upstream's epitaxy-approval-card-leading-allow", () =>
	{
		afterEach(() =>
		{
			vi.useRealTimers();
		});

		it("leads with Allow once and keeps Always allow, with no description beside listed saves, in the menu when the stored lead is once", async () =>
		{
			localStorage.setItem(APPROVAL_LEADING_ALLOW_KEY, "once");
			const {onDecision} = renderCard(
				{
					persistentAllow: "always",
					saves: [
						{
							kind: "rule",
							toolName: "Bash",
						},
					],
				},
			);
			const primary = screen.getByRole(
				"button",
				{
					name: /^Allow once/,
				},
			);
			const labelSpan = primary.querySelector<HTMLElement>("[data-approval-digit]");
			const facts =
			{
				buttons: screen
					.getAllByRole("button")
					.map((button) => button.getAttribute("aria-label") ?? button.textContent),
				shortcut: primary.getAttribute("aria-keyshortcuts"),
				labelData: labelSpan === null ? null : Object.fromEntries(Object.entries(labelSpan.dataset)),
			};
			await actAndSettle(() =>
			{
				fireEvent.click(
					screen.getByRole(
						"button",
						{
							name: "More allow options",
						},
					),
				);
			});
			const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
			fireEvent.click(
				screen.getByRole(
					"menuitem",
					{
						name: /^Always allow/,
					},
				),
			);
			expect(
				{
					...facts,
					items,
					calls: onDecision.mock.calls,
					stored: localStorage.getItem(APPROVAL_LEADING_ALLOW_KEY),
				},
			).toStrictEqual(
				{
					buttons: ["Deny", "Allow onceCtrl⏎Enter", "More allow options"],
					shortcut: "Control+Enter",
					labelData:
					{
						approvalDigit: "2",
						approvalPrimary: "",
					},
					items: ["Always allow"],
					calls: [["always"]],
					stored: "always",
				},
			);
		});

		it("sends allow from the Allow once primary", () =>
		{
			localStorage.setItem(APPROVAL_LEADING_ALLOW_KEY, "once");
			const {onDecision} = renderCard(
				{
					persistentAllow: "always",
				},
			);
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: /^Allow once/,
					},
				),
			);
			expect(onDecision.mock.calls).toStrictEqual([["allow"]]);
		});

		it("stores once after Allow once is picked from an always-led menu, so the next card leads with it", async () =>
		{
			const first = renderCard(
				{
					persistentAllow: "always",
				},
			);
			await actAndSettle(() =>
			{
				fireEvent.click(
					screen.getByRole(
						"button",
						{
							name: "More allow options",
						},
					),
				);
			});
			fireEvent.click(
				screen.getByRole(
					"menuitem",
					{
						name: /^Allow once/,
					},
				),
			);
			const stored = localStorage.getItem(APPROVAL_LEADING_ALLOW_KEY);
			first.unmount();
			renderCard(
				{
					persistentAllow: "always",
				},
			);
			expect(
				{
					stored,
					buttons: screen
						.getAllByRole("button")
						.map((button) => button.getAttribute("aria-label") ?? button.textContent),
				},
			).toStrictEqual(
				{
					stored: "once",
					buttons: ["Deny", "Allow onceCtrl⏎Enter", "More allow options"],
				},
			);
		});

		it("leads with Always allow for an unknown stored value", () =>
		{
			localStorage.setItem(APPROVAL_LEADING_ALLOW_KEY, "sometimes");
			renderCard(
				{
					persistentAllow: "always",
				},
			);
			expect(screen.getAllByRole("button").map((button) => button.textContent)).toStrictEqual([
				"Deny",
				"Always allow",
				"",
			]);
		});

		/** Hovers the leading Always allow and reads the tooltip it opens. */
		function hoverAlwaysAllow()
		{
			const primary = screen.getByRole(
				"button",
				{
					name: "Always allow",
				},
			);
			vi.useFakeTimers();
			fireEvent.pointerEnter(primary.parentElement!);
			act(() =>
			{
				vi.advanceTimersByTime(300);
			});
			const describedBy = primary.getAttribute("aria-describedby");
			return {
				tooltips: screen.queryAllByRole("tooltip").map((tip) => tip.textContent),
				described: describedBy === null ? null : document.getElementById(describedBy)?.textContent,
			};
		}

		// Upstream's `Zr`: no scope tooltip once the saves block lists what the option adds (`Bn`).
		it.each(["always", "perChat"] as const)(
			"leaves the leading Always allow untipped for a %s option whose saves are listed, as upstream's web card",
			(persistentAllow) =>
			{
				renderCard(
					{
						persistentAllow,
						saves: [
							{
								kind: "rule",
								toolName: "Bash",
								ruleContent: "npm run *",
							},
						],
					},
				);
				expect(hoverAlwaysAllow()).toStrictEqual(
					{
						tooltips: [],
						described: null,
					},
				);
			},
		);

		// Upstream's `Zr` default when no saves are known: "Don’t ask again for this tool" (`AfvuXL`).
		it.each(["always", "perChat"] as const)(
			"tips the leading Always allow with upstream's scope for a %s option whose saves are unknown",
			(persistentAllow) =>
			{
				renderCard(
					{
						persistentAllow,
					},
				);
				expect(hoverAlwaysAllow()).toStrictEqual(
					{
						tooltips: ["Don’t ask again for this tool"],
						described: "Don’t ask again for this tool",
					},
				);
			},
		);

		it("describes the Always allow menu row with the scope only while the saves are unknown", async () =>
		{
			localStorage.setItem(APPROVAL_LEADING_ALLOW_KEY, "once");
			const descriptions = [];
			for (const saves of [
				null,
				[
					{
						kind: "rule",
						toolName: "Bash",
					},
				] as const,
			])
			{
				const {unmount} = renderCard(
					{
						persistentAllow: "always",
						saves,
					},
				);
				await actAndSettle(() =>
				{
					fireEvent.click(
						screen.getByRole(
							"button",
							{
								name: "More allow options",
							},
						),
					);
				});
				descriptions.push(
					screen.getByRole(
						"menuitem",
						{
							name: /^Always allow/,
						},
					).textContent,
				);
				unmount();
			}
			expect(descriptions).toStrictEqual(["Always allowDon’t ask again for this tool", "Always allow"]);
		});
	});

	describe("upstream's web saves block (cc32965c2 Zb, now wx)", () =>
	{
		const LEAD = "“Always allow” lasts for this session and covers:";
		const CODE = '<code class="text-code-medium break-all [unicode-bidi:plaintext]">';

		function renderSaves(
			saves: readonly PersistentAllowSave[] | null,
			persistentAllow: PersistentAllowKind | null = "always",
		)
		{
			const {container} = render(
				<PermissionCard
					title={
					{
						action: "run this command",
						meta: null,
					}}
					detail="npm run build"
					detailLang="bash"
					canAnswer
					persistentAllow={persistentAllow}
					persistentAllowSaves={saves}
					onDecision={async () =>
					{
					}}
				/>,
			);
			return container.querySelector("[data-testid=approval-always-allow-saves]");
		}

		it("lists one rule in a paragraph after the lead", () =>
		{
			expect(
				renderSaves([
					{
						kind: "rule",
						toolName: "Bash",
						ruleContent: "npm run *",
					},
				])?.outerHTML,
			).toStrictEqual(
				`<p data-testid="approval-always-allow-saves" class="text-body text-secondary select-text">${LEAD} ${CODE}Bash(npm run *)</code></p>`,
			);
		});

		it("says every use of a tool for a rule with no content", () =>
		{
			expect(
				renderSaves([
					{
						kind: "rule",
						toolName: "Read",
					},
				])?.outerHTML,
			).toStrictEqual(
				`<p data-testid="approval-always-allow-saves" class="text-body text-secondary select-text">${LEAD} every use of ${CODE}Read</code></p>`,
			);
		});

		it("lists two or more items under a labelled list, the mode as its own item", () =>
		{
			const block = renderSaves([
				{
					kind: "rule",
					toolName: "Bash",
					ruleContent: "echo a\nb",
				},
				{
					kind: "acceptEditsMode",
				},
			]);
			const id = block?.querySelector("span")?.id ?? "";
			expect(
				{
					id: id !== "",
					html: block?.outerHTML,
				},
			).toStrictEqual(
				{
					id: true,
					html:
						`<div data-testid="approval-always-allow-saves" class="flex flex-col gap-[6px] text-body text-secondary select-text">` +
						`<span id="${id}">${LEAD}</span>` +
						`<ul role="list" aria-labelledby="${id}" class="flex flex-col gap-[6px]">` +
						`<li>${CODE}Bash(echo a[U+000A]b)</code></li>` +
						"<li>Accept edits mode (file edits, and file commands such as rm and mv, in this session’s folders)</li>" +
						"</ul></div>",
				},
			);
		});

		it("keeps the lead over an empty list when nothing listable is saved", () =>
		{
			const block = renderSaves([]);
			const id = block?.querySelector("span")?.id ?? "";
			expect(block?.outerHTML).toStrictEqual(
				`<div data-testid="approval-always-allow-saves" class="flex flex-col gap-[6px] text-body text-secondary select-text">` +
					`<span id="${id}">${LEAD}</span>` +
					`<ul role="list" aria-labelledby="${id}" class="flex flex-col gap-[6px]"></ul></div>`,
			);
		});

		it.each([
			{
				name: "no persistent option",
				saves: [
					{
						kind: "acceptEditsMode",
					},
				] as const,
				persistentAllow: null,
			},
			{
				name: "no saves (an elicitation's verdict)",
				saves: null,
				persistentAllow: "always",
			},
		] as const)("draws nothing for $name", ({saves, persistentAllow}) =>
		{
			expect(renderSaves(saves, persistentAllow)).toBeNull();
		});

		it("draws nothing once a dialog without a persistent row drops the option", () =>
		{
			const {container} = render(
				<PermissionCard
					title={
					{
						action: "run this command",
						meta: null,
					}}
					detail="ls"
					canAnswer
					persistentAllow="always"
					persistentAllowSaves={[
						{
							kind: "acceptEditsMode",
						},
					]}
					dialog={
					{
						denyFirst: false,
						persistent: false,
						auto: false,
					}}
					onDecision={async () =>
					{
					}}
				/>,
			);
			expect(container.querySelector("[data-testid=approval-always-allow-saves]")).toBeNull();
		});

		it("follows a detail-first card's detail, its note and description", () =>
		{
			const {container} = render(
				<PermissionCard
					title={
					{
						action: "run this command",
						meta: null,
					}}
					detail="npm run build"
					detailLang="bash"
					detailFirst
					detailNote="Keeps running in the background."
					description="Build the app"
					canAnswer
					persistentAllow="always"
					persistentAllowSaves={[
						{
							kind: "rule",
							toolName: "Bash",
							ruleContent: "npm run *",
						},
					]}
					onDecision={async () =>
					{
					}}
				/>,
			);
			const body = container.querySelector("[data-testid=approval-always-allow-saves]")?.parentElement;
			expect(
				[...(body?.children ?? [])].map((child) =>
					child.hasAttribute("data-permission-detail")
						? "detail"
						: (child.getAttribute("data-testid") ?? child.textContent),
				),
			).toStrictEqual([
				"detail",
				"Keeps running in the background.",
				"Build the app",
				"approval-always-allow-saves",
			]);
		});

		it("leads a card whose detail comes last, sitting right before the detail", () =>
		{
			const {container} = render(
				<PermissionCard
					title={
					{
						action: "read",
						meta: "a.ts",
					}}
					detail="/repo/a.ts"
					canAnswer
					persistentAllow="always"
					persistentAllowSaves={[
						{
							kind: "rule",
							toolName: "Read",
						},
					]}
					onDecision={async () =>
					{
					}}
				/>,
			);
			const saves = container.querySelector("[data-testid=approval-always-allow-saves]");
			expect(saves?.nextElementSibling?.querySelector(":scope > [data-permission-detail]")?.textContent).toBe(
				"/repo/a.ts",
			);
		});
	});

	it("hides the card at once on a decision, before the answer resolves", async () =>
	{
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "run",
					meta: null,
				}}
				detail="ls"
				canAnswer
				onDecision={onDecision}
			/>,
		);
		paint();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Allow once/,
				},
			),
		);
		const hidden = container.querySelector("[data-approval-card-root]") === null;
		await actAndSettle(() =>
		{
			answer.resolve();
		});
		expect(
			{
				hidden,
				afterResolve: container.querySelector("[data-approval-card-root]") === null,
				calls: onDecision.mock.calls,
			},
		).toStrictEqual(
			{
				hidden: true,
				afterResolve: true,
				calls: [["allow"]],
			},
		);
	});

	it("persists the decision as acknowledged once the answer is delivered, and not before or on a refusal", async () =>
	{
		const answer = deferredAnswer();
		render(
			<PermissionCard
				title={
				{
					action: "run",
					meta: null,
				}}
				detail="ls"
				canAnswer
				sessionId="s-permission-ack"
				answerKey="toolu_permission_ack"
				onDecision={async () => answer.promise}
			/>,
		);
		paint();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Allow once/,
				},
			),
		);
		const sending = window.localStorage.getItem("acknowledged-tool-decisions");
		await actAndSettle(() =>
		{
			answer.resolve();
		});
		const stored: unknown = JSON.parse(window.localStorage.getItem("acknowledged-tool-decisions") ?? "null");
		clearApprovalAnswered("s-permission-ack", "toolu_permission_ack");
		releaseAnswered("s-permission-ack");

		const refused = deferredAnswer();
		render(
			<PermissionCard
				title={
				{
					action: "run",
					meta: null,
				}}
				detail="ls"
				canAnswer
				sessionId="s-permission-ack"
				answerKey="toolu_permission_refused"
				onDecision={async () => refused.promise}
			/>,
		);
		paint();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Deny",
				},
			),
		);
		await actAndSettle(() =>
		{
			refused.reject(new Error("herdr pane is gone"));
		});

		expect(
			{
				sending,
				stored,
				refused: isApprovalAnswered("s-permission-ack", "toolu_permission_refused"),
			},
		).toStrictEqual(
			{
				sending: null,
				stored:
				{
					"s-permission-ack":
					{
						toolu_permission_ack:
						{
							toolUseId: "toolu_permission_ack",
							toolName: "",
							acknowledgedAt: expect.any(Number) as number,
						},
					},
				},
				refused: false,
			},
		);
	});

	it("brings the card back with the error when the answer fails", async () =>
	{
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "run",
					meta: null,
				}}
				detail="ls"
				canAnswer
				onDecision={onDecision}
			/>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Deny",
				},
			),
		);
		await actAndSettle(() =>
		{
			answer.reject(new Error("herdr pane is gone"));
		});
		const card = container.querySelector("[data-approval-card-root]");
		expect(
			{
				shown: card !== null,
				error: card?.querySelector(".text-extended-pink")?.textContent,
				buttons: screen
					.getAllByRole("button")
					.map((button) => [button.textContent, button.hasAttribute("disabled")]),
				spinners: container.querySelectorAll(".animate-spin").length,
			},
		).toStrictEqual(
			{
				shown: true,
				error: "herdr pane is gone",
				buttons: [
					["Deny", false],
					["Allow onceCtrl⏎Enter", false],
				],
				spinners: 0,
			},
		);
	});

	it("keeps an elicitation card up after a decision, the chosen button busy, until its ElicitationResult unmounts it", async () =>
	{
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "use my-mcp-server",
					meta: null,
				}}
				detail={null}
				canAnswer
				hideOnDecision={false}
				onDecision={onDecision}
			/>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Deny",
				},
			),
		);
		const sending =
		{
			shown: container.querySelector("[data-approval-card-root]") !== null,
			buttons: heldButtons(),
		};
		await actAndSettle(() =>
		{
			answer.resolve();
		});
		expect(
			{
				sending,
				answered:
				{
					shown: container.querySelector("[data-approval-card-root]") !== null,
					buttons: heldButtons(),
				},
				calls: onDecision.mock.calls,
			},
		).toStrictEqual(
			{
				sending:
				{
					shown: true,
					buttons: [
						{
							text: "Deny",
							label: "Sending…",
							busy: "true",
							disabled: false,
						},
						{
							text: "Allow onceCtrl⏎Enter",
							label: null,
							busy: null,
							disabled: true,
						},
					],
				},
				answered:
				{
					shown: true,
					buttons: [
						{
							text: "Deny",
							label: "Sending…",
							busy: "true",
							disabled: false,
						},
						{
							text: "Allow onceCtrl⏎Enter",
							label: null,
							busy: null,
							disabled: true,
						},
					],
				},
				calls: [["deny"]],
			},
		);
	});

	it("marks Allow once busy after ⌘⏎ on a held elicitation card, and clears it when the answer fails", async () =>
	{
		vi.useFakeTimers(
			{
				toFake: ["performance"],
			},
		);
		try
		{
			const answer = deferredAnswer();
			const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
			render(
				<PermissionCard
					title={
					{
						action: "use my-mcp-server",
						meta: null,
					}}
					detail={null}
					canAnswer
					hideOnDecision={false}
					onDecision={onDecision}
				/>,
			);
			paint();
			vi.advanceTimersByTime(400);
			fireEvent.keyDown(
				document.body,
				{
					key: "Enter",
					metaKey: true,
				},
			);
			const sending = heldButtons();
			await actAndSettle(() =>
			{
				answer.reject(new Error("The terminal is not showing this elicitation"));
			});
			expect(
				{
					sending,
					failed: heldButtons(),
					calls: onDecision.mock.calls,
				},
			).toStrictEqual(
				{
					sending: [
						{
							text: "Deny",
							label: null,
							busy: null,
							disabled: true,
						},
						{
							text: "Allow onceCtrl⏎Enter",
							label: "Sending…",
							busy: "true",
							disabled: false,
						},
					],
					failed: [
						{
							text: "Deny",
							label: null,
							busy: null,
							disabled: false,
						},
						{
							text: "Allow onceCtrl⏎Enter",
							label: null,
							busy: null,
							disabled: false,
						},
					],
					calls: [["allow"]],
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("keeps an elicitation card up with the error when the terminal refuses the answer", async () =>
	{
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "use my-mcp-server",
					meta: null,
				}}
				detail={null}
				canAnswer
				hideOnDecision={false}
				onDecision={onDecision}
			/>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Deny",
				},
			),
		);
		await actAndSettle(() =>
		{
			answer.reject(new Error("The terminal is not showing this elicitation"));
		});
		const card = container.querySelector("[data-approval-card-root]");
		expect(
			{
				shown: card !== null,
				error: card?.querySelector(".text-extended-pink")?.textContent,
				buttons: screen
					.getAllByRole("button")
					.map((button) => [button.textContent, button.hasAttribute("disabled")]),
			},
		).toStrictEqual(
			{
				shown: true,
				error: "The terminal is not showing this elicitation",
				buttons: [
					["Deny", false],
					["Allow onceCtrl⏎Enter", false],
				],
			},
		);
	});

	it("buttons send their decisions", () =>
	{
		const {onDecision} = renderCard();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Allow once/,
				},
			),
		);
		expect(onDecision.mock.calls).toStrictEqual([["allow"]]);
	});

	describe("deny-first, as upstream's defaultToNo card (the classifier fallback's No-first dialog)", () =>
	{
		const DENY_FIRST =
		{
			denyFirst: true,
			persistent: false,
			auto: false,
		} as const;

		function actions()
		{
			const deny = screen.getByRole(
				"button",
				{
					name: /^Deny/,
				},
			);
			const allow = screen.getByRole(
				"button",
				{
					name: /^Allow once/,
				},
			);
			return {
				buttons: screen.getAllByRole("button").map((button) => button.textContent),
				denyData: Object.fromEntries(Object.entries(deny.dataset)),
				allowData: Object.fromEntries(Object.entries(allow.dataset)),
				denyShortcut: deny.getAttribute("aria-keyshortcuts"),
				allowShortcut: allow.getAttribute("aria-keyshortcuts"),
				allowKeys: allow.querySelectorAll("kbd").length,
				denyFill: deny.className.split(/\s+/).includes("bg-primary"),
				allowFill: allow.className.split(/\s+/).includes("bg-primary"),
			};
		}

		const denyFirstActions =
		{
			buttons: ["Deny", "Allow once"],
			denyData:
			{
				approvalVariant: "primary",
				approvalPrimary: "",
			},
			allowData:
			{
				approvalVariant: "secondary",
			},
			denyShortcut: null,
			allowShortcut: null,
			allowKeys: 0,
			denyFill: true,
			allowFill: false,
		};

		it.each([
			{
				name: "a deny-first dialog",
				dialog: DENY_FIRST,
			},
			{
				name: "a dialog whose shape is still unknown",
				dialog: "unknown",
			},
		] as const)("draws Deny primary and Allow once secondary with no keycap or split on $name", ({dialog}) =>
		{
			renderCard(
				{
					persistentAllow: "always",
					dialog,
				},
			);
			expect(actions()).toStrictEqual(denyFirstActions);
		});

		it("drops the persistent option the hook offered when the dialog on screen has no persistent row", () =>
		{
			renderCard(
				{
					persistentAllow: "always",
					dialog:
					{
						denyFirst: false,
						persistent: false,
						auto: true,
					},
				},
			);
			expect(screen.getAllByRole("button").map((button) => button.textContent)).toStrictEqual([
				"Deny",
				"Allow onceCtrl⏎Enter",
			]);
		});

		it("keeps the hook's persistent option when the dialog on screen has its row", () =>
		{
			renderCard(
				{
					persistentAllow: "always",
					dialog:
					{
						denyFirst: false,
						persistent: true,
						auto: false,
					},
				},
			);
			expect(
				screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent),
			).toStrictEqual(["Deny", "Always allow", "More allow options"]);
		});

		describe("keys", () =>
		{
			beforeEach(() =>
			{
				vi.useFakeTimers(
					{
						toFake: ["performance"],
					},
				);
			});
			afterEach(() =>
			{
				vi.useRealTimers();
			});

			it.each([
				{
					dialog: DENY_FIRST,
				},
				{
					dialog: "unknown",
				},
			] as const)("leaves ⌘⏎, ⇧⌘⏎ and Esc inert on $dialog, as upstream's vn", ({dialog}) =>
			{
				const {onDecision} = renderCard(
					{
						persistentAllow: "always",
						dialog,
					},
				);
				vi.advanceTimersByTime(400);
				fireEvent.keyDown(
					document.body,
					{
						key: "Enter",
						metaKey: true,
					},
				);
				fireEvent.keyDown(
					document.body,
					{
						key: "Enter",
						metaKey: true,
						shiftKey: true,
					},
				);
				fireEvent.keyDown(
					document.body,
					{
						key: "Escape",
					},
				);
				expect(onDecision.mock.calls).toStrictEqual([]);
			});

			it("redraws as the shape on screen once it arrives, with the split and ⌘⏎ back", () =>
			{
				const {onDecision, rerenderDialog} = renderCard(
					{
						persistentAllow: "always",
						dialog: "unknown",
					},
				);
				rerenderDialog(
					{
						denyFirst: false,
						persistent: true,
						auto: false,
					},
				);
				const buttons = screen
					.getAllByRole("button")
					.map((button) => button.getAttribute("aria-label") ?? button.textContent);
				vi.advanceTimersByTime(400);
				fireEvent.keyDown(
					document.body,
					{
						key: "Enter",
						metaKey: true,
					},
				);
				expect(
					{
						buttons,
						calls: onDecision.mock.calls,
					},
				).toStrictEqual(
					{
						buttons: ["Deny", "Always allow", "More allow options"],
						calls: [["allow"]],
					},
				);
			});
		});
	});

	describe("keys", () =>
	{
		beforeEach(() =>
		{
			vi.useFakeTimers(
				{
					toFake: ["performance"],
				},
			);
		});
		afterEach(() =>
		{
			vi.useRealTimers();
		});

		/** Moves past upstream's 400ms arm grace after the card mounts. */
		function arm()
		{
			vi.advanceTimersByTime(400);
		}

		it.each([
			{
				init:
				{
					key: "Escape",
				},
				decision: "deny",
			},
			{
				init:
				{
					key: "Enter",
					metaKey: true,
				},
				decision: "allow",
			},
		])("$init.key answers while nothing is focused", ({init, decision}) =>
		{
			const {onDecision} = renderCard();
			arm();
			fireEvent.keyDown(document.body, init);
			expect(onDecision.mock.calls).toStrictEqual([[decision]]);
		});

		describe("digits, as upstream's inline Fa", () =>
		{
			/** Dispatches a digit keydown on `target` (default: the focused element) and reports whether it was consumed. */
			function digit(key: string, target: Element = document.activeElement ?? document.body, repeat = false)
			{
				const event = new KeyboardEvent(
					"keydown",
					{
						key,
						repeat,
						bubbles: true,
						cancelable: true,
					},
				);
				target.dispatchEvent(event);
				return event.defaultPrevented;
			}
			const cardRoot = (container: HTMLElement) =>
				container.querySelector<HTMLElement>("[data-approval-card-root]")!;
			const composer = () =>
				screen.getByRole(
					"textbox",
					{
						name: "Prompt",
					},
				);

			it("denies on 1 and allows once on 2 with focus on the card, the body or the empty composer", () =>
			{
				const outcomes = ["card", "body", "composer"].flatMap((place) =>
					["1", "2"].map((key) =>
					{
						const {container, onDecision, unmount} = renderCard();
						if (place === "card") cardRoot(container).focus();
						if (place === "composer") composer().focus();
						arm();
						const prevented = digit(key);
						const outcome =
						{
							place,
							key,
							prevented,
							calls: onDecision.mock.calls,
						};
						unmount();
						return outcome;
					}),
				);
				expect(outcomes).toStrictEqual(
					["card", "body", "composer"].flatMap((place) => [
						{
							place,
							key: "1",
							prevented: true,
							calls: [["deny"]],
						},
						{
							place,
							key: "2",
							prevented: true,
							calls: [["allow"]],
						},
					]),
				);
			});

			it("with a persistent option, 2 is held (consumed, nothing) and 3 allows once; 4 is ignored", () =>
			{
				const {container, onDecision} = renderCard(
					{
						persistentAllow: "always",
					},
				);
				cardRoot(container).focus();
				arm();
				const four = digit("4");
				const two = digit("2");
				const callsAfterTwo = [...onDecision.mock.calls];
				const three = digit("3");
				expect(
					{
						four,
						two,
						callsAfterTwo,
						three,
						calls: onDecision.mock.calls,
					},
				).toStrictEqual(
					{
						four: false,
						two: true,
						callsAfterTwo: [],
						three: true,
						calls: [["allow"]],
					},
				);
			});

			it("leaves the persistent digit alone with focus on a card button of another digit", () =>
			{
				const {onDecision} = renderCard(
					{
						persistentAllow: "always",
					},
				);
				screen
					.getByRole(
						"button",
						{
							name: "Deny",
						},
					)
					.focus();
				arm();
				expect(
					{
						prevented: digit("2"),
						calls: onDecision.mock.calls,
					},
				).toStrictEqual(
					{
						prevented: false,
						calls: [],
					},
				);
			});

			it("leaves a digit inside the 400ms arm grace to the page, and swallows a repeat", () =>
			{
				const {onDecision} = renderCard();
				vi.advanceTimersByTime(100);
				const inGrace = digit("1");
				arm();
				const repeat = digit("1", document.body, true);
				expect(
					{
						inGrace,
						repeat,
						calls: onDecision.mock.calls,
					},
				).toStrictEqual(
					{
						inGrace: false,
						repeat: true,
						calls: [],
					},
				);
			});

			it("restarts the arm grace when focus enters the card from outside", () =>
			{
				const {container, onDecision} = renderCard();
				vi.advanceTimersByTime(1000);
				cardRoot(container).focus();
				const justEntered = digit("1");
				arm();
				const later = digit("1");
				expect(
					{
						justEntered,
						later,
						calls: onDecision.mock.calls,
					},
				).toStrictEqual(
					{
						justEntered: false,
						later: true,
						calls: [["deny"]],
					},
				);
			});

			it("lets a digit type into a composer draft, and ignores one from another field", () =>
			{
				const {container, onDecision} = renderCard();
				arm();
				const textarea = composer();
				fireEvent.change(
					textarea,
					{
						target:
						{
							value: "x",
						},
					},
				);
				textarea.focus();
				const draft = digit("2");
				const input = document.createElement("input");
				container.append(input);
				input.focus();
				const field = digit("2");
				expect(
					{
						draft,
						field,
						calls: onDecision.mock.calls,
					},
				).toStrictEqual(
					{
						draft: false,
						field: false,
						calls: [],
					},
				);
			});

			it("ignores a digit while a menu is open outside the card", () =>
			{
				const {container, onDecision} = renderCard();
				arm();
				const menu = document.createElement("div");
				menu.setAttribute("role", "menu");
				container.append(menu);
				expect(
					{
						prevented: digit("1", document.body),
						calls: onDecision.mock.calls,
					},
				).toStrictEqual(
					{
						prevented: false,
						calls: [],
					},
				);
			});

			it("ignores digits on a deny-first card", () =>
			{
				const {onDecision} = renderCard(
					{
						dialog: "unknown",
					},
				);
				arm();
				expect(
					{
						one: digit("1"),
						two: digit("2"),
						calls: onDecision.mock.calls,
					},
				).toStrictEqual(
					{
						one: false,
						two: false,
						calls: [],
					},
				);
			});
		});

		it("listens on window in the capture phase and stops the key there", () =>
		{
			const {onDecision} = renderCard();
			arm();
			const bubbled = vi.fn<(event: Event) => void>();
			document.addEventListener("keydown", bubbled);
			fireEvent.keyDown(
				document.body,
				{
					key: "Escape",
				},
			);
			document.removeEventListener("keydown", bubbled);
			expect(
				{
					calls: onDecision.mock.calls,
					bubbled: bubbled.mock.calls.length,
				},
			).toStrictEqual(
				{
					calls: [["deny"]],
					bubbled: 0,
				},
			);
		});

		it("denies on Esc at once after paint: Esc has no arm grace", () =>
		{
			const {onDecision} = renderCard();
			const early = fireEvent.keyDown(
				document.body,
				{
					key: "Escape",
				},
			);
			expect(
				{
					early,
					calls: onDecision.mock.calls,
				},
			).toStrictEqual(
				{
					early: false,
					calls: [["deny"]],
				},
			);
		});

		it("leaves ⌘⏎ inside the arm grace to the page, then allows at 400ms; a repeat is consumed", () =>
		{
			const {onDecision} = renderCard();
			vi.advanceTimersByTime(100);
			const later = vi.fn<(event: Event) => void>();
			window.addEventListener("keydown", later);
			const inGrace = new KeyboardEvent(
				"keydown",
				{
					key: "Enter",
					metaKey: true,
					bubbles: true,
					cancelable: true,
				},
			);
			document.body.dispatchEvent(inGrace);
			const callsInGrace = [...onDecision.mock.calls];
			vi.advanceTimersByTime(400);
			const repeat = new KeyboardEvent(
				"keydown",
				{
					key: "Enter",
					metaKey: true,
					repeat: true,
					bubbles: true,
					cancelable: true,
				},
			);
			document.body.dispatchEvent(repeat);
			const callsAfterRepeat = [...onDecision.mock.calls];
			fireEvent.keyDown(
				document.body,
				{
					key: "Enter",
					metaKey: true,
				},
			);
			window.removeEventListener("keydown", later);
			expect(
				{
					inGraceDefaultPrevented: inGrace.defaultPrevented,
					laterSawGracePress: later.mock.calls[0]?.[0] === inGrace,
					callsInGrace,
					repeatDefaultPrevented: repeat.defaultPrevented,
					callsAfterRepeat,
					calls: onDecision.mock.calls,
				},
			).toStrictEqual(
				{
					inGraceDefaultPrevented: false,
					laterSawGracePress: true,
					callsInGrace: [],
					repeatDefaultPrevented: true,
					callsAfterRepeat: [],
					calls: [["allow"]],
				},
			);
		});

		it("swallows repeated Esc and ⌘⏎", () =>
		{
			const {onDecision} = renderCard();
			arm();
			const results = [
				fireEvent.keyDown(
					document.body,
					{
						key: "Escape",
						repeat: true,
					},
				),
				fireEvent.keyDown(
					document.body,
					{
						key: "Enter",
						metaKey: true,
						repeat: true,
					},
				),
			];
			expect(
				{
					results,
					calls: onDecision.mock.calls,
				},
			).toStrictEqual(
				{
					results: [false, false],
					calls: [],
				},
			);
		});

		it("yields Esc and ⌘⏎ to IME composition, and ⌘⏎ to alt", () =>
		{
			const {onDecision} = renderCard();
			arm();
			fireEvent.keyDown(
				document.body,
				{
					key: "Escape",
					isComposing: true,
				},
			);
			fireEvent.keyDown(
				document.body,
				{
					key: "Enter",
					metaKey: true,
					isComposing: true,
				},
			);
			fireEvent.keyDown(
				document.body,
				{
					key: "Enter",
					metaKey: true,
					altKey: true,
				},
			);
			expect(onDecision.mock.calls).toStrictEqual([]);
		});

		it("answers from the empty composer", async () =>
		{
			const {onDecision} = renderCard();
			arm();
			const prompt = screen.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			);
			prompt.focus();
			await actAndSettle(() =>
			{
				fireEvent.keyDown(
					prompt,
					{
						key: "Enter",
						metaKey: true,
					},
				);
			});
			expect(onDecision.mock.calls).toStrictEqual([["allow"]]);
		});

		it("answers from the focused card", async () =>
		{
			const {container, onDecision} = renderCard();
			arm();
			const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
			card.focus();
			await actAndSettle(() =>
			{
				fireEvent.keyDown(
					card,
					{
						key: "Escape",
					},
				);
			});
			expect(onDecision.mock.calls).toStrictEqual([["deny"]]);
		});

		it("leaves ⌘⏎ to a composer draft", () =>
		{
			const {onDecision} = renderCard();
			arm();
			const prompt = screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			);
			fireEvent.change(
				prompt,
				{
					target:
					{
						value: "hello",
					},
				},
			);
			prompt.focus();
			const result = fireEvent.keyDown(
				prompt,
				{
					key: "Enter",
					metaKey: true,
				},
			);
			expect(
				{
					result,
					calls: onDecision.mock.calls,
				},
			).toStrictEqual(
				{
					result: true,
					calls: [],
				},
			);
		});

		it("yields Esc to an open composer popup", () =>
		{
			const {onDecision} = renderCard();
			arm();
			const prompt = screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			);
			prompt.setAttribute("aria-controls", "slash-menu");
			prompt.focus();
			fireEvent.keyDown(
				prompt,
				{
					key: "Escape",
				},
			);
			expect(onDecision.mock.calls).toStrictEqual([]);
		});

		it("ignores keys inside an open dialog", () =>
		{
			const {onDecision} = renderCard();
			arm();
			const dialog = document.createElement("div");
			dialog.setAttribute("role", "dialog");
			const button = document.createElement("button");
			dialog.append(button);
			document.body.append(dialog);
			button.focus();
			fireEvent.keyDown(
				button,
				{
					key: "Escape",
				},
			);
			fireEvent.keyDown(
				button,
				{
					key: "Enter",
					metaKey: true,
				},
			);
			dialog.remove();
			expect(onDecision.mock.calls).toStrictEqual([]);
		});

		it.each([
			{
				focus: "body",
				calls: [],
			},
			{
				focus: "card",
				calls: [["always"]],
			},
			{
				focus: "composer",
				calls: [["always"]],
			},
		] as const)("sends the persistent grant on ⇧⌘⏎ with focus on the $focus: $calls", async ({focus, calls}) =>
		{
			const {container, onDecision} = renderCard(
				{
					persistentAllow: "always",
				},
			);
			arm();
			const target =
			{
				body: document.body,
				card: container.querySelector<HTMLElement>("[data-approval-card-root]")!,
				composer: screen.getByRole(
					"textbox",
					{
						name: "Prompt",
					},
				),
			}[focus];
			target.focus();
			await actAndSettle(() =>
			{
				fireEvent.keyDown(
					target,
					{
						key: "Enter",
						metaKey: true,
						shiftKey: true,
					},
				);
			});
			expect(onDecision.mock.calls).toStrictEqual(calls);
		});

		it("ignores ⇧⌘⏎ without a persistent option", () =>
		{
			const {container, onDecision} = renderCard();
			arm();
			const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
			card.focus();
			fireEvent.keyDown(
				card,
				{
					key: "Enter",
					metaKey: true,
					shiftKey: true,
				},
			);
			expect(onDecision.mock.calls).toStrictEqual([]);
		});

		it("disables the buttons and keys without a writable live pane", () =>
		{
			const {onDecision} = renderCard(
				{
					canAnswer: false,
				},
			);
			arm();
			fireEvent.keyDown(
				document.body,
				{
					key: "Escape",
				},
			);
			expect(
				{
					calls: onDecision.mock.calls,
					allowDisabled: screen.getByRole<HTMLButtonElement>(
						"button",
						{
							name: /^Allow once/,
						},
					).disabled,
					hint: screen.getByText("Answer in the terminal").textContent,
				},
			).toStrictEqual(
				{
					calls: [],
					allowDisabled: true,
					hint: "Answer in the terminal",
				},
			);
		});
	});

	describe("card root", () =>
	{
		const focusedLabel = () =>
			document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent;

		it("roams the buttons with the arrow keys, wrapping at both ends", () =>
		{
			const {container} = renderCard();
			const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
			const deny = screen.getByRole(
				"button",
				{
					name: "Deny",
				},
			);
			deny.focus();
			const seen: Array<string | null | undefined> = [];
			for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"])
			{
				fireEvent.keyDown(
					document.activeElement ?? card,
					{
						key,
					},
				);
				seen.push(focusedLabel());
			}
			expect(seen).toStrictEqual([
				"Allow onceCtrl⏎Enter",
				"Deny",
				"Allow onceCtrl⏎Enter",
				"Deny",
				"Allow onceCtrl⏎Enter",
			]);
		});

		it("enters the card from its root: arrows start at an end, Enter focuses the primary", () =>
		{
			const {container} = renderCard(
				{
					persistentAllow: "always",
				},
			);
			const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
			const seen: Array<string | null | undefined> = [];
			card.focus();
			fireEvent.keyDown(
				card,
				{
					key: "ArrowRight",
				},
			);
			seen.push(focusedLabel());
			card.focus();
			fireEvent.keyDown(
				card,
				{
					key: "ArrowLeft",
				},
			);
			seen.push(focusedLabel());
			card.focus();
			fireEvent.keyDown(
				card,
				{
					key: "Enter",
				},
			);
			seen.push(focusedLabel());
			expect(seen).toStrictEqual(["Deny", "More allow options", "Always allow"]);
		});

		it("keeps clicks inside the card from reaching the transcript", () =>
		{
			const {container} = renderCard();
			const outer = vi.fn<(event: Event) => void>();
			document.addEventListener("click", outer);
			fireEvent.click(container.querySelector("[data-permission-detail]")!);
			document.removeEventListener("click", outer);
			expect(outer.mock.calls.length).toStrictEqual(0);
		});
	});
});

describe("PermissionCard enter fade, as upstream's epitaxy-approval-inline-enter", () =>
{
	const enterFacts = (container: HTMLElement) =>
	{
		const root = container.querySelector("[data-approval-card-root]");
		return {
			classes: (root?.className ?? "").split(" ").filter((name) => name.includes("animate-")),
			skip: root?.hasAttribute("data-skip-approval-enter"),
		};
	};

	it("fades a live arrival in, without motion under reduced motion", () =>
	{
		const {container} = render(
			<PermissionCard
				enterKey="enter-live-1"
				title={
				{
					action: "run",
					meta: null,
				}}
				detail="ls"
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);

		expect(enterFacts(container)).toStrictEqual(
			{
				classes: ["animate-approval-inline-enter", "motion-reduce:animate-none"],
				skip: false,
			},
		);
	});

	it("skips the fade when the same prompt remounts", () =>
	{
		const card = () => (
			<PermissionCard
				enterKey="enter-remount-1"
				title={
				{
					action: "run",
					meta: null,
				}}
				detail="ls"
				canAnswer
				onDecision={async () =>
				{
				}}
			/>
		);
		render(card()).unmount();
		const {container} = render(card());

		expect(enterFacts(container)).toStrictEqual(
			{
				classes: [],
				skip: true,
			},
		);
	});

	it("skips the fade after a reload that already showed the prompt", () =>
	{
		window.sessionStorage.setItem("approval-enter-seen:enter-reload-1", "1");
		const {container} = render(
			<PermissionCard
				enterKey="enter-reload-1"
				title={
				{
					action: "run",
					meta: null,
				}}
				detail="ls"
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);

		expect(enterFacts(container)).toStrictEqual(
			{
				classes: [],
				skip: true,
			},
		);
	});
});

/**
 * The session page's permission slot: the card keyed by the prompt's answer
 * key, and the gates that treat an answered prompt as consumed.
 */
function PermissionSlot({
	sessionId,
	notifications,
	records,
	awaitingPermission,
	onDecision,
}: {
	sessionId: string;
	notifications: readonly PermissionNotification[];
	records: readonly unknown[];
	awaitingPermission: boolean;
	onDecision: ComponentProps<typeof PermissionCard>["onDecision"];
})
{
	const shown = findPendingPermission(
		{
			sessionId,
			isActive: true,
			notifications,
			records,
			awaitingPermission,
		},
	);
	const answerKey = shown === null ? null : permissionAnswerKey(shown);
	const answered = useApprovalAnswered(sessionId, answerKey);
	const pending = answered ? null : shown;
	return (
		<div data-gate={pending === null ? "released" : "pending"}>
			{shown !== null && answerKey !== null && (
				<PermissionCard
					key={answerKey}
					enterKey={answerKey}
					sessionId={sessionId}
					answerKey={answerKey}
					title={shown.title}
					detail={shown.detail}
					canAnswer
					onDecision={onDecision}
				/>
			)}
		</div>
	);
}

describe("permission prompt answered across a signal handoff", () =>
{
	const records = [
		assistantToolUse(
			"toolu_handoff_1",
			"Bash",
			{
				command: "ls",
				description: "List",
			},
		),
	];
	// Answering arms a module-level session hold that would leak into other files in the shared pool.
	afterEach(() =>
	{
		for (const sessionId of ["session-handoff-2", "session-handoff-3", "session-handoff-4"])
			releaseAnswered(sessionId);
	});

	it("names the tool call the prompt holds, whichever signal describes it", () =>
	{
		const signals =
		{
			sessionId: "session-test-100",
			isActive: true,
			records,
		};
		expect(
			{
				notified: findPendingPermission(
					{
						...signals,
						notifications: [permissionNotification()],
					},
				)?.toolUseId,
				registryOnly: findPendingPermission(
					{
						...signals,
						notifications: [],
						awaitingPermission: true,
					},
				)?.toolUseId,
				noCall: findPendingPermission(
					{
						...signals,
						records: [],
						notifications: [permissionNotification()],
					},
				)?.toolUseId,
			},
		).toStrictEqual(
			{
				notified: "toolu_handoff_1",
				registryOnly: "toolu_handoff_1",
				noCall: null,
			},
		);
	});

	it("keeps an answered card hidden when the notification clears before the tool result lands", () =>
	{
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const props =
		{
			sessionId: "session-handoff-2",
			records,
			awaitingPermission: true,
			onDecision,
		};
		const notification = permissionNotification(
			{
				sessionId: "session-handoff-2",
			},
		);
		const {container, rerender} = render(<PermissionSlot {...props} notifications={[notification]} />);
		paint();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Allow once/,
				},
			),
		);
		const gateAtClick = container.querySelector("[data-gate]")?.getAttribute("data-gate");
		rerender(<PermissionSlot {...props} notifications={[]} />);

		expect(
			{
				gateAtClick,
				card: container.querySelector("[data-approval-card-root]"),
				gate: container.querySelector("[data-gate]")?.getAttribute("data-gate"),
				calls: onDecision.mock.calls,
			},
		).toStrictEqual(
			{
				gateAtClick: "released",
				card: null,
				gate: "released",
				calls: [["allow"]],
			},
		);
	});

	it("keeps one card node and fades it in once when the notification follows the registry wait", () =>
	{
		const notification = permissionNotification(
			{
				sessionId: "session-handoff-3",
			},
		);
		// Its own call id: the enter fade is remembered per prompt for the whole tab.
		const fadeRecords = [
			assistantToolUse(
				"toolu_handoff_3",
				"Bash",
				{
					command: "ls",
					description: "List",
				},
			),
		];
		const props =
		{
			sessionId: "session-handoff-3",
			records: fadeRecords,
			awaitingPermission: true,
			onDecision: async () =>
			{
			},
		};
		const {container, rerender} = render(<PermissionSlot {...props} notifications={[]} />);
		const first = container.querySelector("[data-approval-card-root]");
		const firstEnters = first?.className.includes("animate-approval-inline-enter");
		rerender(<PermissionSlot {...props} notifications={[notification]} />);
		const second = container.querySelector("[data-approval-card-root]");

		expect(
			{
				sameNode: first !== null && first === second,
				firstEnters,
				secondEnters: second?.className.includes("animate-approval-inline-enter"),
			},
		).toStrictEqual(
			{
				sameNode: true,
				firstEnters: true,
				secondEnters: true,
			},
		);
	});

	it("clears the answered mark and shows the error when the decision is rejected", async () =>
	{
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const notification = permissionNotification(
			{
				sessionId: "session-handoff-4",
			},
		);
		const {container} = render(
			<PermissionSlot
				sessionId="session-handoff-4"
				notifications={[notification]}
				records={records}
				awaitingPermission
				onDecision={onDecision}
			/>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Deny",
				},
			),
		);
		const markedAtClick = isApprovalAnswered("session-handoff-4", "toolu_handoff_1");
		await actAndSettle(() =>
		{
			answer.reject(new Error("herdr pane is gone"));
		});

		expect(
			{
				markedAtClick,
				marked: isApprovalAnswered("session-handoff-4", "toolu_handoff_1"),
				gate: container.querySelector("[data-gate]")?.getAttribute("data-gate"),
				error: container.querySelector("[data-approval-card-root] .text-extended-pink")?.textContent,
			},
		).toStrictEqual(
			{
				markedAtClick: true,
				marked: false,
				gate: "pending",
				error: "herdr pane is gone",
			},
		);
	});
});

describe("PermissionCard after a landing", () =>
{
	beforeEach(() =>
	{
		vi.useFakeTimers(
			{
				toFake: ["performance"],
			},
		);
	});
	afterEach(() =>
	{
		clearLanding(window);
		vi.useRealTimers();
	});

	function landOn(root: HTMLElement)
	{
		root.focus();
		recordLanding(
			window,
			{
				at: root,
				onCard: true,
				from: root.parentElement!,
				drawn: () => (
				{
					chordActsAnywhere: false,
					toComposer: () => undefined,
				}),
			},
		);
	}

	it("refuses ⇧⌘⏎ on a card focus landed on, as upstream's landing keys, but ⌘⏎ still allows once", () =>
	{
		const {container, onDecision} = renderCard(
			{
				persistentAllow: "always",
			},
		);
		const root = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		vi.advanceTimersByTime(400);
		landOn(root);
		vi.advanceTimersByTime(600);
		const shifted = fireEvent.keyDown(
			root,
			{
				key: "Enter",
				metaKey: true,
				shiftKey: true,
			},
		);
		const afterShifted = onDecision.mock.calls.length;
		fireEvent.keyDown(
			root,
			{
				key: "Enter",
				metaKey: true,
			},
		);
		expect(
			{
				shifted,
				afterShifted,
				calls: onDecision.mock.calls,
			},
		).toStrictEqual(
			{
				shifted: false,
				afterShifted: 0,
				calls: [["allow"]],
			},
		);
	});

	it("swallows a digit on a card focus landed on until a fresh pick, as the question card's landing guard", () =>
	{
		const {container, onDecision} = renderCard();
		const root = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		vi.advanceTimersByTime(400);
		landOn(root);
		vi.advanceTimersByTime(600);
		// jsdom's events are untrusted, so none is a fresh pick.
		const consumed = !fireEvent.keyDown(
			root,
			{
				key: "1",
			},
		);
		expect(
			{
				consumed,
				calls: onDecision.mock.calls,
			},
		).toStrictEqual(
			{
				consumed: true,
				calls: [],
			},
		);
	});

	it("acts on ⇧⌘⏎ with focus in the card when nothing landed", () =>
	{
		const {container, onDecision} = renderCard(
			{
				persistentAllow: "always",
			},
		);
		const root = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		vi.advanceTimersByTime(400);
		root.focus();
		fireEvent.keyDown(
			root,
			{
				key: "Enter",
				metaKey: true,
				shiftKey: true,
			},
		);
		expect(onDecision.mock.calls).toStrictEqual([["always"]]);
	});
});

describe("PermissionCard read gates", () =>
{
	const ROWS_HINT = "Scroll to the end to allow this.";
	const COMMAND_HINT = "Scroll through the whole command to allow it.";
	const HINT_CLASS =
		"epitaxy-approval-read-hint text-footnote text-muted-as-secondary text-end text-balance @max-[420px]:text-center";

	interface Box
	{
		top: number;
		height: number;
		scrollTop?: number;
		scrollHeight?: number;
		clientHeight?: number;
	}

	const boxes = new Map<Element, Box>();
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;

	/** Lays the element out at `box` (later calls update it); unplaced elements have an empty rect, which counts as seen. */
	function place(element: Element, box: Box)
	{
		const known = boxes.get(element);
		if (known !== undefined)
		{
			Object.assign(known, box);
			return;
		}
		boxes.set(
			element,
			{
				...box,
			},
		);
		for (const key of ["scrollTop", "scrollHeight", "clientHeight"] as const)
		{
			Object.defineProperty(
				element,
				key,
				{
					configurable: true,
					get: () =>
					{
						const current = boxes.get(element)!;
						return current[key] ?? (key === "scrollTop" ? 0 : current.height);
					},
				},
			);
		}
	}

	beforeEach(() =>
	{
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rect(this: Element)
		{
			const box = boxes.get(this);
			return DOMRect.fromRect(
				{
					x: 0,
					y: box?.top ?? 0,
					width: 400,
					height: box?.height ?? 0,
				},
			);
		});
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
		{
			nextFrame += 1;
			frames.set(nextFrame, callback);
			return nextFrame;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) =>
		{
			frames.delete(id);
		});
	});

	afterEach(() =>
	{
		boxes.clear();
		frames.clear();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	async function flushFrames(count = 2)
	{
		for (let index = 0; index < count; index++)
		{
			const due = [...frames.values()];
			frames.clear();
			await act(async () =>
			{
				for (const callback of due) callback(0);
				await Promise.resolve();
			});
		}
	}

	function scroll()
	{
		act(() =>
		{
			fireEvent.scroll(document);
		});
	}

	function resize()
	{
		act(() =>
		{
			fireEvent(window, new Event("resize"));
		});
	}

	type CardProps = Partial<ComponentProps<typeof PermissionCard>>;

	const ROWS_CARD: CardProps =
	{
		title:
		{
			action: "run an agent",
			meta: null,
		},
		detail: null,
		description: "Find x",
		rows: [
			{
				label: "Prompt",
				value: "Look",
				clampLines: 6,
			},
		],
		rowsTrail: true,
		rowsGate: true,
	};

	/** Renders the card inside a transcript scroller (19px lines), as the session page draws it. */
	function renderCard(props: CardProps = ROWS_CARD)
	{
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => {});
		const card = (overrides: CardProps = {}) => (
			<div
				data-testid="transcript"
				style={
				{
					overflowY: "auto",
					lineHeight: "19px",
				}}
			>
				<PermissionCard
					title={
					{
						action: "run this command",
						meta: null,
					}}
					detail={null}
					canAnswer
					onDecision={onDecision}
					{...props}
					{...overrides}
				/>
			</div>
		);
		const utils = render(card());
		const transcript = screen.getByTestId("transcript");
		return {
			...utils,
			onDecision,
			transcript,
			rerenderWith: (overrides: CardProps) =>
			{
				utils.rerender(card(overrides));
			},
		};
	}

	const allowButton = () =>
		screen.getByRole(
			"button",
			{
				name: /^Allow once/,
			},
		);
	const hint = (container: HTMLElement) => container.querySelector("[data-testid=approval-read-hint]");
	const rowsPanel = (container: HTMLElement) =>
		container.querySelector<HTMLElement>("[data-testid=approval-read-rows]")!;
	const state = (container: HTMLElement) => (
	{
		disabled: allowButton().hasAttribute("disabled"),
		hint: hint(container)?.textContent ?? null,
		hintHidden: hint(container)?.classList.contains("invisible") ?? null,
	});

	/** A rows card whose transcript scrolls (900 of content in 300), with the panel's end below the window. */
	function renderOverflowingRows(props: CardProps = ROWS_CARD)
	{
		const view = renderCard(props);
		place(
			view.transcript,
			{
				top: 0,
				height: 300,
				scrollHeight: 900,
			},
		);
		place(
			rowsPanel(view.container),
			{
				top: 0,
				height: 900,
			},
		);
		scroll();
		return view;
	}

	describe("rows gate", () =>
	{
		it("marks upstream's wrapper, and holds Allow with the hint above the actions until the panel's end has been seen for two frames", async () =>
		{
			const {container} = renderOverflowingRows();
			const panelGate = rowsPanel(container);
			await flushFrames();
			const held =
			{
				...state(container),
				attribute: panelGate.getAttribute("data-approval-read-rows"),
				className: hint(container)?.className,
				hintAriaHidden: hint(container)?.getAttribute("aria-hidden"),
				beforeActions:
					hint(container)?.nextElementSibling === container.querySelector("[data-approval-card-actions]"),
				clamped: panelGate.querySelector("[data-approval-value]")?.classList.contains("line-clamp-6"),
				panel: panelGate.firstElementChild?.hasAttribute("data-permission-rows-panel"),
			};
			place(
				panelGate,
				{
					top: -600,
					height: 900,
				},
			);
			scroll();
			const waiting = state(container);
			await flushFrames();
			expect(
				{
					held,
					waiting,
					read: state(container),
				},
			).toStrictEqual(
				{
					held:
					{
						disabled: true,
						hint: ROWS_HINT,
						hintHidden: false,
						attribute: "",
						className: HINT_CLASS,
						hintAriaHidden: "true",
						beforeActions: true,
						clamped: false,
						panel: true,
					},
					waiting:
					{
						disabled: true,
						hint: ROWS_HINT,
						hintHidden: false,
					},
					read:
					{
						disabled: false,
						hint: ROWS_HINT,
						hintHidden: true,
					},
				},
			);
		});

		it("drops a sighting when the panel reflows between the latch's two frames", async () =>
		{
			const {container} = renderOverflowingRows();
			await flushFrames();
			const panelGate = rowsPanel(container);
			place(
				panelGate,
				{
					top: -600,
					height: 900,
				},
			);
			scroll();
			await flushFrames(1);
			place(
				panelGate,
				{
					top: -600,
					height: 900,
					scrollHeight: 905,
				},
			);
			await flushFrames(1);
			expect(state(container)).toStrictEqual(
				{
					disabled: true,
					hint: ROWS_HINT,
					hintHidden: false,
				},
			);
		});

		it("does not count an end the transcript scroller clips", async () =>
		{
			const {container, transcript} = renderOverflowingRows();
			await flushFrames();
			place(
				transcript,
				{
					top: 0,
					height: 260,
					scrollHeight: 900,
				},
			);
			place(
				rowsPanel(container),
				{
					top: -600,
					height: 900,
				},
			);
			scroll();
			await flushFrames();
			expect(state(container)).toStrictEqual(
				{
					disabled: true,
					hint: ROWS_HINT,
					hintHidden: false,
				},
			);
		});

		it("looks for the head line below the panel's top padding", async () =>
		{
			const {container, transcript} = renderOverflowingRows();
			const panelGate = rowsPanel(container);
			panelGate.querySelector<HTMLElement>("[data-permission-rows-panel]")!.style.paddingTop = "8px";
			place(
				panelGate.querySelector("li")!,
				{
					top: 10,
					height: 19,
				},
			);
			place(
				panelGate,
				{
					top: -600,
					height: 900,
				},
			);
			scroll();
			await flushFrames();
			// Only the panel's top 20px show: its padding and part of the head line.
			place(
				panelGate,
				{
					top: 0,
					height: 900,
				},
			);
			place(
				transcript,
				{
					top: -100,
					height: 120,
					scrollHeight: 900,
				},
			);
			scroll();
			await flushFrames();
			const headClipped = state(container).disabled;
			place(
				transcript,
				{
					top: -100,
					height: 130,
					scrollHeight: 900,
				},
			);
			scroll();
			await flushFrames();
			expect(
				{
					headClipped,
					headShown: state(container).disabled,
				},
			).toStrictEqual(
				{
					headClipped: true,
					headShown: false,
				},
			);
		});

		it("keeps a loose gate enforced once the body overflowed, even after it grows to fit", async () =>
		{
			const {container, transcript} = renderOverflowingRows();
			await flushFrames();
			place(
				transcript,
				{
					top: 0,
					height: 900,
					scrollHeight: 900,
				},
			);
			resize();
			expect(state(container)).toStrictEqual(
				{
					disabled: true,
					hint: ROWS_HINT,
					hintHidden: false,
				},
			);
		});

		it("starts unread again when the card moves between the card and the dock", async () =>
		{
			const {container, rerenderWith} = renderOverflowingRows();
			await flushFrames();
			place(
				rowsPanel(container),
				{
					top: -600,
					height: 900,
				},
			);
			scroll();
			await flushFrames();
			const read = state(container).disabled;
			rerenderWith(
				{
					presentation: "dock",
				},
			);
			place(
				rowsPanel(container),
				{
					top: 0,
					height: 900,
				},
			);
			scroll();
			await flushFrames();
			expect(
				{
					read,
					moved: state(container).disabled,
				},
			).toStrictEqual(
				{
					read: false,
					moved: true,
				},
			);
		});

		it("swallows ⌘⏎ for 400ms after the gate releases, the window sliding to each press, as upstream's onceLive", async () =>
		{
			vi.useFakeTimers(
				{
					toFake: ["performance"],
				},
			);
			const {container, onDecision} = renderOverflowingRows();
			await flushFrames();
			vi.advanceTimersByTime(1000);
			place(
				rowsPanel(container),
				{
					top: -600,
					height: 900,
				},
			);
			scroll();
			await flushFrames();
			const released = state(container).disabled;
			const chord = () =>
			{
				fireEvent.keyDown(
					document.body,
					{
						key: "Enter",
						metaKey: true,
					},
				);
				return onDecision.mock.calls.length;
			};
			vi.advanceTimersByTime(300);
			const at300 = chord();
			vi.advanceTimersByTime(300);
			const at600 = chord();
			// 300+400 has passed, but the press at 600 slid the window to 1000.
			vi.advanceTimersByTime(399);
			const at999 = chord();
			vi.advanceTimersByTime(400);
			const at1399 = chord();
			expect(
				{
					released,
					at300,
					at600,
					at999,
					at1399,
					calls: onDecision.mock.calls,
				},
			).toStrictEqual(
				{
					released: false,
					at300: 0,
					at600: 0,
					at999: 0,
					at1399: 1,
					calls: [["allow"]],
				},
			);
		});

		it("consumes 2 with no action while held, and for 400ms after the gate releases (upstream's rearm key), while 1 still denies", async () =>
		{
			vi.useFakeTimers(
				{
					toFake: ["performance"],
				},
			);
			const {container, onDecision, unmount} = renderOverflowingRows();
			await flushFrames();
			vi.advanceTimersByTime(1000);
			const digit = (key: string) =>
				!fireEvent.keyDown(
					document.body,
					{
						key,
					},
				);
			const root = container
				.querySelector("[data-approval-card-root]")
				?.getAttribute("data-approval-card-digits");
			const held = digit("2");
			const callsWhileHeld = [...onDecision.mock.calls];
			place(
				rowsPanel(container),
				{
					top: -600,
					height: 900,
				},
			);
			scroll();
			await flushFrames();
			vi.advanceTimersByTime(300);
			const rearmed = digit("2");
			const callsWhileRearmed = [...onDecision.mock.calls];
			// The press at 300 slid the window to 700.
			vi.advanceTimersByTime(399);
			const slid = digit("2");
			vi.advanceTimersByTime(400);
			digit("2");
			const callsAfterRearm = [...onDecision.mock.calls];
			unmount();
			const {onDecision: denied} = renderOverflowingRows();
			await flushFrames();
			vi.advanceTimersByTime(1000);
			digit("1");
			expect(
				{
					root,
					held,
					callsWhileHeld,
					rearmed,
					callsWhileRearmed,
					slid,
					callsAfterRearm,
					denied: denied.mock.calls,
				},
			).toStrictEqual(
				{
					root: "2",
					held: true,
					callsWhileHeld: [],
					rearmed: true,
					callsWhileRearmed: [],
					slid: true,
					callsAfterRearm: [["allow"]],
					denied: [["deny"]],
				},
			);
		});

		it("swallows ⌘⏎ while held and repeats the hint in a polite live region, but Deny still works", () =>
		{
			vi.useFakeTimers(
				{
					toFake: ["performance"],
				},
			);
			const {container, onDecision} = renderOverflowingRows();
			vi.advanceTimersByTime(400);
			const chord = () =>
			{
				fireEvent.keyDown(
					document.body,
					{
						key: "Enter",
						metaKey: true,
					},
				);
			};
			chord();
			const live = () => container.querySelector("p[aria-live=polite]");
			const first =
			{
				calls: [...onDecision.mock.calls],
				text: live()?.textContent,
				className: live()?.className,
			};
			chord();
			const second = live()?.textContent;
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Deny",
					},
				),
			);
			expect(
				{
					first,
					second,
					calls: onDecision.mock.calls,
				},
			).toStrictEqual(
				{
					first:
					{
						calls: [],
						text: ROWS_HINT,
						className: "sr-only",
					},
					second: `${ROWS_HINT} `,
					calls: [["deny"]],
				},
			);
		});

		it("leaves a loose gate whose rows fit unenforced: Allow is live and no hint mounts", () =>
		{
			const view = renderCard();
			place(
				view.transcript,
				{
					top: 0,
					height: 300,
				},
			);
			place(
				rowsPanel(view.container),
				{
					top: 0,
					height: 200,
				},
			);
			scroll();
			expect(state(view.container)).toStrictEqual(
				{
					disabled: false,
					hint: null,
					hintHidden: null,
				},
			);
		});
	});

	describe("title gate", () =>
	{
		const TITLE_CARD: CardProps =
		{
			title:
			{
				action: "read",
				meta: "/repo/src/very/long/path/to/a/file.ts",
			},
			detail: null,
		};

		function renderTitle(box: Box)
		{
			const view = renderCard(TITLE_CARD);
			place(
				view.transcript,
				{
					top: 0,
					height: 700,
				},
			);
			place(
				view.container.querySelector("[data-approval-card-root]")!,
				{
					top: box.top - 10,
					height: 400,
				},
			);
			const region = view.container.querySelector("[data-testid=approval-title-region]")!;
			place(region, box);
			scroll();
			return {
				...view,
				region,
			};
		}

		it("holds Allow once the title band has scrolled above the card's view, hinting upward one settle later", async () =>
		{
			const {container, onDecision} = renderTitle(
				{
					top: -50,
					height: 32,
				},
			);
			const quiet = state(container);
			fireEvent.click(allowButton());
			await flushFrames();
			expect(
				{
					quiet,
					calls: onDecision.mock.calls,
					settled: state(container),
				},
			).toStrictEqual(
				{
					quiet:
					{
						disabled: false,
						hint: null,
						hintHidden: null,
					},
					calls: [],
					settled:
					{
						disabled: true,
						hint: "Scroll up to see what you’re allowing.",
						hintHidden: false,
					},
				},
			);
		});

		it("lets a title that fits on screen through after the latch's two frames, with no hint", async () =>
		{
			const {container} = renderTitle(
				{
					top: 100,
					height: 32,
				},
			);
			await flushFrames();
			expect(state(container)).toStrictEqual(
				{
					disabled: false,
					hint: null,
					hintHidden: null,
				},
			);
		});

		it("holds an overflowing title band until it is scrolled to its end, then leaves the hint invisible", async () =>
		{
			vi.useFakeTimers(
				{
					toFake: ["performance"],
				},
			);
			const {container, region, onDecision} = renderTitle(
				{
					top: 100,
					height: 32,
					scrollHeight: 200,
				},
			);
			await flushFrames();
			const held = state(container);
			vi.advanceTimersByTime(400);
			fireEvent.keyDown(
				document.body,
				{
					key: "Enter",
					metaKey: true,
				},
			);
			const live = container.querySelector("p[aria-live=polite]")?.textContent;
			place(
				region,
				{
					top: 100,
					height: 32,
					scrollHeight: 200,
					scrollTop: 168,
				},
			);
			scroll();
			await flushFrames();
			expect(
				{
					held,
					live,
					calls: onDecision.mock.calls,
					read: state(container),
				},
			).toStrictEqual(
				{
					held:
					{
						disabled: true,
						hint: "Scroll the title to its end to allow this.",
						hintHidden: false,
					},
					live: "Scroll the title to its end to allow this.",
					calls: [],
					read:
					{
						disabled: false,
						hint: "Scroll the title to its end to allow this.",
						hintHidden: true,
					},
				},
			);
		});

		it("shows the rows hint while the rows are unread, the title's once only it is", async () =>
		{
			const view = renderCard(
				{
					...ROWS_CARD,
					title:
					{
						action: "use Foo",
						meta: "bar",
					},
				},
			);
			const {container, transcript} = view;
			place(
				transcript,
				{
					top: 0,
					height: 300,
					scrollHeight: 900,
				},
			);
			place(
				container.querySelector("[data-approval-card-root]")!,
				{
					top: 90,
					height: 400,
				},
			);
			const region = container.querySelector("[data-testid=approval-title-region]")!;
			place(
				region,
				{
					top: 100,
					height: 32,
					scrollHeight: 200,
				},
			);
			place(
				rowsPanel(container),
				{
					top: 200,
					height: 900,
				},
			);
			scroll();
			await flushFrames();
			const both = state(container);
			place(
				rowsPanel(container),
				{
					top: -600,
					height: 900,
				},
			);
			scroll();
			await flushFrames();
			const titleOnly = state(container);
			place(
				region,
				{
					top: 100,
					height: 32,
					scrollHeight: 200,
					scrollTop: 168,
				},
			);
			scroll();
			await flushFrames();
			expect(
				{
					both,
					titleOnly,
					read: state(container),
				},
			).toStrictEqual(
				{
					both:
					{
						disabled: true,
						hint: ROWS_HINT,
						hintHidden: false,
					},
					titleOnly:
					{
						disabled: true,
						hint: "Scroll the title to its end to allow this.",
						hintHidden: false,
					},
					read:
					{
						disabled: false,
						hint: ROWS_HINT,
						hintHidden: true,
					},
				},
			);
		});
	});

	describe("sandbox-bypass command gate", () =>
	{
		const COMMAND_CARD: CardProps =
		{
			detail: "curl -X POST https://example.com/hook \\\n  -d @payload.json",
			detailLang: "bash",
			clampTitle: true,
			detailNote: "Runs outside Claude’s sandbox.",
			detailReadGate:
			{
				label: "Command",
				hint: COMMAND_HINT,
			},
			perUseOnly: true,
			persistentAllow: "always",
		};

		it("drops the description's three-line clamp for upstream's 12-line cap beside a read-gated command", () =>
		{
			renderCard(
				{
					...COMMAND_CARD,
					description: "Posts the payload to the hook",
				},
			);
			expect(screen.getByText("Posts the payload to the hook").className).toBe(
				"epitaxy-scroll-clamp scroll-fade-y focus-visible:outline-hidden focus-visible:shadow-focus text-body text-secondary select-text break-words [unicode-bidi:plaintext] max-h-[12lh] overflow-y-auto",
			);
		});

		it("caps the command to six lines in a labelled scroller and holds Allow until the command and its note were seen", async () =>
		{
			const {container} = renderCard(COMMAND_CARD);
			place(
				container.querySelector("[data-testid=transcript]")!,
				{
					top: 0,
					height: 700,
				},
			);
			const scroller = container.querySelector<HTMLElement>("[data-testid=approval-read-detail]")!;
			place(
				scroller,
				{
					top: 100,
					height: 114,
					scrollHeight: 300,
				},
			);
			place(
				container.querySelector("[data-testid=approval-detail-note]")!,
				{
					top: 226,
					height: 16,
				},
			);
			scroll();
			await flushFrames();
			const held =
			{
				...state(container),
				box: scroller.parentElement?.className,
				maxHeight: scroller.style.maxHeight,
				tabIndex: scroller.getAttribute("tabindex"),
				role: scroller.getAttribute("role"),
				label: scroller.getAttribute("aria-label"),
				className: scroller.className,
				text: scroller.textContent,
				buttons: screen.getAllByRole("button").map((button) => button.textContent),
			};
			place(
				scroller,
				{
					top: 100,
					height: 114,
					scrollHeight: 300,
					scrollTop: 186,
				},
			);
			scroll();
			await flushFrames();
			expect(
				{
					held,
					read:
					{
						...state(container),
						className: scroller.className,
					},
				},
			).toStrictEqual(
				{
					held:
					{
						disabled: true,
						hint: COMMAND_HINT,
						hintHidden: false,
						box: "bg-alpha-1 rounded-lg py-md px-lg text-code text-secondary whitespace-pre-wrap break-words select-text [unicode-bidi:plaintext] has-[:focus-visible]:shadow-focus",
						maxHeight: "114px",
						tabIndex: "0",
						role: "group",
						label: "Command",
						className: "overflow-y-auto scroll-fade-y scroll-fade-size-[8px] focus-visible:outline-hidden",
						text: "curl -X POST https://example.com/hook \\\n  -d @payload.json",
						buttons: ["Deny", "Allow onceCtrl⏎Enter"],
					},
					read:
					{
						disabled: false,
						hint: COMMAND_HINT,
						hintHidden: true,
						className:
							"overflow-y-auto scroll-fade-y scroll-fade-size-[8px] focus-visible:outline-hidden overscroll-contain",
					},
				},
			);
		});

		it("never offers the persistent option, and ⇧⌘⏎ does nothing", () =>
		{
			vi.useFakeTimers(
				{
					toFake: ["performance"],
				},
			);
			const {onDecision} = renderCard(
				{
					...COMMAND_CARD,
					detailReadGate: null,
				},
			);
			vi.advanceTimersByTime(400);
			fireEvent.keyDown(
				document.body,
				{
					key: "Enter",
					metaKey: true,
					shiftKey: true,
				},
			);
			expect(
				{
					buttons: screen.getAllByRole("button").map((button) => button.textContent),
					calls: onDecision.mock.calls,
				},
			).toStrictEqual(
				{
					buttons: ["Deny", "Allow onceCtrl⏎Enter"],
					calls: [],
				},
			);
		});
	});

	it("binds no keys on a click-only card", () =>
	{
		vi.useFakeTimers(
			{
				toFake: ["performance"],
			},
		);
		const {onDecision} = renderCard(
			{
				clickOnly: true,
			},
		);
		vi.advanceTimersByTime(400);
		fireEvent.keyDown(
			document.body,
			{
				key: "Enter",
				metaKey: true,
			},
		);
		fireEvent.keyDown(
			document.body,
			{
				key: "Escape",
			},
		);
		expect(onDecision.mock.calls).toStrictEqual([]);
	});
});

describe("PermissionCard file change preview", () =>
{
	beforeEach(() =>
	{
		vi.stubGlobal(
			"ResizeObserver",
			class
			{
				observe()
				{
				}
				unobserve()
				{
				}
				disconnect()
				{
				}
			},
		);
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () =>
				Promise.resolve(
					Response.json(
						{
							error: "File not found",
						},
						{
							status: 404,
						},
					),
				),
			),
		);
	});
	afterEach(() =>
	{
		vi.unstubAllGlobals();
	});

	const TOO_LARGE =
		"Preview unavailable — this change is too large to show here (over 200,000 characters). The full change appears in the conversation after it runs.";

	it("says a too-large change can't be previewed, after the description and before the path", () =>
	{
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "write",
					meta: "b.ts",
				}}
				detail="/repo/b.ts"
				clampTitle
				fileChange="too_large"
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);
		const body = container.querySelector("[data-permission-detail]")!.parentElement!.parentElement!;
		expect(
			[...body.children].map((child) => (
			{
				tag: child.tagName,
				className: child.getAttribute("class"),
				text: child.textContent,
			})),
		).toStrictEqual([
			{
				tag: "P",
				className: "text-body text-secondary select-text break-words",
				text: TOO_LARGE,
			},
			{
				tag: "DIV",
				className: "flow-root",
				text: "/repo/b.ts",
			},
		]);
	});

	it("draws a previewed change as upstream's flow-root value column: the path, then the diff", async () =>
	{
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "edit",
					meta: "b.ts",
				}}
				detail="/repo/b.ts"
				clampTitle
				fileChange="preview"
				toolName="Edit"
				toolInput={
				{
					file_path: "/repo/b.ts",
					old_string: "a",
					new_string: "b",
				}}
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);
		await screen.findByRole(
			"group",
			{
				name: "Code",
			},
		);
		const column = container.querySelector(".flow-root > [data-approval-value]")!;
		expect(
			{
				className: column.getAttribute("class"),
				children: [...column.children].map((child) =>
					child.hasAttribute("data-permission-detail")
						? `detail:${child.textContent}`
						: child.querySelector("[data-cds=FileDiff]") === null
							? child.tagName
							: "diff",
				),
			},
		).toStrictEqual(
			{
				className: "flex flex-col gap-md",
				children: ["detail:/repo/b.ts", "diff"],
			},
		);
	});

	it("groups the path with its note in a 12px column when the change has a note", async () =>
	{
		const {container} = render(
			<PermissionCard
				title={
				{
					action: "edit",
					meta: "b.ts",
				}}
				detail="/repo/b.ts"
				clampTitle
				detailNote="Replaces every match in the file."
				fileChange="preview"
				toolName="MultiEdit"
				toolInput={
				{
					file_path: "/repo/b.ts",
					edits: [
						{
							old_string: "a",
							new_string: "b",
							replace_all: true,
						},
					],
				}}
				canAnswer
				onDecision={async () =>
				{
				}}
			/>,
		);
		await screen.findByRole(
			"group",
			{
				name: "Code",
			},
		);
		const group = container.querySelector(".flow-root > [data-approval-value] > div:first-child")!;
		expect(
			{
				className: group.getAttribute("class"),
				children: [...group.children].map((child) => (
				{
					detail: child.hasAttribute("data-permission-detail"),
					testId: child.getAttribute("data-testid"),
					text: child.textContent,
				})),
			},
		).toStrictEqual(
			{
				className: "flex flex-col gap-[12px]",
				children: [
					{
						detail: true,
						testId: null,
						text: "/repo/b.ts",
					},
					{
						detail: false,
						testId: "approval-detail-note",
						text: "Replaces every match in the file.",
					},
				],
			},
		);
	});

	describe("detail slot, as upstream's a(t): path, note and folds in one flow-root", () =>
	{
		const NOTEBOOK =
		{
			notebook_path: "/repo/n.ipynb",
			cell_id: "c1",
			new_source: "x = 1\ny = 2\n",
		};

		function renderPending(tool: string, input: Record<string, unknown>)
		{
			const pending = findPendingPermission(
				{
					sessionId: "session-test-100",
					isActive: true,
					notifications: [permissionNotification()],
					records: [assistantToolUse("t9", tool, input)],
				},
			)!;
			return render(
				<PermissionCard
					title={pending.title}
					detail={pending.detail}
					clampTitle={pending.clampTitle === true}
					detailNote={pending.detailNote ?? null}
					folds={pending.folds ?? null}
					canAnswer
					onDecision={async () =>
					{
					}}
				/>,
			);
		}

		const shape = (element: Element): unknown => (
		{
			tag: element.tagName,
			className: element.getAttribute("class"),
			testId: element.getAttribute("data-testid"),
		});

		it("draws a NotebookEdit card's path and note in a 12px column, then its open lined fold, flush in one flow-root", () =>
		{
			const {container} = renderPending("NotebookEdit", NOTEBOOK);
			const slot = container.querySelector("[data-permission-detail]")!.parentElement!.parentElement!;
			const column = slot.parentElement!;
			const folds = slot.querySelector("[data-testid=approval-folds]")!;
			const trigger = folds.querySelector("button")!;
			const pre = folds.querySelector("pre")!;
			expect(
				{
					column: [...column.children].map(shape),
					slot: [...slot.children].map(shape),
					inner: [...slot.firstElementChild!.children].map((child) => (
					{
						...(shape(child) as object),
						detail: child.hasAttribute("data-permission-detail"),
						text: child.textContent,
					})),
					fold: [...folds.children].map((child) => child.getAttribute("data-cds")),
					trigger:
					{
						text: trigger.textContent,
						expanded: trigger.getAttribute("aria-expanded"),
						label: trigger.querySelector("span")?.getAttribute("class"),
					},
					card: pre.parentElement?.getAttribute("class"),
					lines: [...pre.querySelectorAll("[data-line]")].map((line) => line.getAttribute("data-line")),
					source: pre.textContent,
				},
			).toStrictEqual(
				{
					column: [
						{
							tag: "DIV",
							className: "flow-root",
							testId: null,
						},
					],
					slot: [
						{
							tag: "DIV",
							className: "flex flex-col gap-[12px]",
							testId: null,
						},
						{
							tag: "DIV",
							className: "flex flex-col gap-1",
							testId: "approval-folds",
						},
					],
					inner: [
						{
							tag: "DIV",
							className:
								"epitaxy-code-size bg-alpha-1 rounded-r4 py-md px-lg text-code text-secondary whitespace-pre-wrap break-words select-text [unicode-bidi:plaintext]",
							testId: null,
							detail: true,
							text: "/repo/n.ipynb",
						},
						{
							tag: "P",
							className:
								"text-footnote text-muted-as-secondary select-text break-words [unicode-bidi:plaintext]",
							testId: "approval-detail-note",
							detail: false,
							text: "Replaces cell c1.",
						},
					],
					fold: ["Collapsible"],
					trigger:
					{
						text: "New cell content",
						expanded: "true",
						label: "text-footnote text-muted-control",
					},
					card: "mt-1 overflow-hidden rounded-lg bg-alpha-1",
					lines: ["1", "2"],
					source: "x = 1\ny = 2\n",
				},
			);
		});

		it("folds the cell content away when its trigger is clicked", async () =>
		{
			const {container} = renderPending("NotebookEdit", NOTEBOOK);
			const trigger = screen.getByRole(
				"button",
				{
					name: "New cell content",
				},
			);
			await actAndSettle(() =>
			{
				fireEvent.click(trigger);
			});
			await actAndSettle(() =>
			{
				frameQueue.flush(2);
			});
			expect(
				{
					expanded: trigger.getAttribute("aria-expanded"),
					lines: container.querySelectorAll("[data-line]").length,
				},
			).toStrictEqual(
				{
					expanded: "false",
					lines: 0,
				},
			);
		});

		it("draws an empty inserted cell as one empty line", () =>
		{
			const {container} = renderPending(
				"NotebookEdit",
				{
					notebook_path: "/repo/n.ipynb",
					edit_mode: "insert",
					new_source: "",
				},
			);
			expect(
				[...container.querySelectorAll("[data-line]")].map((line) => (
				{
					line: line.getAttribute("data-line"),
					text: line.textContent,
				})),
			).toStrictEqual([
				{
					line: "1",
					text: "",
				},
			]);
		});

		it("draws a deleted cell's note with no fold", () =>
		{
			const {container} = renderPending(
				"NotebookEdit",
				{
					notebook_path: "/repo/n.ipynb",
					cell_id: "c2",
					edit_mode: "delete",
					new_source: "",
				},
			);
			const slot = container.querySelector("[data-permission-detail]")!.parentElement!.parentElement!;
			expect([...slot.children].map(shape)).toStrictEqual([
				{
					tag: "DIV",
					className: "flex flex-col gap-[12px]",
					testId: null,
				},
			]);
		});

		it("keeps a Read card's path and range note in the same column, with no folds", () =>
		{
			const {container} = renderPending(
				"Read",
				{
					file_path: "/repo/a.ts",
					offset: 3,
					limit: 2,
				},
			);
			const slot = container.querySelector("[data-permission-detail]")!.parentElement!.parentElement!;
			expect(
				{
					slot: shape(slot),
					children: [...slot.children].map(shape),
					inner: [...slot.firstElementChild!.children].map((child) => child.textContent),
				},
			).toStrictEqual(
				{
					slot:
					{
						tag: "DIV",
						className: "flow-root",
						testId: null,
					},
					children: [
						{
							tag: "DIV",
							className: "flex flex-col gap-[12px]",
							testId: null,
						},
					],
					inner: ["/repo/a.ts", "Lines 3 to 4"],
				},
			);
		});
	});
});

describe("PermissionCard Allow and switch to Auto, as upstream's approval_card auto switch", () =>
{
	const AUTO_ROW = "Allow and switch to AutoAuto reviews the rest of this session.";
	const SHAPE: PermissionDialogShape =
	{
		denyFirst: false,
		persistent: true,
		auto: true,
	};

	beforeEach(() =>
	{
		vi.useFakeTimers(
			{
				toFake: ["performance"],
			},
		);
	});
	afterEach(() =>
	{
		vi.useRealTimers();
	});

	function renderAutoCard({
		persistentAllow = null,
		offered = true,
		dialog = SHAPE,
		onAllowAndSwitch = vi.fn<() => Promise<void>>(async () => {}),
	}:
	{
		persistentAllow?: PersistentAllowKind | null;
		offered?: boolean;
		dialog?: PermissionDialogShape | "unknown";
		onAllowAndSwitch?: () => Promise<void>;
	} = {})
	{
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => {});
		const card = (props: {offered: boolean; dialog: PermissionDialogShape | "unknown"}) => (
			<PermissionCard
				title={
				{
					action: "run this command",
					meta: null,
				}}
				detail="npm run build"
				detailLang="bash"
				canAnswer
				persistentAllow={persistentAllow}
				dialog={props.dialog}
				autoSwitch={
				{
					offered: props.offered,
					onAllowAndSwitch,
				}}
				onDecision={onDecision}
			/>
		);
		const utils = render(
			card(
				{
					offered,
					dialog,
				},
			),
		);
		paint();
		return {
			...utils,
			onDecision,
			onAllowAndSwitch,
			rerenderWith: (props: {offered: boolean; dialog: PermissionDialogShape | "unknown"}) =>
			{
				utils.rerender(card(props));
			},
		};
	}

	function buttons(): (string | null)[]
	{
		return screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);
	}

	async function menuItems(): Promise<(string | null)[]>
	{
		await actAndSettle(() =>
		{
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "More allow options",
					},
				),
			);
		});
		return screen.getAllByRole("menuitem").map((item) => item.textContent);
	}

	it("makes Allow once a split button whose menu holds only the auto row when there's no persistent option", async () =>
	{
		renderAutoCard();
		const primary = screen.getByRole(
			"button",
			{
				name: /^Allow once/,
			},
		);
		const facts =
		{
			buttons: buttons(),
			group: primary.closest("[data-cds=SplitDropdownButton]")?.getAttribute("aria-label"),
			shortcut: primary.getAttribute("aria-keyshortcuts"),
			labelData: Object.fromEntries(
				Object.entries(primary.querySelector<HTMLElement>("[data-approval-digit]")?.dataset ?? {}),
			),
		};
		expect(
			{
				...facts,
				items: await menuItems(),
			},
		).toStrictEqual(
			{
				buttons: ["Deny", "Allow onceCtrl⏎Enter", "More allow options"],
				group: "Allow once",
				shortcut: "Control+Enter",
				labelData:
				{
					approvalDigit: "2",
					approvalPrimary: "",
				},
				items: [AUTO_ROW],
			},
		);
	});

	it("keeps the plain Allow once button when the row isn't offered", () =>
	{
		renderAutoCard(
			{
				offered: false,
			},
		);
		expect(buttons()).toStrictEqual(["Deny", "Allow onceCtrl⏎Enter"]);
	});

	it("appends the row after Allow once in an always-led menu", async () =>
	{
		renderAutoCard(
			{
				persistentAllow: "always",
			},
		);
		expect(await menuItems()).toStrictEqual(["Allow onceCtrl+Enter", AUTO_ROW]);
	});

	it("appends the row after Always allow in a once-led menu", async () =>
	{
		localStorage.setItem(APPROVAL_LEADING_ALLOW_KEY, "once");
		renderAutoCard(
			{
				persistentAllow: "always",
			},
		);
		expect(await menuItems()).toStrictEqual(["Always allowDon’t ask again for this tool", AUTO_ROW]);
	});

	it("keeps the row as first painted when the offer changes underneath (paint latch)", async () =>
	{
		const {rerenderWith} = renderAutoCard();
		rerenderWith(
			{
				offered: false,
				dialog: SHAPE,
			},
		);
		expect(await menuItems()).toStrictEqual([AUTO_ROW]);
	});

	it("never adds the row after a card painted without it", () =>
	{
		const {rerenderWith} = renderAutoCard(
			{
				offered: false,
			},
		);
		rerenderWith(
			{
				offered: true,
				dialog: SHAPE,
			},
		);
		expect(buttons()).toStrictEqual(["Deny", "Allow onceCtrl⏎Enter"]);
	});

	it("latches only once the terminal's dialog has been read", async () =>
	{
		const {rerenderWith} = renderAutoCard(
			{
				offered: false,
				dialog: "unknown",
			},
		);
		rerenderWith(
			{
				offered: true,
				dialog: SHAPE,
			},
		);
		expect(await menuItems()).toStrictEqual([AUTO_ROW]);
	});

	it("allows and switches through onAllowAndSwitch alone, hiding the card at once", async () =>
	{
		const {onDecision, onAllowAndSwitch} = renderAutoCard();
		vi.advanceTimersByTime(400);
		await menuItems();
		await actAndSettle(() =>
		{
			fireEvent.click(
				screen.getByRole(
					"menuitem",
					{
						name: /^Allow and switch to Auto/,
					},
				),
			);
		});
		expect(
			{
				switches: vi.mocked(onAllowAndSwitch).mock.calls.length,
				decisions: onDecision.mock.calls,
				card: screen.queryByRole(
					"group",
					{
						name: /^Permission request/,
					},
				),
			},
		).toStrictEqual(
			{
				switches: 1,
				decisions: [],
				card: null,
			},
		);
	});

	it("swallows the row within upstream's 400ms arm grace", async () =>
	{
		const {onDecision, onAllowAndSwitch} = renderAutoCard();
		vi.advanceTimersByTime(399);
		await menuItems();
		await actAndSettle(() =>
		{
			fireEvent.click(
				screen.getByRole(
					"menuitem",
					{
						name: /^Allow and switch to Auto/,
					},
				),
			);
		});
		expect(
			{
				switches: vi.mocked(onAllowAndSwitch).mock.calls.length,
				decisions: onDecision.mock.calls,
				buttons: buttons(),
			},
		).toStrictEqual(
			{
				switches: 0,
				decisions: [],
				buttons: ["Deny", "Allow onceCtrl⏎Enter", "More allow options"],
			},
		);
	});

	it("brings the card back with the error when the switch fails", async () =>
	{
		renderAutoCard(
			{
				onAllowAndSwitch: async () =>
					Promise.reject(new Error("The terminal’s permission dialog doesn’t match this card")),
			},
		);
		vi.advanceTimersByTime(400);
		await menuItems();
		await actAndSettle(() =>
		{
			fireEvent.click(
				screen.getByRole(
					"menuitem",
					{
						name: /^Allow and switch to Auto/,
					},
				),
			);
		});
		expect(
			{
				buttons: buttons(),
				error: screen.getByText(/doesn’t match this card/).textContent,
			},
		).toStrictEqual(
			{
				buttons: ["Deny", "Allow onceCtrl⏎Enter", "More allow options"],
				error: "The terminal’s permission dialog doesn’t match this card",
			},
		);
	});
});

describe("PermissionCard paint guard, as upstream's lS sentinel and gr() hold", () =>
{
	let shown = true;

	beforeEach(() =>
	{
		vi.useFakeTimers(
			{
				toFake: ["performance", "setInterval", "clearInterval"],
			},
		);
		shown = true;
		HTMLElement.prototype.checkVisibility = () => shown;
	});
	afterEach(() =>
	{
		vi.useRealTimers();
		Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility");
	});

	function renderGuarded({
		hideOnDecision = true,
	}:
	{
		hideOnDecision?: boolean;
	} = {})
	{
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => {});
		const card = (canAnswer: boolean) => (
			<PermissionCard
				title={
				{
					action: "run this command",
					meta: null,
				}}
				detail="rm -rf dist"
				canAnswer={canAnswer}
				hideOnDecision={hideOnDecision}
				onDecision={onDecision}
			/>
		);
		const utils = render(card(true));
		return {
			...utils,
			onDecision,
			rerenderAnswerable: (canAnswer: boolean) =>
			{
				utils.rerender(card(canAnswer));
			},
		};
	}

	function chord()
	{
		fireEvent.keyDown(
			document.body,
			{
				key: "Enter",
				metaKey: true,
			},
		);
	}

	function click(name: RegExp | string)
	{
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name,
				},
			),
		);
	}

	it("drops an Allow click on an unpainted card, which doesn't look disabled, but lets Deny through", () =>
	{
		const {onDecision} = renderGuarded();
		frameQueue.flush(1);
		click(/^Allow once/);
		const allowDisabled = screen
			.getByRole(
				"button",
				{
					name: /^Allow once/,
				},
			)
			.hasAttribute("disabled");
		const callsAfterAllow = [...onDecision.mock.calls];
		click("Deny");
		expect(
			{
				allowDisabled,
				callsAfterAllow,
				calls: onDecision.mock.calls,
			},
		).toStrictEqual(
			{
				allowDisabled: false,
				callsAfterAllow: [],
				calls: [["deny"]],
			},
		);
	});

	it("allows on click once two frames have painted", () =>
	{
		const {onDecision} = renderGuarded();
		paint();
		click(/^Allow once/);
		expect(onDecision.mock.calls).toStrictEqual([["allow"]]);
	});

	it("counts the ⌘⏎ grace from paint, not from mount", () =>
	{
		const {onDecision} = renderGuarded();
		vi.advanceTimersByTime(1000);
		chord();
		const unpainted = [...onDecision.mock.calls];
		paint();
		vi.advanceTimersByTime(399);
		chord();
		const inGrace = [...onDecision.mock.calls];
		vi.advanceTimersByTime(1);
		chord();
		expect(
			{
				unpainted,
				inGrace,
				calls: onDecision.mock.calls,
			},
		).toStrictEqual(
			{
				unpainted: [],
				inGrace: [],
				calls: [["allow"]],
			},
		);
	});

	it("holds a hidden card's allow and restarts the grace once it paints again", () =>
	{
		const {onDecision} = renderGuarded();
		paint();
		vi.advanceTimersByTime(1000);
		shown = false;
		act(() =>
		{
			vi.advanceTimersByTime(250);
		});
		click(/^Allow once/);
		const hidden = [...onDecision.mock.calls];
		shown = true;
		act(() =>
		{
			vi.advanceTimersByTime(250);
		});
		paint();
		vi.advanceTimersByTime(399);
		chord();
		const inGrace = [...onDecision.mock.calls];
		vi.advanceTimersByTime(1);
		chord();
		expect(
			{
				hidden,
				inGrace,
				calls: onDecision.mock.calls,
			},
		).toStrictEqual(
			{
				hidden: [],
				inGrace: [],
				calls: [["allow"]],
			},
		);
	});

	it("restarts the grace when a failed answer re-enables the card", async () =>
	{
		const {onDecision} = renderGuarded(
			{
				hideOnDecision: false,
			},
		);
		paint();
		vi.advanceTimersByTime(400);
		onDecision.mockRejectedValueOnce(new Error("herdr pane is gone"));
		await actAndSettle(() =>
		{
			chord();
		});
		vi.advanceTimersByTime(399);
		chord();
		const inGrace = [...onDecision.mock.calls];
		vi.advanceTimersByTime(1);
		chord();
		expect(
			{
				inGrace,
				calls: onDecision.mock.calls,
			},
		).toStrictEqual(
			{
				inGrace: [["allow"]],
				calls: [["allow"], ["allow"]],
			},
		);
	});

	it("restarts the grace when the card can answer again", () =>
	{
		const {onDecision, rerenderAnswerable} = renderGuarded();
		paint();
		vi.advanceTimersByTime(1000);
		rerenderAnswerable(false);
		vi.advanceTimersByTime(1000);
		rerenderAnswerable(true);
		vi.advanceTimersByTime(399);
		chord();
		const inGrace = [...onDecision.mock.calls];
		vi.advanceTimersByTime(1);
		chord();
		expect(
			{
				inGrace,
				calls: onDecision.mock.calls,
			},
		).toStrictEqual(
			{
				inGrace: [],
				calls: [["allow"]],
			},
		);
	});
});
