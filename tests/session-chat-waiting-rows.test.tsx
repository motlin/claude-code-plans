// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({
		settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn<HTMLElement["scrollIntoView"]>(),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const assistant = (uuid: string, timestamp: string, text: string) => ({
	type: "assistant",
	uuid,
	timestamp,
	sessionId: "s-1",
	message: {role: "assistant", content: [{type: "text", text}]},
});

const enqueue = (timestamp: string, content: string) => ({
	type: "queue-operation",
	operation: "enqueue",
	timestamp,
	sessionId: "s-1",
	content,
});

function renderRecords(records: unknown[], sessionLive: boolean, onSendNow?: () => void): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="s-1"
			lines={lines}
			toolResultMap={toolResultMap}
			shouldScrollToEnd={false}
			transcriptMode="normal"
			sessionLive={sessionLive}
			onSendNow={onSendNow}
		/>,
	).container;
}

const waitingRows = (container: HTMLElement) =>
	[...container.querySelectorAll("[data-take-back-entry]")].map((row) => ({
		entry: row.getAttribute("data-take-back-entry"),
		text: row.querySelector(".user-message-bubble")?.textContent,
	}));

describe("JSONL waiting rows at the transcript tail", () => {
	it("draws a waiting prompt after the assistant text written after its enqueue", () => {
		const container = renderRecords(
			[
				assistant("a-1", "1999-12-31T00:00:01Z", "first reply"),
				enqueue("1999-12-31T00:00:02Z", "hi"),
				assistant("a-2", "1999-12-31T00:00:03Z", "second reply"),
			],
			true,
		);
		expect(waitingRows(container)).toStrictEqual([{entry: "queued-1", text: "hi"}]);
		const second = [...container.querySelectorAll("p")].find((p) => p.textContent === "second reply");
		const row = container.querySelector("[data-take-back-entry]");
		expect(second === undefined || row === null ? null : second.compareDocumentPosition(row)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
	});

	it("draws no waiting row once the session is no longer live", () => {
		const container = renderRecords(
			[assistant("a-1", "1999-12-31T00:00:01Z", "first reply"), enqueue("1999-12-31T00:00:02Z", "hi")],
			false,
		);
		expect(waitingRows(container)).toStrictEqual([]);
	});

	it("stacks several waiting prompts in enqueue order", () => {
		const container = renderRecords(
			[
				assistant("a-1", "1999-12-31T00:00:01Z", "first reply"),
				enqueue("1999-12-31T00:00:02Z", "one"),
				enqueue("1999-12-31T00:00:03Z", "two"),
				assistant("a-2", "1999-12-31T00:00:04Z", "second reply"),
			],
			true,
		);
		expect(waitingRows(container)).toStrictEqual([
			{entry: "queued-1", text: "one"},
			{entry: "queued-2", text: "two"},
		]);
	});

	it("puts Send now on the head waiting row only, wired to the interrupt", () => {
		const onSendNow = vi.fn<() => void>();
		const container = renderRecords(
			[
				assistant("a-1", "1999-12-31T00:00:01Z", "first reply"),
				enqueue("1999-12-31T00:00:02Z", "one"),
				enqueue("1999-12-31T00:00:03Z", "two"),
			],
			true,
			onSendNow,
		);
		expect(
			[...container.querySelectorAll("[data-take-back-entry]")].map(
				(row) => row.querySelectorAll("[data-testid=awaiting-turn-send-now]").length,
			),
		).toStrictEqual([1, 0]);
		const sendNow = container.querySelector("[data-testid=awaiting-turn-send-now]");
		if (sendNow !== null) fireEvent.click(sendNow);
		expect(onSendNow.mock.calls).toStrictEqual([[]]);
	});
});

describe("pickup announcement", () => {
	const user = (uuid: string, timestamp: string, text: string) => ({
		type: "user",
		uuid,
		timestamp,
		sessionId: "s-1",
		message: {role: "user", content: text},
	});
	const dequeue = (timestamp: string) => ({
		type: "queue-operation",
		operation: "dequeue",
		timestamp,
		sessionId: "s-1",
	});

	function chat(records: unknown[]) {
		const {lines, toolResultMap} = processTranscript(records);
		return (
			<SessionChat
				sessionId="s-1"
				lines={lines}
				toolResultMap={toolResultMap}
				shouldScrollToEnd={false}
				transcriptMode="normal"
				sessionLive
			/>
		);
	}

	it("announces read once the live session takes a waiting prompt into the transcript", () => {
		const waiting = [assistant("a-1", "2026-01-01T00:00:00Z", "working"), enqueue("2026-01-01T00:00:01Z", "hi")];
		const {container, rerender} = render(chat(waiting));
		const statuses = () =>
			[...container.querySelectorAll("[data-take-back-entry] > [role=status], [data-waiting-pickup-status]")].map(
				(node) => node.textContent,
			);
		const before = statuses();

		rerender(chat([...waiting, dequeue("2026-01-01T00:00:02Z"), user("u-1", "2026-01-01T00:00:02Z", "hi")]));

		expect({before, after: statuses()}).toStrictEqual({before: ["unread", ""], after: ["read"]});
	});

	it("mounts no pickup live region once the session is no longer live", () => {
		const container = renderRecords([enqueue("2026-01-01T00:00:01Z", "hi")], false);
		expect(container.querySelectorAll("[data-waiting-pickup-status]").length).toBe(0);
	});
});

describe("head waiting row Send now focus", () => {
	it("hands a mouse click's focus to the session composer", async () => {
		const onFocusComposer = vi.fn<() => void>();
		const {lines, toolResultMap} = processTranscript([
			assistant("a-1", "1999-12-31T00:00:01Z", "first reply"),
			enqueue("1999-12-31T00:00:02Z", "one"),
		]);
		const {container} = render(
			<SessionChat
				sessionId="s-1"
				lines={lines}
				toolResultMap={toolResultMap}
				shouldScrollToEnd={false}
				transcriptMode="normal"
				sessionLive
				onSendNow={async () => {}}
				onFocusComposer={onFocusComposer}
			/>,
		);
		const sendNow = container.querySelector<HTMLButtonElement>("[data-testid=awaiting-turn-send-now]");
		sendNow?.focus();
		if (sendNow !== null) {
			fireEvent.pointerDown(sendNow, {pointerType: "mouse"});
			fireEvent.click(sendNow);
		}
		await act(async () => {});
		expect(onFocusComposer.mock.calls).toStrictEqual([[]]);
	});
});

describe("JSONL head row Send now stays busy until the CLI takes the prompt", () => {
	// CLI 2.1.312, checked in a scratch pane: Esc with prompts queued interrupts the turn and the
	// CLI dequeues and sends every queued prompt itself, so Send now is the interrupt alone.
	function chat(records: unknown[], onSendNow: () => Promise<void>) {
		const {lines, toolResultMap} = processTranscript(records);
		return (
			<SessionChat
				sessionId="s-1"
				lines={lines}
				toolResultMap={toolResultMap}
				shouldScrollToEnd={false}
				transcriptMode="normal"
				sessionLive
				onSendNow={onSendNow}
			/>
		);
	}
	const waiting = [assistant("a-1", "2026-01-01T00:00:00Z", "working"), enqueue("2026-01-01T00:00:01Z", "hi")];
	const sendNowState = (container: HTMLElement) =>
		[...container.querySelectorAll("[data-testid=awaiting-turn-send-now]")].map((button) =>
			button.getAttribute("aria-busy"),
		);

	afterEach(() => {
		vi.useRealTimers();
	});

	it("interrupts once and stays busy after the interrupt settles, ignoring a second click", async () => {
		const onSendNow = vi.fn<() => Promise<void>>(async () => {});
		const {container, rerender} = render(chat(waiting, onSendNow));
		const click = () => {
			const button = container.querySelector("[data-testid=awaiting-turn-send-now]");
			if (button !== null) fireEvent.click(button);
		};
		click();
		await act(async () => {});
		click();
		rerender(chat([...waiting, assistant("a-2", "2026-01-01T00:00:02Z", "still working")], onSendNow));
		await act(async () => {});
		expect({calls: onSendNow.mock.calls.length, busy: sendNowState(container)}).toStrictEqual({
			calls: 1,
			busy: ["true"],
		});
	});

	it("clears busy after the pickup timeout without interrupting again", async () => {
		vi.useFakeTimers();
		const onSendNow = vi.fn<() => Promise<void>>(async () => {});
		const {container} = render(chat(waiting, onSendNow));
		const button = container.querySelector("[data-testid=awaiting-turn-send-now]");
		if (button !== null) fireEvent.click(button);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2999);
		});
		const before = sendNowState(container);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect({calls: onSendNow.mock.calls.length, before, after: sendNowState(container)}).toStrictEqual({
			calls: 1,
			before: ["true"],
			after: [null],
		});
	});
});
