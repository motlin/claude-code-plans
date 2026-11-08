// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {appendClientRow, clearClientRows, type ClientRow} from "../src/lib/client-rows-store";
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
	// Tall enough that the virtualized list mounts every row.
	vi.stubGlobal("innerHeight", 10_000);
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn<HTMLElement["scrollIntoView"]>(),
	});
});

afterEach(() => {
	cleanup();
	clearClientRows();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const SESSION = "s-1";

const user = (uuid: string, content: string) => ({
	type: "user",
	uuid,
	timestamp: "2026-11-08T10:00:00.000Z",
	sessionId: SESSION,
	message: {role: "user", content},
});

const assistant = (uuid: string, text: string) => ({
	type: "assistant",
	uuid,
	timestamp: "2026-11-08T10:00:01.000Z",
	sessionId: SESSION,
	message: {role: "assistant", content: [{type: "text", text}]},
});

const THREE_LINES = [user("u-1", "First prompt"), assistant("a-1", "First reply"), user("u-2", "Second prompt")];

/** Stand-ins for the T3/T4 cards: the status card reads `model` live, the usage card reads `stats`. */
function cardRenderer(model: string, stats = "no stats") {
	return function renderCard(row: ClientRow) {
		return row.kind === "status" ? (
			<div data-testid="epitaxy-status-card">{`Session info ${model}`}</div>
		) : (
			<div role="group" aria-label="Usage">{`Usage ${stats}`}</div>
		);
	};
}

function chat(records: unknown[], model = "Opus 4.7", stats?: string) {
	const {lines, toolResultMap} = processTranscript(records);
	return (
		<SessionChat
			sessionId={SESSION}
			lines={lines}
			toolResultMap={toolResultMap}
			shouldScrollToEnd={false}
			transcriptMode="normal"
			renderClientRowCard={cardRenderer(model, stats)}
		/>
	);
}

/** Each transcript row as the text a reader sees: user bubbles, cards, replies. */
function rowTexts(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid="transcript-row"]')].map((row) => {
		const status = row.querySelector('[data-testid="epitaxy-status-card"]');
		if (status !== null) return `card: ${status.textContent}`;
		const usage = row.querySelector('[role="group"][aria-label="Usage"]');
		if (usage !== null) return `card: ${usage.textContent}`;
		const bubble = row.querySelector(".user-message-bubble");
		if (bubble !== null) return `user: ${bubble.textContent}`;
		return `reply: ${row.querySelector("p")?.textContent ?? ""}`;
	});
}

function append(kind: ClientRow["kind"], text: string, afterUuid: string | null) {
	act(() => {
		appendClientRow(SESSION, {kind, text, afterUuid});
	});
}

describe("SessionChat client rows (/status and /usage)", () => {
	it("draws the /status user row and its card after the line it was sent at", () => {
		const {container} = render(chat(THREE_LINES));
		append("status", "/status", "u-2");

		expect(rowTexts(container)).toEqual([
			"user: First prompt",
			"reply: First reply",
			"user: Second prompt",
			"user: /status",
			"card: Session info Opus 4.7",
		]);
	});

	it("keeps the card above a line that arrives later", () => {
		const {container, rerender} = render(chat(THREE_LINES));
		append("status", "/status", "u-2");
		rerender(chat([...THREE_LINES, assistant("a-2", "Second reply")]));

		expect(rowTexts(container)).toEqual([
			"user: First prompt",
			"reply: First reply",
			"user: Second prompt",
			"user: /status",
			"card: Session info Opus 4.7",
			"reply: Second reply",
		]);
	});

	it("draws one card per send", () => {
		const {container} = render(chat(THREE_LINES));
		append("status", "/status", "u-2");
		append("status", "/status", "u-2");

		expect(rowTexts(container)).toEqual([
			"user: First prompt",
			"reply: First reply",
			"user: Second prompt",
			"user: /status",
			"card: Session info Opus 4.7",
			"user: /status",
			"card: Session info Opus 4.7",
		]);
	});

	it("keeps the cards across a remount, as navigating away and back does", () => {
		const first = render(chat(THREE_LINES));
		append("status", "/status", "u-2");
		first.unmount();

		const {container} = render(chat(THREE_LINES));

		expect(rowTexts(container)).toEqual([
			"user: First prompt",
			"reply: First reply",
			"user: Second prompt",
			"user: /status",
			"card: Session info Opus 4.7",
		]);
	});

	it("draws none once the store is cleared, as a reload does", () => {
		const {container} = render(chat(THREE_LINES));
		append("status", "/status", "u-2");
		append("usage", "/usage", "u-2");
		act(() => {
			clearClientRows();
		});

		expect(rowTexts(container)).toEqual(["user: First prompt", "reply: First reply", "user: Second prompt"]);
	});

	it("re-renders the status card live when the model changes", () => {
		const {container, rerender} = render(chat(THREE_LINES));
		append("status", "/status", "u-2");
		rerender(chat(THREE_LINES, "Sonnet 4.5"));

		expect(rowTexts(container).at(-1)).toEqual("card: Session info Sonnet 4.5");
	});

	it("draws a usage row with the text it was sent as and the Usage card", () => {
		const {container} = render(chat(THREE_LINES));
		append("usage", "/cost", "u-2");

		expect(rowTexts(container).slice(3)).toEqual(["user: /cost", "card: Usage no stats"]);
	});

	it("re-renders the usage card live when its stats change", () => {
		const {container, rerender} = render(chat(THREE_LINES, "Opus 4.7", "3 calls"));
		append("usage", "/usage", "u-2");
		rerender(chat(THREE_LINES, "Opus 4.7", "5 calls"));

		expect(rowTexts(container).at(-1)).toEqual("card: Usage 5 calls");
	});

	it("keeps a mixed status and usage sequence in send order, each at its own line", () => {
		const {container} = render(chat(THREE_LINES));
		append("status", "/status", "a-1");
		append("usage", "/usage", "u-2");
		append("status", "/status", "u-2");

		expect(rowTexts(container)).toEqual([
			"user: First prompt",
			"reply: First reply",
			"user: /status",
			"card: Session info Opus 4.7",
			"user: Second prompt",
			"user: /usage",
			"card: Usage no stats",
			"user: /status",
			"card: Session info Opus 4.7",
		]);
	});

	it("draws a row whose anchor line is gone, or that had none, at the end", () => {
		const {container} = render(chat(THREE_LINES));
		append("status", "/status", "missing-uuid");
		append("usage", "/usage", null);

		expect(rowTexts(container).slice(3)).toEqual([
			"user: /status",
			"card: Session info Opus 4.7",
			"user: /usage",
			"card: Usage no stats",
		]);
	});

	it("draws another session's rows nowhere but in that session", () => {
		const {container} = render(chat(THREE_LINES));
		act(() => {
			appendClientRow("other-session", {kind: "status", text: "/status", afterUuid: "u-2"});
		});

		expect(rowTexts(container)).toEqual(["user: First prompt", "reply: First reply", "user: Second prompt"]);
	});
});
