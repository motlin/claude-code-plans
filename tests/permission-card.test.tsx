// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {actAndSettle} from "./act-and-settle";
import type {ComponentProps} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {BackgroundTasksOpenerProvider} from "../src/components/background-tasks-opener-context";
import {ApprovalCardShell, WaitingForInputNotice} from "../src/components/approval-card";
import {PermissionCard} from "../src/components/permission-card";
import {APPROVAL_LEADING_ALLOW_KEY} from "../src/lib/approval-leading-allow";
import {isAnsweredHeld, releaseAnswered} from "../src/lib/answered-sessions";
import {clearApprovalAnswered, isApprovalAnswered, useApprovalAnswered} from "../src/lib/answered-approvals";
import {
	findPendingPermission,
	permissionAnswerKey,
	permissionDecisionForKey,
	permissionWaitToolUseId,
	type PermissionNotification,
} from "../src/lib/permission-card";
import type {PermissionDialogShape} from "../src/lib/herdr/permission-screen";
import type {PersistentAllowKind} from "../src/lib/permission-suggestions";

afterEach(() => {
	cleanup();
	localStorage.removeItem(APPROVAL_LEADING_ALLOW_KEY);
});

function assistantToolUse(id: string, name: string, input: Record<string, unknown>, extra = {}) {
	return {
		type: "assistant",
		message: {content: [{type: "tool_use", id, name, input}]},
		...extra,
	};
}

function toolResult(id: string) {
	return {
		type: "user",
		message: {content: [{type: "tool_result", tool_use_id: id, content: "ok"}]},
	};
}

function permissionNotification(overrides: Partial<PermissionNotification> = {}): PermissionNotification {
	return {
		id: "notification-test-100",
		sessionId: "session-test-100",
		notificationType: "permission_prompt",
		message: "Claude needs your permission to use Bash",
		...overrides,
	};
}

const BASH_RECORDS = [
	assistantToolUse("t1", "Read", {file_path: "/repo/a.ts"}),
	toolResult("t1"),
	assistantToolUse("t2", "Bash", {
		command: "rm -rf dist",
		description: "Remove the build output",
	}),
];

describe("findPendingPermission", () => {
	it("shows the pending Bash command when the hook state has a permission prompt", () => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
				isActive: true,
				notifications: [permissionNotification()],
				records: BASH_RECORDS,
			}),
		).toStrictEqual({
			notificationId: "notification-test-100",
			toolUseId: "t2",
			title: {action: "run this command", meta: null},
			detail: "rm -rf dist",
			detailLang: "bash",
			clampTitle: true,
			description: "Remove the build output",
		});
	});

	it.each([
		{
			input: {command: "npm run dev", description: "Start the dev server", run_in_background: true},
			expected: {
				title: {action: "run this command", meta: null},
				detail: "npm run dev",
				detailLang: "bash",
				clampTitle: true,
				description: "Start the dev server",
				detailNote: "Keeps running in the background.",
			},
		},
		{
			input: {
				command: "curl x",
				description: "Fetch x",
				dangerouslyDisableSandbox: true,
				run_in_background: true,
			},
			expected: {
				title: {action: "run this command", meta: null},
				detail: "curl x",
				detailLang: "bash",
				clampTitle: true,
				description: "Fetch x",
				detailNote: "Runs outside Claude’s sandbox. Keeps running in the background.",
			},
		},
		{
			input: {command: "curl x", description: "curl x", dangerouslyDisableSandbox: true},
			expected: {
				title: {action: "run this command", meta: null},
				detail: "curl x",
				detailLang: "bash",
				clampTitle: true,
				detailNote: "Runs outside Claude’s sandbox.",
			},
		},
		{
			input: {command: "ls", description: "List files", timeout: 120000},
			expected: {
				title: {action: "run this command", meta: null},
				detail: "ls",
				detailLang: "bash",
				clampTitle: true,
				description: "List files",
				detailNote: "Time limit: 2 minutes.",
			},
		},
		{
			input: {command: "ls", timeout: 45000},
			expected: {
				title: {action: "run this command", meta: null},
				detail: "ls",
				detailLang: "bash",
				clampTitle: true,
				detailNote: "Time limit: 45 seconds.",
			},
		},
		{
			input: {command: "make", timeout: 60000, run_in_background: true},
			expected: {
				title: {action: "run this command", meta: null},
				detail: "make",
				detailLang: "bash",
				clampTitle: true,
				detailNote: "Keeps running in the background. Time limit: 1 minute.",
			},
		},
	])(
		"notes a Bash command's sandbox, background and time-limit flags as upstream does ($input.command)",
		({input, expected}) => {
			expect(
				findPendingPermission({
					sessionId: "session-test-100",
					isActive: true,
					notifications: [permissionNotification()],
					records: [assistantToolUse("t2", "Bash", input)],
				}),
			).toStrictEqual({notificationId: "notification-test-100", toolUseId: "t2", ...expected});
		},
	);

	it("carries a Workflow's description and upstream's token warning", () => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
				isActive: true,
				notifications: [permissionNotification()],
				records: [assistantToolUse("t2", "Workflow", {name: "noop-a", description: "Replies ok"})],
			}),
		).toStrictEqual({
			notificationId: "notification-test-100",
			toolUseId: "t2",
			title: {action: "run the workflow", meta: "noop-a"},
			detail: null,
			description: "Replies ok",
			tokenWarning: true,
		});
	});

	it("carries the persistent allow option the PermissionRequest hook reported for the prompt", () => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
				isActive: true,
				notifications: [permissionNotification({persistentAllow: "always"})],
				records: BASH_RECORDS,
			}),
		).toStrictEqual({
			notificationId: "notification-test-100",
			toolUseId: "t2",
			title: {action: "run this command", meta: null},
			detail: "rm -rf dist",
			detailLang: "bash",
			clampTitle: true,
			description: "Remove the build output",
			persistentAllow: "always",
		});
	});

	it("names a file tool's file over its full path", () => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
				isActive: true,
				notifications: [permissionNotification()],
				records: [assistantToolUse("t3", "Write", {file_path: "/repo/b.ts", content: "x"})],
			}),
		).toStrictEqual({
			notificationId: "notification-test-100",
			toolUseId: "t3",
			title: {action: "write", meta: "b.ts"},
			detail: "/repo/b.ts",
			clampTitle: true,
		});
	});

	it("falls back to the notification message when no tool call is pending in the transcript", () => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
				isActive: true,
				notifications: [permissionNotification()],
				records: [...BASH_RECORDS, toolResult("t2")],
			}),
		).toStrictEqual({
			notificationId: "notification-test-100",
			toolUseId: null,
			title: {heading: "Claude needs your permission to use Bash"},
			detail: null,
		});
	});

	it.each([
		{name: "no notification", notifications: []},
		{
			name: "another session's permission prompt",
			notifications: [permissionNotification({sessionId: "session-test-200"})],
		},
		{
			name: "a non-permission notification",
			notifications: [permissionNotification({notificationType: "idle_prompt"})],
		},
	])("is hidden for $name", ({notifications}) => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
				isActive: true,
				notifications,
				records: BASH_RECORDS,
			}),
		).toBeNull();
	});

	it("shows the card from the session's own permission wait when no notification was recorded", () => {
		const records = [
			assistantToolUse("t4", "Bash", {
				command: "gh pr create --fill",
				description: "Open the oxfmt comment PR and check the other test",
			}),
		];

		expect({
			permissionWait: findPendingPermission({
				sessionId: "session-test-100",
				isActive: false,
				notifications: [],
				awaitingPermission: true,
				records,
			}),
			inputWait: findPendingPermission({
				sessionId: "session-test-100",
				isActive: false,
				notifications: [],
				awaitingPermission: false,
				records,
			}),
		}).toStrictEqual({
			permissionWait: {
				notificationId: "t4",
				toolUseId: "t4",
				title: {action: "run this command", meta: null},
				detail: "gh pr create --fill",
				detailLang: "bash",
				clampTitle: true,
				description: "Open the oxfmt comment PR and check the other test",
			},
			inputWait: null,
		});
	});

	it("still shows the card when the session is idle and the tool call is waiting on the prompt", () => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
				isActive: false,
				notifications: [permissionNotification()],
				records: BASH_RECORDS,
			}),
		).toStrictEqual({
			notificationId: "notification-test-100",
			toolUseId: "t2",
			title: {action: "run this command", meta: null},
			detail: "rm -rf dist",
			detailLang: "bash",
			clampTitle: true,
			description: "Remove the build output",
		});
	});

	it.each([
		{name: "a tool_result answered the call", records: [...BASH_RECORDS, toolResult("t2")]},
		{
			name: "the turn stopped after the call",
			records: [...BASH_RECORDS, {type: "system", subtype: "turn_duration", durationMs: 1000}],
		},
		{name: "no tool call is pending", records: []},
	])("is hidden for an idle session when $name", ({records}) => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
				isActive: false,
				notifications: [permissionNotification()],
				records,
			}),
		).toBeNull();
	});

	describe("picking the call the CLI asks about in a batch", () => {
		const SERIAL = [
			assistantToolUse("e1", "Edit", {file_path: "/repo/a", old_string: "x", new_string: "y"}),
			assistantToolUse("w1", "Write", {file_path: "/repo/b", content: "z"}),
			assistantToolUse("b1", "Bash", {command: "ls"}),
		];
		const PARALLEL = [
			assistantToolUse("f1", "WebFetch", {url: "https://a", prompt: "p"}),
			assistantToolUse("r1", "Read", {file_path: "/repo/a"}),
			toolResult("r1"),
		];
		const TWO_FETCHES = [
			assistantToolUse("f1", "WebFetch", {url: "https://a", prompt: "p"}),
			assistantToolUse("f2", "WebFetch", {url: "https://b", prompt: "p"}),
		];
		const EDIT_CARD = {
			notificationId: "notification-test-100",
			toolUseId: "e1",
			title: {action: "edit", meta: "a"},
			detail: "/repo/a",
			clampTitle: true,
		};

		it.each([true, false])("describes a serial batch's first call, not its last (active %s)", (isActive) => {
			expect(
				findPendingPermission({
					sessionId: "session-test-100",
					isActive,
					notifications: [permissionNotification()],
					records: SERIAL,
				}),
			).toStrictEqual(EDIT_CARD);
		});

		it("marks the serial batch's first call as the one waiting", () => {
			expect(
				permissionWaitToolUseId({
					sessionId: "session-test-100",
					notifications: [permissionNotification()],
					records: SERIAL,
				}),
			).toBe("e1");
		});

		it("describes a parallel ask whose later sibling already finished", () => {
			const signals = {
				sessionId: "session-test-100",
				notifications: [permissionNotification()],
				records: PARALLEL,
			};
			expect({
				inactive: findPendingPermission({...signals, isActive: false}),
				active: findPendingPermission({...signals, isActive: true}),
				waiting: permissionWaitToolUseId(signals),
			}).toStrictEqual({
				inactive: {
					notificationId: "notification-test-100",
					toolUseId: "f1",
					title: {action: "use WebFetch", meta: null},
					detail: JSON.stringify({url: "https://a", prompt: "p"}, null, 2),
				},
				active: {
					notificationId: "notification-test-100",
					toolUseId: "f1",
					title: {action: "use WebFetch", meta: null},
					detail: JSON.stringify({url: "https://a", prompt: "p"}, null, 2),
				},
				waiting: "f1",
			});
		});

		it("describes the call the hook's ask names when several are pending", () => {
			const signals = {
				sessionId: "session-test-100",
				notifications: [permissionNotification()],
				records: TWO_FETCHES,
				ask: {toolName: "WebFetch", toolInput: {url: "https://b", prompt: "p"}},
			};
			expect({
				card: findPendingPermission({...signals, isActive: false}),
				waiting: permissionWaitToolUseId(signals),
			}).toStrictEqual({
				card: {
					notificationId: "notification-test-100",
					toolUseId: "f2",
					title: {action: "use WebFetch", meta: null},
					detail: JSON.stringify({url: "https://b", prompt: "p"}, null, 2),
				},
				waiting: "f2",
			});
		});

		it("falls back to the first pending call when the ask matches none", () => {
			expect(
				permissionWaitToolUseId({
					sessionId: "session-test-100",
					notifications: [permissionNotification()],
					records: TWO_FETCHES,
					ask: {toolName: "WebFetch", toolInput: {url: "https://c", prompt: "p"}},
				}),
			).toBe("f1");
		});
	});

	it("is hidden while an AskUserQuestion is the pending tool call", () => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
				isActive: true,
				notifications: [permissionNotification()],
				records: [assistantToolUse("t4", "AskUserQuestion", {questions: []})],
			}),
		).toBeNull();
	});
});

const PRIMARY = "text-primary [unicode-bidi:plaintext]";

describe("permission title copy", () => {
	it.each([
		{
			tool: "Bash",
			input: {command: "rm -rf dist", description: "Remove the build output"},
			title: "Allow Claude to run this command?",
			parts: [[PRIMARY, "run this command"]],
			valueClass: "line-clamp-2",
			label: "Permission request: run this command",
			detail: "$ rm -rf dist",
		},
		{
			tool: "Read",
			input: {file_path: "/repo/src/a.ts"},
			title: "Allow Claude to read a.ts?",
			parts: [
				[PRIMARY, "read"],
				[PRIMARY, "a.ts"],
			],
			valueClass: "line-clamp-2",
			label: "Permission request: read",
			detail: "/repo/src/a.ts",
		},
		{
			tool: "Grep",
			input: {pattern: "TODO", path: "/repo"},
			title: "Allow Claude to search files?",
			parts: [[PRIMARY, "search files"]],
			valueClass: null,
			label: "Permission request: search files",
			detail: "TODO",
		},
		{
			tool: "mcp__github__create_issue",
			input: {title: "Bug", labels: ["a"]},
			title: "Allow Claude to use mcp__github__create_issue?",
			parts: [[PRIMARY, "use mcp__github__create_issue"]],
			valueClass: null,
			label: "Permission request: use mcp__github__create_issue",
			detail: '{\n  "title": "Bug",\n  "labels": [\n    "a"\n  ]\n}',
		},
	])("titles $tool $input as upstream does", ({tool, input, title, parts, valueClass, label, detail}) => {
		const pending = findPendingPermission({
			sessionId: "session-test-100",
			isActive: true,
			notifications: [permissionNotification()],
			records: [assistantToolUse("t9", tool, input)],
		})!;
		const {container} = render(
			<PermissionCard
				title={pending.title}
				detail={pending.detail}
				detailLang={pending.detailLang ?? null}
				clampTitle={pending.clampTitle === true}
				canAnswer
				onDecision={async () => {}}
			/>,
		);
		const card = container.querySelector("[data-approval-card-root]")!;
		const value = card.querySelector("[data-permission-title] [data-permission-title-value]");
		expect({
			title: value?.textContent,
			parts: [...(value?.children ?? [])].map((span) => [span.className, span.textContent]),
			valueClass: value?.getAttribute("class") ?? null,
			approvalValue: value?.hasAttribute("data-approval-value"),
			label: card.getAttribute("aria-label"),
			detail: card.querySelector("[data-permission-detail]")?.textContent ?? null,
		}).toStrictEqual({
			title,
			parts,
			valueClass,
			approvalValue: valueClass === null,
			label,
			detail,
		});
	});

	it.each([
		{
			tool: "Glob",
			input: {pattern: "**/*.ts"},
			expected: {title: {action: "find files", meta: null}, detail: "**/*.ts"},
		},
		{
			tool: "Grep",
			input: {pattern: "TODO", path: "/repo"},
			expected: {title: {action: "search files", meta: null}, detail: "TODO"},
		},
		{
			tool: "WebSearch",
			input: {query: "vitest jsdom"},
			expected: {title: {action: "search the web", meta: null}, detail: "vitest jsdom"},
		},
		{
			tool: "Skill",
			input: {skill: "commit", args: "--all"},
			expected: {title: {action: "run skill", meta: "/commit"}, detail: "--all"},
		},
		{
			tool: "Agent",
			input: {description: "Find the bug", prompt: "look"},
			expected: {title: {action: "run an agent", meta: null}, detail: null, description: "Find the bug"},
		},
		{
			tool: "Task",
			input: {description: "Find the bug", prompt: "look"},
			expected: {title: {action: "run an agent", meta: null}, detail: null, description: "Find the bug"},
		},
		{
			tool: "Workflow",
			input: {name: "upstream-sync-noop", description: "Does nothing"},
			expected: {
				title: {action: "run the workflow", meta: "upstream-sync-noop"},
				detail: null,
				description: "Does nothing",
				tokenWarning: true,
			},
		},
		{
			tool: "Workflow",
			input: {script: "export default {}"},
			expected: {title: {action: "run a workflow", meta: null}, detail: null, tokenWarning: true},
		},
		{
			tool: "Read",
			input: {file_path: "/repo/a.ts"},
			expected: {title: {action: "read", meta: "a.ts"}, detail: "/repo/a.ts", clampTitle: true},
		},
		{
			tool: "Read",
			input: {file_path: "/repo/a.ts", offset: 5, limit: 1},
			expected: {
				title: {action: "read", meta: "a.ts"},
				detail: "/repo/a.ts",
				detailNote: "Line 5",
				clampTitle: true,
			},
		},
		{
			tool: "Read",
			input: {file_path: "/repo/a.ts", offset: 5, limit: 10},
			expected: {
				title: {action: "read", meta: "a.ts"},
				detail: "/repo/a.ts",
				detailNote: "Lines 5 to 14",
				clampTitle: true,
			},
		},
		{
			tool: "Read",
			input: {file_path: "/repo/a.ts", offset: 5},
			expected: {
				title: {action: "read", meta: "a.ts"},
				detail: "/repo/a.ts",
				detailNote: "From line 5",
				clampTitle: true,
			},
		},
		{
			tool: "Read",
			input: {file_path: "/repo/a.pdf", limit: 10, pages: "3"},
			expected: {
				title: {action: "read", meta: "a.pdf"},
				detail: "/repo/a.pdf",
				detailNote: "First 10 lines, Page 3",
				clampTitle: true,
			},
		},
		{
			tool: "Read",
			input: {file_path: "/repo/a.pdf", pages: "1-3"},
			expected: {
				title: {action: "read", meta: "a.pdf"},
				detail: "/repo/a.pdf",
				detailNote: "Pages 1-3",
				clampTitle: true,
			},
		},
		{
			tool: "Write",
			input: {file_path: "/repo/b.ts", content: ""},
			expected: {
				title: {action: "write", meta: "b.ts"},
				detail: "/repo/b.ts",
				detailNote: "Leaves the file empty.",
				clampTitle: true,
			},
		},
		{
			tool: "Edit",
			input: {file_path: "/repo/b.ts", old_string: "a", new_string: "b", replace_all: true},
			expected: {
				title: {action: "edit", meta: "b.ts"},
				detail: "/repo/b.ts",
				detailNote: "Replaces every match in the file.",
				clampTitle: true,
			},
		},
		{
			tool: "MultiEdit",
			input: {file_path: "/repo/b.ts", edits: []},
			expected: {title: {action: "edit", meta: "b.ts"}, detail: "/repo/b.ts", clampTitle: true},
		},
		{
			tool: "NotebookEdit",
			input: {notebook_path: "/repo/n.ipynb", cell_id: "c1", new_source: "x"},
			expected: {
				title: {action: "edit", meta: "n.ipynb"},
				detail: "/repo/n.ipynb",
				detailNote: "Replaces cell c1.",
			},
		},
		{
			tool: "NotebookEdit",
			input: {
				notebook_path: "/repo/n.ipynb",
				cell_id: "c1",
				edit_mode: "insert",
				cell_type: "code",
				new_source: "x",
			},
			expected: {
				title: {action: "edit", meta: "n.ipynb"},
				detail: "/repo/n.ipynb",
				detailNote: "Adds a new cell after cell c1. Cell type: code.",
			},
		},
		{
			tool: "NotebookEdit",
			input: {notebook_path: "/repo/n.ipynb", edit_mode: "insert", new_source: "x"},
			expected: {
				title: {action: "edit", meta: "n.ipynb"},
				detail: "/repo/n.ipynb",
				detailNote: "Adds a new cell at the top.",
			},
		},
		{
			tool: "NotebookEdit",
			input: {notebook_path: "/repo/n.ipynb", cell_id: "c2", edit_mode: "delete", new_source: ""},
			expected: {
				title: {action: "edit", meta: "n.ipynb"},
				detail: "/repo/n.ipynb",
				detailNote: "Deletes cell c2.",
			},
		},
		{
			tool: "Monitor",
			input: {command: "tail -f log", description: "Watch the log"},
			expected: {
				title: {action: "run and watch a command", meta: null},
				detail: "tail -f log",
				detailLang: "bash",
			},
		},
		{
			tool: "Monitor",
			input: {url: "wss://example.test"},
			expected: {
				title: {action: "open and watch a connection", meta: null},
				detail: '{\n  "url": "wss://example.test"\n}',
			},
		},
		{
			tool: "CronCreate",
			input: {cron: "0 9 * * *", prompt: "Check the build"},
			expected: {title: {action: "schedule a prompt", meta: null}, detail: "Check the build"},
		},
		{
			tool: "EnterWorktree",
			input: {name: "feature-a"},
			expected: {title: {action: "create a worktree", meta: null}, detail: "feature-a"},
		},
		{
			tool: "EnterWorktree",
			input: {path: "/repo/.worktrees/a"},
			expected: {title: {action: "move to a worktree", meta: null}, detail: "/repo/.worktrees/a"},
		},
		{tool: "ExitWorktree", input: {}, expected: {title: {action: "leave the worktree", meta: null}, detail: null}},
		{
			tool: "ExitWorktree",
			input: {action: "remove"},
			expected: {title: {action: "delete the worktree and its branch", meta: null}, detail: null},
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
		).map(([tool, action]) => ({tool, input: {}, expected: {title: {action, meta: null}, detail: null}})),
		{
			tool: "ToolSearch",
			input: {query: "select:Read"},
			expected: {title: {action: "load tools", meta: null}, detail: '{\n  "query": "select:Read"\n}'},
		},
	] as {tool: string; input: Record<string, unknown>; expected: Record<string, unknown>}[])(
		"copies upstream's $tool permission copy for $input",
		({tool, input, expected}) => {
			const {
				notificationId: _notificationId,
				toolUseId: _toolUseId,
				...copy
			} = findPendingPermission({
				sessionId: "session-test-100",
				isActive: true,
				notifications: [permissionNotification()],
				records: [assistantToolUse("t9", tool, input)],
			})!;
			expect(copy).toStrictEqual(expected);
		},
	);

	it("holds its session as answered at the click, before the decision settles", () => {
		render(
			<PermissionCard
				title={{action: "run", meta: null}}
				detail="ls"
				canAnswer
				sessionId="s-permission"
				answerKey="toolu_permission"
				onDecision={async () => new Promise<void>(() => {})}
			/>,
		);
		fireEvent.click(screen.getByRole("button", {name: /^Allow/}));
		const held = isAnsweredHeld("s-permission");
		releaseAnswered("s-permission");

		expect(held).toBe(true);
	});

	it("draws the notification text as the heading when no tool call describes the prompt", () => {
		const {container} = render(
			<PermissionCard
				title={{heading: "Claude needs your permission to use Bash"}}
				detail={null}
				canAnswer
				onDecision={async () => {}}
			/>,
		);
		const card = container.querySelector("[data-approval-card-root]")!;
		expect({
			title: card.querySelector("[data-permission-title]")?.textContent,
			label: card.getAttribute("aria-label"),
		}).toStrictEqual({title: "Claude needs your permission to use Bash", label: "Permission request"});
	});
});

describe("permissionDecisionForKey", () => {
	const plain = {metaKey: false, ctrlKey: false, altKey: false, shiftKey: false};

	it.each([
		{event: {...plain, key: "Escape"}, decision: "deny"},
		{event: {...plain, key: "Enter", metaKey: true}, decision: "allow"},
		{event: {...plain, key: "Enter", ctrlKey: true}, decision: "allow"},
		{event: {...plain, key: "Enter", metaKey: true, shiftKey: true}, decision: "always"},
		{event: {...plain, key: "Enter", metaKey: true, altKey: true}, decision: null},
		{event: {...plain, key: "Enter"}, decision: null},
		{event: {...plain, key: "1"}, decision: null},
		{event: {...plain, key: "2"}, decision: null},
		{event: {...plain, key: "Escape", shiftKey: true}, decision: null},
	])("maps $event.key to $decision", ({event, decision}) => {
		expect(permissionDecisionForKey(event)).toStrictEqual(decision);
	});
});

/** A pending answer the test settles by hand. */
function deferredAnswer() {
	let resolve!: () => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<undefined>((onResolve, onReject) => {
		resolve = () => {
			onResolve(undefined);
		};
		reject = onReject;
	});
	return {promise, resolve, reject};
}

function heldButtons() {
	return screen.getAllByRole("button").map((button) => ({
		text: button.textContent,
		label: button.getAttribute("aria-label"),
		busy: button.getAttribute("aria-busy"),
		disabled: button.hasAttribute("disabled"),
	}));
}

function renderCard({
	canAnswer = true,
	persistentAllow = null,
	dialog,
}: {
	canAnswer?: boolean;
	persistentAllow?: PersistentAllowKind | null;
	dialog?: PermissionDialogShape | "unknown";
} = {}) {
	const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => {});
	const card = (shape: PermissionDialogShape | "unknown" | undefined) => (
		<div>
			<div data-focus-region="composer">
				<div data-composer-card>
					<textarea aria-label="Prompt" />
				</div>
			</div>
			<PermissionCard
				title={{action: "run this command", meta: null}}
				detail="rm -rf dist"
				detailLang="bash"
				clampTitle
				description="Remove the build output"
				canAnswer={canAnswer}
				persistentAllow={persistentAllow}
				{...(shape === undefined ? {} : {dialog: shape})}
				onDecision={onDecision}
			/>
		</div>
	);
	const utils = render(card(dialog));
	return {
		...utils,
		onDecision,
		rerenderDialog: (shape: PermissionDialogShape | "unknown") => {
			utils.rerender(card(shape));
		},
	};
}

describe("PermissionCard", () => {
	it("renders the title, command block, and upstream's Deny (Esc, no keycap) / Allow once (⌘⏎)", () => {
		const {container} = renderCard();
		const card = container.querySelector("[data-approval-card-root]")!;
		const deny = screen.getByRole("button", {name: /^Deny/});
		const allow = screen.getByRole("button", {name: /^Allow once/});
		expect({
			label: card.getAttribute("aria-label"),
			title: card.querySelector("[data-permission-title]")?.textContent,
			command: card.querySelector("[data-permission-detail]")?.textContent,
			denyKeys: [...deny.querySelectorAll("kbd")].map((kbd) => kbd.textContent),
			allowKeys: [...allow.querySelectorAll("kbd")].map((kbd) => kbd.textContent),
			denyShortcut: deny.getAttribute("aria-keyshortcuts"),
			allowShortcut: allow.getAttribute("aria-keyshortcuts"),
			denyData: Object.fromEntries(Object.entries(deny.dataset)),
			allowData: Object.fromEntries(Object.entries(allow.dataset)),
			digits: [deny, allow].map((button) => {
				const label = button.querySelector<HTMLElement>("[data-approval-digit]");
				return [label?.dataset["approvalDigit"], label?.textContent];
			}),
		}).toStrictEqual({
			label: "Permission request: run this command",
			title: "Allow Claude to run this command?",
			command: "$ rm -rf dist",
			denyKeys: [],
			allowKeys: ["Ctrl", "⏎Enter"],
			denyShortcut: "Escape",
			allowShortcut: "Control+Enter",
			denyData: {approvalVariant: "secondary"},
			allowData: {approvalVariant: "primary", approvalPrimary: ""},
			digits: [
				["1", "Deny"],
				["2", "Allow once"],
			],
		});
	});

	it("lays out upstream's actions row: justified to the end, Deny first, then the allow group", () => {
		const {container} = renderCard({persistentAllow: "always"});
		const row = container.querySelector<HTMLElement>("[data-approval-card-actions]")!;
		const group = row.querySelector<HTMLElement>("[data-approval-allow]");
		const classes = (element: Element | null) => new Set(element?.getAttribute("class")?.split(/\s+/));
		const has = (element: Element | null, names: string[]) => names.filter((name) => classes(element).has(name));
		expect({
			row: has(row, ["flex", "flex-wrap", "items-start", "justify-end", "justify-between", "gap-x-3", "gap-y-2"]),
			children: [...row.children].map((child) => child.textContent),
			group: has(group, ["flex", "min-w-0", "flex-wrap", "items-start", "gap-2"]),
			grouped: [...(group?.querySelectorAll("button") ?? [])].map((button) => button.textContent),
		}).toStrictEqual({
			row: ["flex", "flex-wrap", "items-start", "justify-end", "gap-x-3", "gap-y-2"],
			children: ["Deny", "Always allow, Don’t ask again for this tool"],
			group: ["flex", "min-w-0", "flex-wrap", "items-start", "gap-2"],
			grouped: ["Always allow, Don’t ask again for this tool", ""],
		});
	});

	it("draws upstream's inline card presentation: outlined, transparent, unshadowed, its own container", () => {
		const {container} = renderCard();
		const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		const missing = (element: Element | null, expected: string[]) => {
			const actual = new Set(element?.getAttribute("class")?.split(/\s+/));
			return expected.filter((name) => !actual.has(name));
		};
		expect({
			presentation: card.dataset["approvalPresentation"],
			card: missing(card, ["card-ring", "@container", "rounded-card", "p-3"]),
			dockLook: ["shadow-[var(--approval-card-shadow)]", "bg-surface-2"].filter((name) =>
				card.classList.contains(name),
			),
			title: card.querySelector("[data-permission-title]")?.getAttribute("class"),
			value: card.querySelector("[data-permission-detail]")?.getAttribute("class"),
			codeCard: card
				.querySelector("[data-permission-detail] > [data-approval-value] > div")
				?.getAttribute("class"),
			gutter: card.querySelector("[data-permission-detail] .select-none")?.textContent,
			deny: missing(screen.getByRole("button", {name: /^Deny/}), [
				"h-6",
				"rounded-r5",
				"px-2",
				"text-[13px]/[19px]",
				"bg-fill-secondary",
				"shadow-field-drop",
			]),
			allow: missing(screen.getByRole("button", {name: /^Allow once/}), [
				"h-6",
				"rounded-r5",
				"px-2",
				"text-[13px]/[19px]",
				"bg-primary",
				"text-surface-1",
			]),
		}).toStrictEqual({
			presentation: "card",
			card: [],
			dockLook: [],
			title: "text-[13px]/[19px] font-normal min-w-0 break-words",
			value: "flow-root",
			codeCard:
				"epitaxy-code-size flex overflow-clip rounded-lg px-2 py-1 text-code bg-surface-1 dark:bg-surface-2 select-text [unicode-bidi:plaintext]",
			gutter: "$ ",
			deny: [],
			allow: [],
		});
	});

	it("spaces the card as upstream's inline permission card: 480px wide, 24px gaps, a tinted title band and 12px details", () => {
		const {container} = renderCard();
		const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		const body = card.querySelector<HTMLElement>("[data-approval-card-body]")!;
		const region = card.querySelector<HTMLElement>("[data-testid=approval-title-region]");
		const title = card.querySelector<HTMLElement>("[data-permission-title]")!;
		const value = card.querySelector<HTMLElement>("[data-permission-detail]")!;
		const classes = (element: Element | null) => new Set(element?.getAttribute("class")?.split(/\s+/));
		const has = (element: Element | null, names: string[]) => names.filter((name) => classes(element).has(name));
		expect({
			card: has(card, [
				"gap-[24px]",
				"w-full",
				"max-w-[480px]",
				"gap-3",
				"!pt-0",
				"overflow-clip",
				"max-h-[60vh]",
				"max-h-[max(60vh,calc(16rem*var(--cds-rem-scale,1)))]",
			]),
			regionIsFirstChild: card.firstElementChild === region,
			region: region?.getAttribute("class"),
			band: region?.firstElementChild?.getAttribute("class"),
			titleRow: title.parentElement?.getAttribute("class"),
			titleRowInBand: title.parentElement?.parentElement === region?.firstElementChild,
			body: has(body, ["gap-[24px]", "gap-2.5", "-mt-[18px]", "-mt-1"]),
			details: value.parentElement?.getAttribute("class"),
			detailsAreBodyChild: value.parentElement?.parentElement === body,
			detailsText: [...(value.parentElement?.children ?? [])].map((child) => child.textContent),
		}).toStrictEqual({
			card: [
				"gap-[24px]",
				"w-full",
				"max-w-[480px]",
				"!pt-0",
				"overflow-clip",
				"max-h-[max(60vh,calc(16rem*var(--cds-rem-scale,1)))]",
			],
			regionIsFirstChild: true,
			region: "shrink-0 overflow-y-auto max-h-[max(2rem,min(30vh,calc(60vh-10rem)))] -mx-3 px-3",
			band: "-mx-3 flex flex-col gap-1.5 bg-alpha-1 px-3 py-2",
			titleRow: "text-primary min-h-6 shrink-0 flex items-center gap-1",
			titleRowInBand: true,
			body: ["gap-[24px]", "-mt-[18px]"],
			details: "flex flex-col gap-[12px] empty:hidden",
			detailsAreBodyChild: true,
			detailsText: ["Remove the build output", "$ rm -rf dist"],
		});
	});

	it("paints the docked card and the waiting-input notice as upstream's dock backdrop: bg-surface-panel shadow-panel-sm", () => {
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
		expect({
			dock: has(container.querySelector("[data-approval-card-root]")),
			notice: has(container.querySelector("[data-waiting-input-notice]")),
		}).toStrictEqual({
			dock: ["bg-surface-2", "shadow-[var(--approval-card-shadow)]"],
			notice: ["bg-surface-2", "shadow-[var(--approval-card-shadow)]"],
		});
	});

	it("keeps the question and plan cards' shells without a title band", () => {
		const {container} = render(
			<ApprovalCardShell
				presentation="card"
				body={<span>Plan</span>}
				actions={<button type="button">Ok</button>}
			/>,
		);
		const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		expect({
			region: card.querySelector("[data-testid=approval-title-region]"),
			card: card.getAttribute("class"),
			body: card.querySelector("[data-approval-card-body]")?.getAttribute("class"),
		}).toStrictEqual({
			region: null,
			card: "@container relative isolate flex max-h-[60vh] flex-col rounded-card p-3 text-[13px]/[19px] text-primary focus-visible:outline-1 focus-visible:outline-fill-accent focus-visible:outline-offset-2 card-ring w-full max-w-[480px] gap-[24px]",
			body: "-mx-3 -mt-1 -mb-2 flex min-h-0 flex-col overflow-y-auto px-3 pt-1 pb-2 gap-[24px]",
		});
	});

	it("draws a Bash command's description and time-limit note under the title band", () => {
		const pending = findPendingPermission({
			sessionId: "session-test-100",
			isActive: true,
			notifications: [permissionNotification()],
			records: [assistantToolUse("t9", "Bash", {command: "ls", description: "List files", timeout: 120000})],
		})!;
		const {container} = render(
			<PermissionCard
				title={pending.title}
				detail={pending.detail}
				detailLang={pending.detailLang ?? null}
				detailNote={pending.detailNote ?? null}
				description={pending.description ?? null}
				clampTitle={pending.clampTitle === true}
				canAnswer
				onDecision={async () => {}}
			/>,
		);
		const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		const details = card.querySelector("[data-permission-detail]")?.parentElement;
		expect({
			title: card.querySelector("[data-permission-title]")?.textContent,
			label: card.getAttribute("aria-label"),
			details: [...(details?.children ?? [])].map((child) => child.textContent),
		}).toStrictEqual({
			title: "Allow Claude to run this command?",
			label: "Permission request: run this command",
			details: ["List files", "$ ls", "Time limit: 2 minutes."],
		});
	});

	it("draws upstream's detail note under a background Bash command", () => {
		const {container} = render(
			<PermissionCard
				title={{action: "run", meta: "Start the dev server"}}
				detail="npm run dev"
				detailNote="Keeps running in the background."
				canAnswer
				onDecision={async () => {}}
			/>,
		);
		const value = container.querySelector("[data-permission-detail]")!;
		const note = value.nextElementSibling;
		expect({tag: note?.tagName, className: note?.getAttribute("class"), text: note?.textContent}).toStrictEqual({
			tag: "P",
			className: "text-footnote text-ink-muted select-text break-words [unicode-bidi:plaintext]",
			text: "Keeps running in the background.",
		});
	});

	it("draws a Workflow's description and upstream's token warning, whose tasks pane link opens Background tasks", () => {
		const open = vi.fn<() => void>();
		const {container} = render(
			<BackgroundTasksOpenerProvider value={{open, running: new Map()}}>
				<PermissionCard
					title={{action: "run a workflow", meta: "noop-a"}}
					detail={null}
					description="Replies ok"
					tokenWarning
					canAnswer
					onDecision={async () => {}}
				/>
			</BackgroundTasksOpenerProvider>,
		);
		const details = [...(container.querySelector("[data-approval-card-body] > div")?.children ?? [])];
		expect(details.map((element) => [element.getAttribute("class"), element.textContent])).toStrictEqual([
			[
				"text-body text-secondary select-text break-words max-h-[calc(3*var(--text-body--line-height))] overflow-y-auto [unicode-bidi:plaintext]",
				"Replies ok",
			],
			[
				"rounded-lg bg-alpha-1 px-3 py-2.5 text-body text-secondary select-text break-words",
				"Dynamic workflows run many subagents in parallel and can use a lot of your usage limit. Stop them any time from the tasks pane.",
			],
		]);
		fireEvent.click(screen.getByRole("button", {name: "tasks pane"}));
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("hides the persistent option when the dialog has none", () => {
		renderCard();
		expect(screen.getAllByRole("button").map((button) => button.textContent)).toStrictEqual([
			"Deny",
			"Allow onceCtrl⏎Enter",
		]);
	});

	it.each([
		{persistentAllow: "always", label: "Always allow", scope: "Don’t ask again for this tool"},
		{persistentAllow: "perChat", label: "Allow for this session", scope: "Applies to this session only"},
	] as const)(
		"leads with upstream's primary $label split button and sends the persistent decision",
		({persistentAllow, label, scope}) => {
			const {onDecision} = renderCard({persistentAllow});
			const persistent = screen.getByRole("button", {name: `${label}, ${scope}`});
			const split = persistent.closest<HTMLElement>("[data-cds=SplitDropdownButton]");
			const labelSpan = persistent.querySelector<HTMLElement>("[data-approval-digit]");
			const facts = {
				buttons: screen
					.getAllByRole("button")
					.map((button) => button.getAttribute("aria-label") ?? button.textContent),
				group: split?.getAttribute("aria-label"),
				primaryFill: persistent.className.split(/\s+/).includes("bg-fill-primary"),
				labelData: labelSpan === null ? null : Object.fromEntries(Object.entries(labelSpan.dataset)),
				scope: [...persistent.querySelectorAll(".sr-only")].map((span) => [span.className, span.textContent]),
			};
			fireEvent.click(persistent);
			expect({...facts, calls: onDecision.mock.calls}).toStrictEqual({
				buttons: ["Deny", `${label}, ${scope}`, "More allow options"],
				group: label,
				primaryFill: true,
				labelData: {approvalDigit: "2", approvalPrimary: ""},
				scope: [["sr-only select-none", `, ${scope}`]],
				calls: [["always"]],
			});
		},
	);

	it("keeps Allow once in the split button's More allow options menu", async () => {
		const {onDecision} = renderCard({persistentAllow: "always"});
		await actAndSettle(() => {
			fireEvent.click(screen.getByRole("button", {name: "More allow options"}));
		});
		const items = screen.getAllByRole("menuitem");
		const facts = {
			items: items.map((item) => item.textContent),
			shortcut: items[0]?.getAttribute("aria-keyshortcuts"),
		};
		fireEvent.click(screen.getByRole("menuitem", {name: /^Allow once/}));
		expect({...facts, calls: onDecision.mock.calls}).toStrictEqual({
			items: ["Allow onceCtrl+Enter"],
			shortcut: "Control+Enter",
			calls: [["allow"]],
		});
	});

	describe("leading-allow preference, as upstream's epitaxy-approval-card-leading-allow", () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it("leads with Allow once and keeps Always allow, with its scope, in the menu when the stored lead is once", async () => {
			localStorage.setItem(APPROVAL_LEADING_ALLOW_KEY, "once");
			const {onDecision} = renderCard({persistentAllow: "always"});
			const primary = screen.getByRole("button", {name: /^Allow once/});
			const labelSpan = primary.querySelector<HTMLElement>("[data-approval-digit]");
			const facts = {
				buttons: screen
					.getAllByRole("button")
					.map((button) => button.getAttribute("aria-label") ?? button.textContent),
				shortcut: primary.getAttribute("aria-keyshortcuts"),
				labelData: labelSpan === null ? null : Object.fromEntries(Object.entries(labelSpan.dataset)),
			};
			await actAndSettle(() => {
				fireEvent.click(screen.getByRole("button", {name: "More allow options"}));
			});
			const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
			fireEvent.click(screen.getByRole("menuitem", {name: /^Always allow/}));
			expect({
				...facts,
				items,
				calls: onDecision.mock.calls,
				stored: localStorage.getItem(APPROVAL_LEADING_ALLOW_KEY),
			}).toStrictEqual({
				buttons: ["Deny", "Allow onceCtrl⏎Enter", "More allow options"],
				shortcut: "Control+Enter",
				labelData: {approvalDigit: "2", approvalPrimary: ""},
				items: ["Always allowDon’t ask again for this tool"],
				calls: [["always"]],
				stored: "always",
			});
		});

		it("sends allow from the Allow once primary", () => {
			localStorage.setItem(APPROVAL_LEADING_ALLOW_KEY, "once");
			const {onDecision} = renderCard({persistentAllow: "always"});
			fireEvent.click(screen.getByRole("button", {name: /^Allow once/}));
			expect(onDecision.mock.calls).toStrictEqual([["allow"]]);
		});

		it("stores once after Allow once is picked from an always-led menu, so the next card leads with it", async () => {
			const first = renderCard({persistentAllow: "always"});
			await actAndSettle(() => {
				fireEvent.click(screen.getByRole("button", {name: "More allow options"}));
			});
			fireEvent.click(screen.getByRole("menuitem", {name: /^Allow once/}));
			const stored = localStorage.getItem(APPROVAL_LEADING_ALLOW_KEY);
			first.unmount();
			renderCard({persistentAllow: "always"});
			expect({
				stored,
				buttons: screen
					.getAllByRole("button")
					.map((button) => button.getAttribute("aria-label") ?? button.textContent),
			}).toStrictEqual({
				stored: "once",
				buttons: ["Deny", "Allow onceCtrl⏎Enter", "More allow options"],
			});
		});

		it("leads with Always allow for an unknown stored value", () => {
			localStorage.setItem(APPROVAL_LEADING_ALLOW_KEY, "sometimes");
			renderCard({persistentAllow: "always"});
			expect(screen.getAllByRole("button").map((button) => button.textContent)).toStrictEqual([
				"Deny",
				"Always allow, Don’t ask again for this tool",
				"",
			]);
		});

		it.each([
			{persistentAllow: "always", label: "Always allow", scope: "Don’t ask again for this tool"},
			{persistentAllow: "perChat", label: "Allow for this session", scope: "Applies to this session only"},
		] as const)("tips the leading $label with its scope", ({persistentAllow, label, scope}) => {
			renderCard({persistentAllow});
			const primary = screen.getByRole("button", {name: `${label}, ${scope}`});
			vi.useFakeTimers();
			fireEvent.pointerEnter(primary.parentElement!);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			const tooltip = screen.getByRole("tooltip");
			expect({
				text: tooltip.textContent,
				describedBy: primary.getAttribute("aria-describedby") === tooltip.id,
			}).toStrictEqual({text: scope, describedBy: true});
		});
	});

	it("hides the card at once on a decision, before the answer resolves", async () => {
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const {container} = render(
			<PermissionCard title={{action: "run", meta: null}} detail="ls" canAnswer onDecision={onDecision} />,
		);
		fireEvent.click(screen.getByRole("button", {name: /^Allow once/}));
		const hidden = container.querySelector("[data-approval-card-root]") === null;
		await actAndSettle(() => {
			answer.resolve();
		});
		expect({
			hidden,
			afterResolve: container.querySelector("[data-approval-card-root]") === null,
			calls: onDecision.mock.calls,
		}).toStrictEqual({hidden: true, afterResolve: true, calls: [["allow"]]});
	});

	it("persists the decision as acknowledged once the answer is delivered, and not before or on a refusal", async () => {
		const answer = deferredAnswer();
		render(
			<PermissionCard
				title={{action: "run", meta: null}}
				detail="ls"
				canAnswer
				sessionId="s-permission-ack"
				answerKey="toolu_permission_ack"
				onDecision={async () => answer.promise}
			/>,
		);
		fireEvent.click(screen.getByRole("button", {name: /^Allow once/}));
		const sending = window.localStorage.getItem("acknowledged-tool-decisions");
		await actAndSettle(() => {
			answer.resolve();
		});
		const stored: unknown = JSON.parse(window.localStorage.getItem("acknowledged-tool-decisions") ?? "null");
		clearApprovalAnswered("s-permission-ack", "toolu_permission_ack");
		releaseAnswered("s-permission-ack");

		const refused = deferredAnswer();
		render(
			<PermissionCard
				title={{action: "run", meta: null}}
				detail="ls"
				canAnswer
				sessionId="s-permission-ack"
				answerKey="toolu_permission_refused"
				onDecision={async () => refused.promise}
			/>,
		);
		fireEvent.click(screen.getByRole("button", {name: "Deny"}));
		await actAndSettle(() => {
			refused.reject(new Error("herdr pane is gone"));
		});

		expect({
			sending,
			stored,
			refused: isApprovalAnswered("s-permission-ack", "toolu_permission_refused"),
		}).toStrictEqual({
			sending: null,
			stored: {
				"s-permission-ack": {
					toolu_permission_ack: {
						toolUseId: "toolu_permission_ack",
						toolName: "",
						acknowledgedAt: expect.any(Number) as number,
					},
				},
			},
			refused: false,
		});
	});

	it("brings the card back with the error when the answer fails", async () => {
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const {container} = render(
			<PermissionCard title={{action: "run", meta: null}} detail="ls" canAnswer onDecision={onDecision} />,
		);
		fireEvent.click(screen.getByRole("button", {name: "Deny"}));
		await actAndSettle(() => {
			answer.reject(new Error("herdr pane is gone"));
		});
		const card = container.querySelector("[data-approval-card-root]");
		expect({
			shown: card !== null,
			error: card?.querySelector(".text-extended-pink")?.textContent,
			buttons: screen
				.getAllByRole("button")
				.map((button) => [button.textContent, button.hasAttribute("disabled")]),
			spinners: container.querySelectorAll(".animate-spin").length,
		}).toStrictEqual({
			shown: true,
			error: "herdr pane is gone",
			buttons: [
				["Deny", false],
				["Allow onceCtrl⏎Enter", false],
			],
			spinners: 0,
		});
	});

	it("keeps an elicitation card up after a decision, the chosen button busy, until its ElicitationResult unmounts it", async () => {
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const {container} = render(
			<PermissionCard
				title={{action: "use my-mcp-server", meta: null}}
				detail={null}
				canAnswer
				hideOnDecision={false}
				onDecision={onDecision}
			/>,
		);
		fireEvent.click(screen.getByRole("button", {name: "Deny"}));
		const sending = {shown: container.querySelector("[data-approval-card-root]") !== null, buttons: heldButtons()};
		await actAndSettle(() => {
			answer.resolve();
		});
		expect({
			sending,
			answered: {shown: container.querySelector("[data-approval-card-root]") !== null, buttons: heldButtons()},
			calls: onDecision.mock.calls,
		}).toStrictEqual({
			sending: {
				shown: true,
				buttons: [
					{text: "Deny", label: "Sending…", busy: "true", disabled: false},
					{text: "Allow onceCtrl⏎Enter", label: null, busy: null, disabled: true},
				],
			},
			answered: {
				shown: true,
				buttons: [
					{text: "Deny", label: "Sending…", busy: "true", disabled: false},
					{text: "Allow onceCtrl⏎Enter", label: null, busy: null, disabled: true},
				],
			},
			calls: [["deny"]],
		});
	});

	it("marks Allow once busy after ⌘⏎ on a held elicitation card, and clears it when the answer fails", async () => {
		vi.useFakeTimers({toFake: ["performance"]});
		try {
			const answer = deferredAnswer();
			const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
			render(
				<PermissionCard
					title={{action: "use my-mcp-server", meta: null}}
					detail={null}
					canAnswer
					hideOnDecision={false}
					onDecision={onDecision}
				/>,
			);
			vi.advanceTimersByTime(400);
			fireEvent.keyDown(document.body, {key: "Enter", metaKey: true});
			const sending = heldButtons();
			await actAndSettle(() => {
				answer.reject(new Error("The terminal is not showing this elicitation"));
			});
			expect({sending, failed: heldButtons(), calls: onDecision.mock.calls}).toStrictEqual({
				sending: [
					{text: "Deny", label: null, busy: null, disabled: true},
					{text: "Allow onceCtrl⏎Enter", label: "Sending…", busy: "true", disabled: false},
				],
				failed: [
					{text: "Deny", label: null, busy: null, disabled: false},
					{text: "Allow onceCtrl⏎Enter", label: null, busy: null, disabled: false},
				],
				calls: [["allow"]],
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps an elicitation card up with the error when the terminal refuses the answer", async () => {
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const {container} = render(
			<PermissionCard
				title={{action: "use my-mcp-server", meta: null}}
				detail={null}
				canAnswer
				hideOnDecision={false}
				onDecision={onDecision}
			/>,
		);
		fireEvent.click(screen.getByRole("button", {name: "Deny"}));
		await actAndSettle(() => {
			answer.reject(new Error("The terminal is not showing this elicitation"));
		});
		const card = container.querySelector("[data-approval-card-root]");
		expect({
			shown: card !== null,
			error: card?.querySelector(".text-extended-pink")?.textContent,
			buttons: screen
				.getAllByRole("button")
				.map((button) => [button.textContent, button.hasAttribute("disabled")]),
		}).toStrictEqual({
			shown: true,
			error: "The terminal is not showing this elicitation",
			buttons: [
				["Deny", false],
				["Allow onceCtrl⏎Enter", false],
			],
		});
	});

	it("buttons send their decisions", () => {
		const {onDecision} = renderCard();
		fireEvent.click(screen.getByRole("button", {name: /^Allow once/}));
		expect(onDecision.mock.calls).toStrictEqual([["allow"]]);
	});

	describe("deny-first, as upstream's defaultToNo card (the classifier fallback's No-first dialog)", () => {
		const DENY_FIRST = {denyFirst: true, persistent: false, auto: false} as const;

		function actions() {
			const deny = screen.getByRole("button", {name: /^Deny/});
			const allow = screen.getByRole("button", {name: /^Allow once/});
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

		const denyFirstActions = {
			buttons: ["Deny", "Allow once"],
			denyData: {approvalVariant: "primary", approvalPrimary: ""},
			allowData: {approvalVariant: "secondary"},
			denyShortcut: null,
			allowShortcut: null,
			allowKeys: 0,
			denyFill: true,
			allowFill: false,
		};

		it.each([
			{name: "a deny-first dialog", dialog: DENY_FIRST},
			{name: "a dialog whose shape is still unknown", dialog: "unknown"},
		] as const)("draws Deny primary and Allow once secondary with no keycap or split on $name", ({dialog}) => {
			renderCard({persistentAllow: "always", dialog});
			expect(actions()).toStrictEqual(denyFirstActions);
		});

		it("drops the persistent option the hook offered when the dialog on screen has no persistent row", () => {
			renderCard({persistentAllow: "always", dialog: {denyFirst: false, persistent: false, auto: true}});
			expect(screen.getAllByRole("button").map((button) => button.textContent)).toStrictEqual([
				"Deny",
				"Allow onceCtrl⏎Enter",
			]);
		});

		it("keeps the hook's persistent option when the dialog on screen has its row", () => {
			renderCard({persistentAllow: "always", dialog: {denyFirst: false, persistent: true, auto: false}});
			expect(
				screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent),
			).toStrictEqual(["Deny", "Always allow, Don’t ask again for this tool", "More allow options"]);
		});

		describe("keys", () => {
			beforeEach(() => {
				vi.useFakeTimers({toFake: ["performance"]});
			});
			afterEach(() => {
				vi.useRealTimers();
			});

			it.each([{dialog: DENY_FIRST}, {dialog: "unknown"}] as const)(
				"leaves ⌘⏎, ⇧⌘⏎ and Esc inert on $dialog, as upstream's vn",
				({dialog}) => {
					const {onDecision} = renderCard({persistentAllow: "always", dialog});
					vi.advanceTimersByTime(400);
					fireEvent.keyDown(document.body, {key: "Enter", metaKey: true});
					fireEvent.keyDown(document.body, {key: "Enter", metaKey: true, shiftKey: true});
					fireEvent.keyDown(document.body, {key: "Escape"});
					expect(onDecision.mock.calls).toStrictEqual([]);
				},
			);

			it("redraws as the shape on screen once it arrives, with the split and ⌘⏎ back", () => {
				const {onDecision, rerenderDialog} = renderCard({persistentAllow: "always", dialog: "unknown"});
				rerenderDialog({denyFirst: false, persistent: true, auto: false});
				const buttons = screen
					.getAllByRole("button")
					.map((button) => button.getAttribute("aria-label") ?? button.textContent);
				vi.advanceTimersByTime(400);
				fireEvent.keyDown(document.body, {key: "Enter", metaKey: true});
				expect({buttons, calls: onDecision.mock.calls}).toStrictEqual({
					buttons: ["Deny", "Always allow, Don’t ask again for this tool", "More allow options"],
					calls: [["allow"]],
				});
			});
		});
	});

	describe("keys", () => {
		beforeEach(() => {
			vi.useFakeTimers({toFake: ["performance"]});
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		/** Moves past upstream's 400ms arm grace after the card mounts. */
		function arm() {
			vi.advanceTimersByTime(400);
		}

		it.each([
			{init: {key: "Escape"}, decision: "deny"},
			{init: {key: "Enter", metaKey: true}, decision: "allow"},
		])("$init.key answers while nothing is focused", ({init, decision}) => {
			const {onDecision} = renderCard();
			arm();
			fireEvent.keyDown(document.body, init);
			expect(onDecision.mock.calls).toStrictEqual([[decision]]);
		});

		it("binds no digits on the inline card", () => {
			const {onDecision} = renderCard({persistentAllow: "always"});
			arm();
			for (const key of ["1", "2", "3"]) fireEvent.keyDown(document.body, {key});
			expect(onDecision.mock.calls).toStrictEqual([]);
		});

		it("listens on window in the capture phase and stops the key there", () => {
			const {onDecision} = renderCard();
			arm();
			const bubbled = vi.fn<(event: Event) => void>();
			document.addEventListener("keydown", bubbled);
			fireEvent.keyDown(document.body, {key: "Escape"});
			document.removeEventListener("keydown", bubbled);
			expect({calls: onDecision.mock.calls, bubbled: bubbled.mock.calls.length}).toStrictEqual({
				calls: [["deny"]],
				bubbled: 0,
			});
		});

		it("swallows Esc and ⌘⏎ within 400ms of mounting, then answers", () => {
			const {onDecision} = renderCard();
			const early = fireEvent.keyDown(document.body, {key: "Escape"});
			fireEvent.keyDown(document.body, {key: "Enter", metaKey: true});
			vi.advanceTimersByTime(399);
			fireEvent.keyDown(document.body, {key: "Escape"});
			const callsInGrace = [...onDecision.mock.calls];
			vi.advanceTimersByTime(1);
			fireEvent.keyDown(document.body, {key: "Escape"});
			expect({early, callsInGrace, calls: onDecision.mock.calls}).toStrictEqual({
				early: false,
				callsInGrace: [],
				calls: [["deny"]],
			});
		});

		it("swallows repeated Esc and ⌘⏎", () => {
			const {onDecision} = renderCard();
			arm();
			const results = [
				fireEvent.keyDown(document.body, {key: "Escape", repeat: true}),
				fireEvent.keyDown(document.body, {key: "Enter", metaKey: true, repeat: true}),
			];
			expect({results, calls: onDecision.mock.calls}).toStrictEqual({results: [false, false], calls: []});
		});

		it("yields Esc and ⌘⏎ to IME composition, and ⌘⏎ to alt", () => {
			const {onDecision} = renderCard();
			arm();
			fireEvent.keyDown(document.body, {key: "Escape", isComposing: true});
			fireEvent.keyDown(document.body, {key: "Enter", metaKey: true, isComposing: true});
			fireEvent.keyDown(document.body, {key: "Enter", metaKey: true, altKey: true});
			expect(onDecision.mock.calls).toStrictEqual([]);
		});

		it("answers from the empty composer", async () => {
			const {onDecision} = renderCard();
			arm();
			const prompt = screen.getByRole("textbox", {name: "Prompt"});
			prompt.focus();
			await actAndSettle(() => {
				fireEvent.keyDown(prompt, {key: "Enter", metaKey: true});
			});
			expect(onDecision.mock.calls).toStrictEqual([["allow"]]);
		});

		it("answers from the focused card", async () => {
			const {container, onDecision} = renderCard();
			arm();
			const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
			card.focus();
			await actAndSettle(() => {
				fireEvent.keyDown(card, {key: "Escape"});
			});
			expect(onDecision.mock.calls).toStrictEqual([["deny"]]);
		});

		it("leaves ⌘⏎ to a composer draft", () => {
			const {onDecision} = renderCard();
			arm();
			const prompt = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
			fireEvent.change(prompt, {target: {value: "hello"}});
			prompt.focus();
			const result = fireEvent.keyDown(prompt, {key: "Enter", metaKey: true});
			expect({result, calls: onDecision.mock.calls}).toStrictEqual({result: true, calls: []});
		});

		it("yields Esc to an open composer popup", () => {
			const {onDecision} = renderCard();
			arm();
			const prompt = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
			prompt.setAttribute("aria-controls", "slash-menu");
			prompt.focus();
			fireEvent.keyDown(prompt, {key: "Escape"});
			expect(onDecision.mock.calls).toStrictEqual([]);
		});

		it("ignores keys inside an open dialog", () => {
			const {onDecision} = renderCard();
			arm();
			const dialog = document.createElement("div");
			dialog.setAttribute("role", "dialog");
			const button = document.createElement("button");
			dialog.append(button);
			document.body.append(dialog);
			button.focus();
			fireEvent.keyDown(button, {key: "Escape"});
			fireEvent.keyDown(button, {key: "Enter", metaKey: true});
			dialog.remove();
			expect(onDecision.mock.calls).toStrictEqual([]);
		});

		it.each([
			{focus: "body", calls: []},
			{focus: "card", calls: [["always"]]},
			{focus: "composer", calls: [["always"]]},
		] as const)("sends the persistent grant on ⇧⌘⏎ with focus on the $focus: $calls", async ({focus, calls}) => {
			const {container, onDecision} = renderCard({persistentAllow: "always"});
			arm();
			const target = {
				body: document.body,
				card: container.querySelector<HTMLElement>("[data-approval-card-root]")!,
				composer: screen.getByRole("textbox", {name: "Prompt"}),
			}[focus];
			target.focus();
			await actAndSettle(() => {
				fireEvent.keyDown(target, {key: "Enter", metaKey: true, shiftKey: true});
			});
			expect(onDecision.mock.calls).toStrictEqual(calls);
		});

		it("ignores ⇧⌘⏎ without a persistent option", () => {
			const {container, onDecision} = renderCard();
			arm();
			const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
			card.focus();
			fireEvent.keyDown(card, {key: "Enter", metaKey: true, shiftKey: true});
			expect(onDecision.mock.calls).toStrictEqual([]);
		});

		it("disables the buttons and keys without a writable live pane", () => {
			const {onDecision} = renderCard({canAnswer: false});
			arm();
			fireEvent.keyDown(document.body, {key: "Escape"});
			expect({
				calls: onDecision.mock.calls,
				allowDisabled: screen.getByRole<HTMLButtonElement>("button", {name: /^Allow once/}).disabled,
				hint: screen.getByText("Answer in the terminal").textContent,
			}).toStrictEqual({calls: [], allowDisabled: true, hint: "Answer in the terminal"});
		});
	});

	describe("card root", () => {
		const focusedLabel = () =>
			document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent;

		it("roams the buttons with the arrow keys, wrapping at both ends", () => {
			const {container} = renderCard();
			const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
			const deny = screen.getByRole("button", {name: "Deny"});
			deny.focus();
			const seen: Array<string | null | undefined> = [];
			for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]) {
				fireEvent.keyDown(document.activeElement ?? card, {key});
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

		it("enters the card from its root: arrows start at an end, Enter focuses the primary", () => {
			const {container} = renderCard({persistentAllow: "always"});
			const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
			const seen: Array<string | null | undefined> = [];
			card.focus();
			fireEvent.keyDown(card, {key: "ArrowRight"});
			seen.push(focusedLabel());
			card.focus();
			fireEvent.keyDown(card, {key: "ArrowLeft"});
			seen.push(focusedLabel());
			card.focus();
			fireEvent.keyDown(card, {key: "Enter"});
			seen.push(focusedLabel());
			expect(seen).toStrictEqual(["Deny", "More allow options", "Always allow, Don’t ask again for this tool"]);
		});

		it("keeps clicks inside the card from reaching the transcript", () => {
			const {container} = renderCard();
			const outer = vi.fn<(event: Event) => void>();
			document.addEventListener("click", outer);
			fireEvent.click(container.querySelector("[data-permission-detail]")!);
			document.removeEventListener("click", outer);
			expect(outer.mock.calls.length).toStrictEqual(0);
		});
	});
});

describe("PermissionCard enter fade, as upstream's epitaxy-approval-inline-enter", () => {
	const enterFacts = (container: HTMLElement) => {
		const root = container.querySelector("[data-approval-card-root]");
		return {
			classes: (root?.className ?? "").split(" ").filter((name) => name.includes("animate-")),
			skip: root?.hasAttribute("data-skip-approval-enter"),
		};
	};

	it("fades a live arrival in, without motion under reduced motion", () => {
		const {container} = render(
			<PermissionCard
				enterKey="enter-live-1"
				title={{action: "run", meta: null}}
				detail="ls"
				canAnswer
				onDecision={async () => {}}
			/>,
		);

		expect(enterFacts(container)).toStrictEqual({
			classes: ["animate-approval-inline-enter", "motion-reduce:animate-none"],
			skip: false,
		});
	});

	it("skips the fade when the same prompt remounts", () => {
		const card = () => (
			<PermissionCard
				enterKey="enter-remount-1"
				title={{action: "run", meta: null}}
				detail="ls"
				canAnswer
				onDecision={async () => {}}
			/>
		);
		render(card()).unmount();
		const {container} = render(card());

		expect(enterFacts(container)).toStrictEqual({classes: [], skip: true});
	});

	it("skips the fade after a reload that already showed the prompt", () => {
		window.sessionStorage.setItem("approval-enter-seen:enter-reload-1", "1");
		const {container} = render(
			<PermissionCard
				enterKey="enter-reload-1"
				title={{action: "run", meta: null}}
				detail="ls"
				canAnswer
				onDecision={async () => {}}
			/>,
		);

		expect(enterFacts(container)).toStrictEqual({classes: [], skip: true});
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
}) {
	const shown = findPendingPermission({sessionId, isActive: true, notifications, records, awaitingPermission});
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

describe("permission prompt answered across a signal handoff", () => {
	const records = [assistantToolUse("toolu_handoff_1", "Bash", {command: "ls", description: "List"})];
	// Answering arms a module-level session hold that would leak into other files in the shared pool.
	afterEach(() => {
		for (const sessionId of ["session-handoff-2", "session-handoff-3", "session-handoff-4"])
			releaseAnswered(sessionId);
	});

	it("names the tool call the prompt holds, whichever signal describes it", () => {
		const signals = {sessionId: "session-test-100", isActive: true, records};
		expect({
			notified: findPendingPermission({...signals, notifications: [permissionNotification()]})?.toolUseId,
			registryOnly: findPendingPermission({...signals, notifications: [], awaitingPermission: true})?.toolUseId,
			noCall: findPendingPermission({...signals, records: [], notifications: [permissionNotification()]})
				?.toolUseId,
		}).toStrictEqual({notified: "toolu_handoff_1", registryOnly: "toolu_handoff_1", noCall: null});
	});

	it("keeps an answered card hidden when the notification clears before the tool result lands", () => {
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const props = {sessionId: "session-handoff-2", records, awaitingPermission: true, onDecision};
		const notification = permissionNotification({sessionId: "session-handoff-2"});
		const {container, rerender} = render(<PermissionSlot {...props} notifications={[notification]} />);
		fireEvent.click(screen.getByRole("button", {name: /^Allow once/}));
		const gateAtClick = container.querySelector("[data-gate]")?.getAttribute("data-gate");
		rerender(<PermissionSlot {...props} notifications={[]} />);

		expect({
			gateAtClick,
			card: container.querySelector("[data-approval-card-root]"),
			gate: container.querySelector("[data-gate]")?.getAttribute("data-gate"),
			calls: onDecision.mock.calls,
		}).toStrictEqual({gateAtClick: "released", card: null, gate: "released", calls: [["allow"]]});
	});

	it("keeps one card node and fades it in once when the notification follows the registry wait", () => {
		const notification = permissionNotification({sessionId: "session-handoff-3"});
		// Its own call id: the enter fade is remembered per prompt for the whole tab.
		const fadeRecords = [assistantToolUse("toolu_handoff_3", "Bash", {command: "ls", description: "List"})];
		const props = {
			sessionId: "session-handoff-3",
			records: fadeRecords,
			awaitingPermission: true,
			onDecision: async () => {},
		};
		const {container, rerender} = render(<PermissionSlot {...props} notifications={[]} />);
		const first = container.querySelector("[data-approval-card-root]");
		const firstEnters = first?.className.includes("animate-approval-inline-enter");
		rerender(<PermissionSlot {...props} notifications={[notification]} />);
		const second = container.querySelector("[data-approval-card-root]");

		expect({
			sameNode: first !== null && first === second,
			firstEnters,
			secondEnters: second?.className.includes("animate-approval-inline-enter"),
		}).toStrictEqual({sameNode: true, firstEnters: true, secondEnters: true});
	});

	it("clears the answered mark and shows the error when the decision is rejected", async () => {
		const answer = deferredAnswer();
		const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => answer.promise);
		const notification = permissionNotification({sessionId: "session-handoff-4"});
		const {container} = render(
			<PermissionSlot
				sessionId="session-handoff-4"
				notifications={[notification]}
				records={records}
				awaitingPermission
				onDecision={onDecision}
			/>,
		);
		fireEvent.click(screen.getByRole("button", {name: "Deny"}));
		const markedAtClick = isApprovalAnswered("session-handoff-4", "toolu_handoff_1");
		await actAndSettle(() => {
			answer.reject(new Error("herdr pane is gone"));
		});

		expect({
			markedAtClick,
			marked: isApprovalAnswered("session-handoff-4", "toolu_handoff_1"),
			gate: container.querySelector("[data-gate]")?.getAttribute("data-gate"),
			error: container.querySelector("[data-approval-card-root] .text-extended-pink")?.textContent,
		}).toStrictEqual({markedAtClick: true, marked: false, gate: "pending", error: "herdr pane is gone"});
	});
});
