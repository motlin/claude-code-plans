// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {actAndSettle} from "./act-and-settle";
import type {ComponentProps} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {BackgroundTasksOpenerProvider} from "../src/components/background-tasks-opener-context";
import {PermissionCard} from "../src/components/permission-card";
import {findPendingPermission, permissionDecisionForKey, type PermissionNotification} from "../src/lib/permission-card";
import type {PersistentAllowKind} from "../src/lib/permission-suggestions";

afterEach(cleanup);

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
			title: {action: "run", meta: "Remove the build output"},
			detail: "rm -rf dist",
		});
	});

	it.each([
		{
			input: {command: "npm run dev", description: "Start the dev server", run_in_background: true},
			expected: {
				title: {action: "run", meta: "Start the dev server"},
				detail: "npm run dev",
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
				title: {action: "run", meta: "Fetch x"},
				detail: "curl x",
				detailNote: "Runs outside Claude's sandbox. Keeps running in the background.",
			},
		},
		{
			input: {command: "curl x", description: "curl x", dangerouslyDisableSandbox: true},
			expected: {
				title: {action: "run", meta: null},
				detail: "curl x",
				detailNote: "Runs outside Claude's sandbox.",
			},
		},
	])("notes a Bash command's sandbox and background flags as upstream does ($input.command)", ({input, expected}) => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
				isActive: true,
				notifications: [permissionNotification()],
				records: [assistantToolUse("t2", "Bash", input)],
			}),
		).toStrictEqual({notificationId: "notification-test-100", ...expected});
	});

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
			title: {action: "run a workflow", meta: "noop-a"},
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
			title: {action: "run", meta: "Remove the build output"},
			detail: "rm -rf dist",
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
			title: {action: "write", meta: "b.ts"},
			detail: "/repo/b.ts",
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
				title: {action: "run", meta: "Open the oxfmt comment PR and check the other test"},
				detail: "gh pr create --fill",
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
			title: {action: "run", meta: "Remove the build output"},
			detail: "rm -rf dist",
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
			title: "Allow Claude to run Remove the build output?",
			parts: [
				[PRIMARY, "run"],
				[PRIMARY, "Remove the build output"],
			],
			label: "Permission request: run",
			detail: "rm -rf dist",
		},
		{
			tool: "Bash",
			input: {command: "rm -rf dist"},
			title: "Allow Claude to run?",
			parts: [[PRIMARY, "run"]],
			label: "Permission request: run",
			detail: "rm -rf dist",
		},
		{
			tool: "Read",
			input: {file_path: "/repo/src/a.ts"},
			title: "Allow Claude to read a.ts?",
			parts: [
				[PRIMARY, "read"],
				[PRIMARY, "a.ts"],
			],
			label: "Permission request: read",
			detail: "/repo/src/a.ts",
		},
		{
			tool: "MultiEdit",
			input: {file_path: "/repo/src/b.ts", edits: []},
			title: "Allow Claude to edit b.ts?",
			parts: [
				[PRIMARY, "edit"],
				[PRIMARY, "b.ts"],
			],
			label: "Permission request: edit",
			detail: "/repo/src/b.ts",
		},
		{
			tool: "NotebookEdit",
			input: {notebook_path: "/repo/n.ipynb", new_source: "x"},
			title: "Allow Claude to edit n.ipynb?",
			parts: [
				[PRIMARY, "edit"],
				[PRIMARY, "n.ipynb"],
			],
			label: "Permission request: edit",
			detail: "/repo/n.ipynb",
		},
		{
			tool: "Grep",
			input: {pattern: "TODO", path: "/repo"},
			title: "Allow Claude to search TODO?",
			parts: [
				[PRIMARY, "search"],
				[PRIMARY, "TODO"],
			],
			label: "Permission request: search",
			detail: null,
		},
		{
			tool: "WebSearch",
			input: {query: "vitest jsdom"},
			title: "Allow Claude to search the web vitest jsdom?",
			parts: [
				[PRIMARY, "search the web"],
				[PRIMARY, "vitest jsdom"],
			],
			label: "Permission request: search the web",
			detail: null,
		},
		{
			tool: "Skill",
			input: {skill: "commit", args: "--all"},
			title: "Allow Claude to run skill /commit?",
			parts: [
				[PRIMARY, "run skill"],
				[PRIMARY, "/commit"],
			],
			label: "Permission request: run skill",
			detail: "--all",
		},
		{
			tool: "Agent",
			input: {description: "Find the bug", prompt: "look"},
			title: "Allow Claude to run an agent Find the bug?",
			parts: [
				[PRIMARY, "run an agent"],
				[PRIMARY, "Find the bug"],
			],
			label: "Permission request: run an agent",
			detail: null,
		},
		{
			tool: "Workflow",
			input: {name: "upstream-sync-noop", description: "Does nothing"},
			title: "Allow Claude to run a workflow upstream-sync-noop?",
			parts: [
				[PRIMARY, "run a workflow"],
				[PRIMARY, "upstream-sync-noop"],
			],
			label: "Permission request: run a workflow",
			detail: null,
		},
		{
			tool: "mcp__github__create_issue",
			input: {title: "Bug", labels: ["a"]},
			title: "Allow Claude to use mcp__github__create_issue?",
			parts: [[PRIMARY, "use mcp__github__create_issue"]],
			label: "Permission request: use mcp__github__create_issue",
			detail: '{\n  "title": "Bug",\n  "labels": [\n    "a"\n  ]\n}',
		},
	])("titles $tool $input as upstream does", ({tool, input, title, parts, label, detail}) => {
		const pending = findPendingPermission({
			sessionId: "session-test-100",
			isActive: true,
			notifications: [permissionNotification()],
			records: [assistantToolUse("t9", tool, input)],
		})!;
		const {container} = render(
			<PermissionCard title={pending.title} detail={pending.detail} canAnswer onDecision={async () => {}} />,
		);
		const card = container.querySelector("[data-approval-card-root]")!;
		const value = card.querySelector("[data-permission-title] [data-approval-value]");
		expect({
			title: value?.textContent,
			parts: [...(value?.children ?? [])].map((span) => [span.className, span.textContent]),
			label: card.getAttribute("aria-label"),
			detail: card.querySelector("[data-permission-detail]")?.textContent ?? null,
		}).toStrictEqual({
			title,
			parts,
			label,
			detail,
		});
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

function renderCard({
	canAnswer = true,
	persistentAllow = null,
}: {canAnswer?: boolean; persistentAllow?: PersistentAllowKind | null} = {}) {
	const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => {});
	const utils = render(
		<div>
			<div data-focus-region="composer">
				<div data-composer-card>
					<textarea aria-label="Prompt" />
				</div>
			</div>
			<PermissionCard
				title={{action: "run", meta: "Remove the build output"}}
				detail="rm -rf dist"
				canAnswer={canAnswer}
				persistentAllow={persistentAllow}
				onDecision={onDecision}
			/>
		</div>,
	);
	return {...utils, onDecision};
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
			label: "Permission request: run",
			title: "Allow Claude to run Remove the build output?",
			command: "rm -rf dist",
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
			card: missing(card, ["card-ring", "@container", "rounded-r7", "p-3"]),
			dockLook: ["shadow-[var(--approval-card-shadow)]", "bg-surface-popover"].filter((name) =>
				card.classList.contains(name),
			),
			title: missing(card.querySelector("[data-permission-title]"), ["text-[13px]/[19px]", "font-[580]"]),
			value: card.querySelector("[data-permission-detail]")?.getAttribute("class"),
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
			title: [],
			value: "bg-alpha-1 rounded-r4 py-2 px-3 text-code text-secondary whitespace-pre-wrap break-words select-text [unicode-bidi:plaintext]",
			deny: [],
			allow: [],
		});
	});

	it("spaces the card as upstream's inline permission card: 480px wide, 24px gaps, a 10px title block and 12px details", () => {
		const {container} = renderCard();
		const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		const body = card.querySelector<HTMLElement>("[data-approval-card-body]")!;
		const title = card.querySelector<HTMLElement>("[data-permission-title]")!;
		const value = card.querySelector<HTMLElement>("[data-permission-detail]")!;
		const classes = (element: Element | null) => new Set(element?.getAttribute("class")?.split(/\s+/));
		const has = (element: Element | null, names: string[]) => names.filter((name) => classes(element).has(name));
		expect({
			card: has(card, ["gap-[24px]", "w-full", "max-w-[480px]", "gap-3"]),
			body: has(body, ["gap-[24px]", "gap-2.5"]),
			titleBlock: has(title.parentElement, ["flex", "flex-col", "gap-[10px]"]),
			titleBlockParentIsBody: title.parentElement?.parentElement === body,
			details: has(value.parentElement, ["flex", "flex-col", "gap-[12px]"]),
			detailsFollowTitle: title.nextElementSibling === value.parentElement,
		}).toStrictEqual({
			card: ["gap-[24px]", "w-full", "max-w-[480px]"],
			body: ["gap-[24px]"],
			titleBlock: ["flex", "flex-col", "gap-[10px]"],
			titleBlockParentIsBody: true,
			details: ["flex", "flex-col", "gap-[12px]"],
			detailsFollowTitle: true,
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
			<BackgroundTasksOpenerProvider value={{open, running: new Set()}}>
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
		const title = container.querySelector("[data-permission-title]")!;
		const details = [...(title.nextElementSibling?.children ?? [])];
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
			items: ["Allow onceCtrl+⏎"],
			shortcut: "Control+Enter",
			calls: [["allow"]],
		});
	});

	it("buttons send their decisions", () => {
		const {onDecision} = renderCard();
		fireEvent.click(screen.getByRole("button", {name: /^Allow once/}));
		expect(onDecision.mock.calls).toStrictEqual([["allow"]]);
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

		it("answers from the empty composer and from the focused card", async () => {
			const {container, onDecision} = renderCard();
			arm();
			const prompt = screen.getByRole("textbox", {name: "Prompt"});
			prompt.focus();
			await actAndSettle(() => {
				fireEvent.keyDown(prompt, {key: "Enter", metaKey: true});
			});
			const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
			card.focus();
			await actAndSettle(() => {
				fireEvent.keyDown(card, {key: "Escape"});
			});
			expect(onDecision.mock.calls).toStrictEqual([["allow"], ["deny"]]);
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

		it("sends the persistent grant on ⇧⌘⏎ only with focus in the card or the empty composer", async () => {
			const {container, onDecision} = renderCard({persistentAllow: "always"});
			arm();
			const press = async (target: HTMLElement) => {
				target.focus();
				await actAndSettle(() => {
					fireEvent.keyDown(target, {key: "Enter", metaKey: true, shiftKey: true});
				});
			};
			await press(document.body);
			const fromBody = [...onDecision.mock.calls];
			await press(container.querySelector<HTMLElement>("[data-approval-card-root]")!);
			await press(screen.getByRole("textbox", {name: "Prompt"}));
			expect({fromBody, calls: onDecision.mock.calls}).toStrictEqual({
				fromBody: [],
				calls: [["always"], ["always"]],
			});
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
