// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
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
				notifications,
				records: BASH_RECORDS,
			}),
		).toBeNull();
	});

	it("is hidden while an AskUserQuestion is the pending tool call", () => {
		expect(
			findPendingPermission({
				sessionId: "session-test-100",
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
	const onDecision = vi.fn(async (_decision: "allow" | "deny") => {});
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
	it("renders the title, command block, and Deny / Allow once with keycaps", () => {
		const {container} = renderCard();
		const card = container.querySelector("[data-approval-card-root]")!;
		const deny = screen.getByRole("button", {name: /^Deny/});
		const allow = screen.getByRole("button", {name: /^Allow once/});
		expect({
			label: card.getAttribute("aria-label"),
			title: card.querySelector("[data-permission-title]")?.textContent,
			command: card.querySelector("pre")?.textContent,
			denyKeys: [...deny.querySelectorAll("kbd")].map((kbd) => kbd.textContent),
			allowKeys: [...allow.querySelectorAll("kbd")].map((kbd) => kbd.textContent),
		}).toStrictEqual({
			label: "Permission request: run",
			title: "Allow Claude to run Remove the build output?",
			command: "rm -rf dist",
			denyKeys: ["1", "Esc"],
			allowKeys: ["2", "Ctrl", "⏎Enter"],
		});
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
		await act(async () => {
			fireEvent.keyDown(prompt, {key: "2"});
		});
		const card = container.querySelector<HTMLElement>("[data-approval-card-root]")!;
		card.focus();
		await act(async () => {
			fireEvent.keyDown(card, {key: "Escape"});
		});
		expect(onDecision.mock.calls).toStrictEqual([["allow"], ["deny"]]);
	});

	it("ignores Esc, digits and ⌘⏎ while the composer has text", () => {
		const {onDecision} = renderCard();
		const prompt = screen.getByRole("textbox", {name: "Prompt"}) as HTMLTextAreaElement;
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
			allowDisabled: (screen.getByRole("button", {name: /^Allow once/}) as HTMLButtonElement).disabled,
			hint: screen.getByText("Answer in the terminal").textContent,
		}).toStrictEqual({calls: [], allowDisabled: true, hint: "Answer in the terminal"});
	});
});
