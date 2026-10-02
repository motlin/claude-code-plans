// @vitest-environment jsdom

import {cleanup, fireEvent, render, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
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
		value: vi.fn(),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function renderRecords(records: unknown[], showCompactSummaries = true): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={showCompactSummaries}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
		/>,
	).container;
}

function userRecord(n: number) {
	return {type: "user", uuid: `user-${n}`, message: {role: "user", content: `Fabricated prompt ${n}`}};
}

function assistantRecord(n: number) {
	return {
		type: "assistant",
		uuid: `assistant-${n}`,
		message: {role: "assistant", content: [{type: "text", text: `Fabricated reply ${n}`}]},
	};
}

function articles(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>("[role='article']"));
}

function articleAttributes(container: HTMLElement) {
	return articles(container).map((article) => ({
		label: article.getAttribute("aria-label"),
		posinset: article.getAttribute("aria-posinset"),
		setsize: article.getAttribute("aria-setsize"),
		tabIndex: article.tabIndex,
	}));
}

describe("SessionChat turn articles", () => {
	it("names the transcript feed and wraps its turns in numbered articles with only the last in the Tab order", () => {
		const container = renderRecords([userRecord(1), assistantRecord(1), userRecord(2)]);
		const feed = within(container).getByRole("feed", {name: "Chat messages"});
		expect(articleAttributes(feed)).toStrictEqual([
			{label: "Message 1", posinset: "1", setsize: "3", tabIndex: -1},
			{label: "Message 2", posinset: "2", setsize: "3", tabIndex: -1},
			{label: "Message 3", posinset: "3", setsize: "3", tabIndex: 0},
		]);
	});

	it("explains the arrow-key navigation once for screen readers", () => {
		const container = renderRecords([userRecord(1), assistantRecord(1)]);
		const hints = Array.from(container.querySelectorAll(".sr-only"))
			.map((element) => element.textContent)
			.filter((text) => text?.includes("arrow keys"));
		expect(hints).toStrictEqual(["Use the up and down arrow keys to move between messages"]);
	});

	it("moves focus to the previous and next article with ArrowUp and ArrowDown", () => {
		const container = renderRecords([userRecord(1), assistantRecord(1), userRecord(2)]);
		const [first, second, third] = articles(container);
		third!.focus();
		fireEvent.keyDown(third!, {key: "ArrowUp"});
		const afterUp = document.activeElement;
		fireEvent.keyDown(second!, {key: "ArrowUp"});
		const afterSecondUp = document.activeElement;
		fireEvent.keyDown(first!, {key: "ArrowUp"});
		const atTop = document.activeElement;
		fireEvent.keyDown(first!, {key: "ArrowDown"});
		expect([afterUp, afterSecondUp, atTop, document.activeElement]).toStrictEqual([second, first, first, second]);
	});

	it("ignores arrow keys pressed inside a turn's own controls", () => {
		const container = renderRecords([userRecord(1), assistantRecord(1)]);
		const last = articles(container).at(-1)!;
		const inner = document.createElement("button");
		last.append(inner);
		inner.focus();
		fireEvent.keyDown(inner, {key: "ArrowUp"});
		expect(document.activeElement).toBe(inner);
	});

	it("mounts and focuses a neighbour the virtualizer has not rendered yet", () => {
		const records = Array.from({length: 30}, (_, n) => (n % 2 === 0 ? userRecord(n) : assistantRecord(n)));
		const container = renderRecords(records);
		const lastMounted = articles(container).at(-1)!;
		const lastMountedPosition = Number(lastMounted.getAttribute("aria-posinset"));
		lastMounted.focus();
		fireEvent.keyDown(lastMounted, {key: "ArrowDown"});
		expect({
			lastMountedIsLast: lastMountedPosition === records.length,
			focused: document.activeElement?.getAttribute("aria-label"),
		}).toStrictEqual({lastMountedIsLast: false, focused: `Message ${lastMountedPosition + 1}`});
	});
});
