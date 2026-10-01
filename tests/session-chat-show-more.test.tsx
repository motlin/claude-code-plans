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

let scrollHeight = 0;

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {configurable: true, value: vi.fn()});
	Object.defineProperty(HTMLElement.prototype, "scrollHeight", {configurable: true, get: () => scrollHeight});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
	Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
});

function renderPrompt(content: string): HTMLElement {
	const {lines, toolResultMap} = processTranscript([
		{type: "user", uuid: "user-long-1", message: {role: "user", content}},
	]);
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

function toggles(container: HTMLElement): {text: string | null; expanded: string | null}[] {
	return within(container)
		.queryAllByRole("button", {name: /^Show (more|less)$/})
		.map((button) => ({text: button.textContent, expanded: button.getAttribute("aria-expanded")}));
}

describe("SessionChat long-bubble Show more toggle", () => {
	it("renders one ghost toggle that flips aria-expanded and its label", () => {
		scrollHeight = 400;
		const container = renderPrompt("a long prompt");
		const collapsed = toggles(container);
		const button = within(container).getByRole("button", {name: "Show more"});
		fireEvent.click(button);
		const expanded = toggles(container);
		fireEvent.click(button);

		expect({
			collapsed,
			expanded,
			recollapsed: toggles(container),
			className: button.className,
		}).toEqual({
			collapsed: [{text: "Show more", expanded: "false"}],
			expanded: [{text: "Show less", expanded: "true"}],
			recollapsed: [{text: "Show more", expanded: "false"}],
			className:
				"h-5 cursor-pointer rounded-r4 px-1.5 text-caption font-normal text-primary transition-colors hover:bg-alpha-1",
		});
	});

	it("renders no toggle when the content fits within 256px", () => {
		scrollHeight = 256;

		expect(toggles(renderPrompt("short"))).toEqual([]);
	});
});
