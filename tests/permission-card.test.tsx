// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {actAndSettle} from "./act-and-settle";
import type {ComponentProps} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {PermissionCard} from "../src/components/permission-card";
import {findPendingPermission, permissionDecisionForKey, type PermissionNotification} from "../src/lib/permission-card";

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
			title: "Allow Claude to run Remove the build output?",
			command: "rm -rf dist",
		});
	});

	it("uses the tool name and its main input for other tools", () => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
				isActive: true,
				notifications: [permissionNotification()],
				records: [assistantToolUse("t3", "Write", {file_path: "/repo/b.ts", content: "x"})],
			}),
		).toStrictEqual({
			notificationId: "notification-test-100",
			title: "Allow Claude to use Write?",
			command: "/repo/b.ts",
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
			title: "Claude needs your permission to use Bash",
			command: null,
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
				title: "Allow Claude to run Open the oxfmt comment PR and check the other test?",
				command: "gh pr create --fill",
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
			title: "Allow Claude to run Remove the build output?",
			command: "rm -rf dist",
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

describe("permissionDecisionForKey", () => {
	const plain = {metaKey: false, ctrlKey: false, altKey: false, shiftKey: false};

	it.each([
		{event: {...plain, key: "1"}, decision: "deny"},
		{event: {...plain, key: "Escape"}, decision: "deny"},
		{event: {...plain, key: "2"}, decision: "allow"},
		{event: {...plain, key: "Enter", metaKey: true}, decision: "allow"},
		{event: {...plain, key: "Enter", ctrlKey: true}, decision: "allow"},
		{event: {...plain, key: "Enter"}, decision: null},
		{event: {...plain, key: "3"}, decision: null},
		{event: {...plain, key: "1", metaKey: true}, decision: null},
		{event: {...plain, key: "Escape", shiftKey: true}, decision: null},
	])("maps $event.key to $decision", ({event, decision}) => {
		expect(permissionDecisionForKey(event)).toStrictEqual(decision);
	});
});

function renderCard({canAnswer = true}: {canAnswer?: boolean} = {}) {
	const onDecision = vi.fn<ComponentProps<typeof PermissionCard>["onDecision"]>(async () => {});
	const utils = render(
		<div>
			<div data-focus-region="composer">
				<textarea aria-label="Prompt" />
			</div>
			<PermissionCard
				title="Allow Claude to run Remove the build output?"
				command="rm -rf dist"
				canAnswer={canAnswer}
				onDecision={onDecision}
			/>
		</div>,
	);
	return {...utils, onDecision};
}

describe("PermissionCard", () => {
	it("renders the title, command block, and upstream's Deny (Esc) / Allow once (⌘⏎)", () => {
		const {container} = renderCard();
		const card = container.querySelector("[data-approval-card-root]")!;
		const deny = screen.getByRole("button", {name: /^Deny/});
		const allow = screen.getByRole("button", {name: /^Allow once/});
		expect({
			label: card.getAttribute("aria-label"),
			title: card.querySelector("[data-permission-title]")?.textContent,
			command: card.querySelector("[data-approval-value]")?.textContent,
			denyKeys: [...deny.querySelectorAll("kbd")].map((kbd) => kbd.textContent),
			allowKeys: [...allow.querySelectorAll("kbd")].map((kbd) => kbd.textContent),
		}).toStrictEqual({
			label: "Permission request: run",
			title: "Allow Claude to run Remove the build output?",
			command: "rm -rf dist",
			denyKeys: ["Esc"],
			allowKeys: ["Ctrl", "⏎Enter"],
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
			card: missing(card, ["card-ring", "@container", "rounded-r7", "gap-3", "p-3"]),
			dockLook: ["shadow-[var(--approval-card-shadow)]", "bg-surface-popover"].filter((name) =>
				card.classList.contains(name),
			),
			title: missing(card.querySelector("[data-permission-title]"), ["text-[13px]/[19px]", "font-[580]"]),
			value: missing(card.querySelector("[data-approval-value]"), [
				"font-mono",
				"text-[12px]/[17px]",
				"text-secondary",
				"bg-alpha-1",
				"rounded-r4",
				"px-3",
				"py-2",
			]),
			deny: missing(screen.getByRole("button", {name: /^Deny/}), [
				"h-6",
				"rounded-r5",
				"px-2",
				"text-[13px]/[19px]",
				"border",
				"border-strong",
			]),
			allow: missing(screen.getByRole("button", {name: /^Allow once/}), [
				"h-6",
				"rounded-r5",
				"px-2",
				"text-[13px]/[19px]",
				"bg-primary",
				"text-surface-1",
			]),
		}).toStrictEqual({presentation: "card", card: [], dockLook: [], title: [], value: [], deny: [], allow: []});
	});

	it("buttons send their decisions", () => {
		const {onDecision} = renderCard();
		fireEvent.click(screen.getByRole("button", {name: /^Allow once/}));
		expect(onDecision.mock.calls).toStrictEqual([["allow"]]);
	});

	it.each([
		{init: {key: "1"}, decision: "deny"},
		{init: {key: "Escape"}, decision: "deny"},
		{init: {key: "2"}, decision: "allow"},
		{init: {key: "Enter", metaKey: true}, decision: "allow"},
	])("$init.key answers while nothing is focused", ({init, decision}) => {
		const {onDecision} = renderCard();
		fireEvent.keyDown(document.body, init);
		expect(onDecision.mock.calls).toStrictEqual([[decision]]);
	});

	it("answers from the empty composer and from the focused card", async () => {
		const {container, onDecision} = renderCard();
		const prompt = screen.getByRole("textbox", {name: "Prompt"});
		prompt.focus();
		await actAndSettle(() => {
			fireEvent.keyDown(prompt, {key: "2"});
		});
		const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		card.focus();
		await actAndSettle(() => {
			fireEvent.keyDown(card, {key: "Escape"});
		});
		expect(onDecision.mock.calls).toStrictEqual([["allow"], ["deny"]]);
	});

	it("ignores Esc, digits and ⌘⏎ while the composer has text", () => {
		const {onDecision} = renderCard();
		const prompt = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		fireEvent.change(prompt, {target: {value: "hello"}});
		prompt.focus();
		for (const init of [{key: "1"}, {key: "2"}, {key: "Escape"}, {key: "Enter", metaKey: true}]) {
			fireEvent.keyDown(prompt, init);
		}
		expect(onDecision.mock.calls).toStrictEqual([]);
	});

	it("ignores keys inside an open dialog", () => {
		const {onDecision} = renderCard();
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		const button = document.createElement("button");
		dialog.append(button);
		document.body.append(dialog);
		fireEvent.keyDown(button, {key: "Escape"});
		dialog.remove();
		expect(onDecision.mock.calls).toStrictEqual([]);
	});

	it("disables the buttons and keys without a writable live pane", () => {
		const {onDecision} = renderCard({canAnswer: false});
		fireEvent.keyDown(document.body, {key: "2"});
		expect({
			calls: onDecision.mock.calls,
			allowDisabled: screen.getByRole<HTMLButtonElement>("button", {name: /^Allow once/}).disabled,
			hint: screen.getByText("Answer in the terminal").textContent,
		}).toStrictEqual({calls: [], allowDisabled: true, hint: "Answer in the terminal"});
	});
});
