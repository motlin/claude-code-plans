// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
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
