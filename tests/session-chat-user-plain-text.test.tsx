// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
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

function renderRecords(records: unknown[]): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={true}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	).container;
}

function prompt(content: string): unknown {
	return {type: "user", uuid: "user-plain-1", message: {role: "user", content}};
}

function bubble(container: HTMLElement): Element {
	const found = container.querySelector(".user-message-bubble");
	if (found === null) throw new Error("no user bubble");
	return found;
}

describe("SessionChat user bubbles as plain text", () => {
	it("keeps markdown syntax literal and styles only inline code", () => {
		const el = bubble(renderRecords([prompt("**bold** and `code` see https://x.y/z")]));

		expect({
			text: el.textContent,
			strong: el.querySelectorAll("strong").length,
			code: Array.from(el.querySelectorAll("code")).map((code) => ({
				text: code.textContent,
				className: code.className,
			})),
			paragraphClass: el.querySelector("p")?.className ?? null,
		}).toStrictEqual({
			text: "**bold** and code see https://x.y/z",
			strong: 0,
			code: [
				{
					text: "code",
					className:
						"font-mono text-[12px]/[12px] text-code-ink bg-alpha-1 border-[0.5px] border-border rounded-[4.8px] px-[3px] py-[0.75px]",
				},
			],
			paragraphClass: "text-body leading-[1.2857] whitespace-pre-wrap [overflow-wrap:anywhere]",
		});
	});

	it("renders a heading line as literal text", () => {
		const el = bubble(renderRecords([prompt("# Heading\nbody")]));

		expect({headings: el.querySelectorAll("h1, h2, h3").length, text: el.textContent}).toStrictEqual({
			headings: 0,
			text: "# Heading\nbody",
		});
	});

	it("does not turn markdown links into session links", () => {
		const el = bubble(renderRecords([prompt("[t](URL)")]));

		expect({
			sessionLinks: el.querySelectorAll('a[href="/session/URL"]').length,
			text: el.textContent,
		}).toStrictEqual({sessionLinks: 0, text: "[t](URL)"});
	});

	it("keeps the slash chip and leaves the rest of the prompt literal", () => {
		const el = bubble(renderRecords([prompt("/loop **every** `5m`")]));

		expect({
			chips: el.querySelectorAll("[data-slash-command-chip]").length,
			strong: el.querySelectorAll("strong").length,
			code: Array.from(el.querySelectorAll("code")).map((code) => code.textContent),
			text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
		}).toStrictEqual({chips: 1, strong: 0, code: ["5m"], text: "/loop **every** 5m"});
	});
});
