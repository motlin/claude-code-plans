// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {TranscriptActionsContext} from "../src/components/transcript-context-menu";
import {writeClipboardText} from "../src/lib/clipboard";
import {processTranscript} from "../src/lib/transcript";

// Its own file: the tasks view is lazy, and once any earlier test in the module graph has loaded it,
// the Loading tasks… fallback this test asserts on never renders.

vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize()}));
vi.mock("../src/hooks/use-claude-events", () => ({useClaudeEvents: () => ({failedTools: new Map()})}));
vi.mock("../src/lib/clipboard", () => ({writeClipboardText: vi.fn(async () => true)}));

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
const forkFrom = vi.fn();
const pinChapter = vi.fn();

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("innerHeight", 4000);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	document.documentElement.scrollTop = 0;
});

function text(uuid: string, value: string) {
	return {
		type: "assistant",
		uuid,
		sessionId: "example-main",
		timestamp: "2000-01-01T00:00:00.000Z",
		message: {role: "assistant", content: [{type: "text", text: value}]},
	};
}
function chat(records: unknown[]) {
	const {lines, toolResultMap} = processTranscript(records);
	return (
		<TranscriptActionsContext.Provider value={{forkFrom, pinChapter}}>
			<SessionChat
				sessionId="example-main"
				lines={lines}
				toolResultMap={toolResultMap}
				showTranscriptOnly
				shouldScrollToEnd={false}
			/>
		</TranscriptActionsContext.Provider>
	);
}
function footers(container: HTMLElement) {
	return Array.from(container.querySelectorAll<HTMLElement>("[data-assistant-span-footer]"));
}
function button(footer: HTMLElement, label: string) {
	return footer.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}
function focus(element: HTMLElement) {
	act(() => {
		element.focus();
	});
}
function anchor(footer: HTMLElement) {
	return footer.closest<HTMLElement>("[data-perf-line]")?.dataset["perfLine"];
}

describe("assistant display-span actions over a loading task summary", () => {
	it("keeps span actions and focus available while the grouped task summary loads", async () => {
		const view = render(
			chat([
				text("example-introduction", "Example task plan."),
				...["Alice", "Bob", "Charlie"].map((name) => ({
					type: "assistant",
					uuid: `example-${name}`,
					sessionId: "example-main",
					message: {
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: `example-task-${name}`,
								name: "TaskCreate",
								input: {subject: `Example ${name} task`},
							},
						],
					},
				})),
			]),
		);
		const loading = screen.getByText("Loading tasks…").getAttribute("role");
		const footer = footers(view.container)[0]!;
		const fork = button(footer, "Fork from here");
		focus(fork);
		await screen.findByRole("heading", {name: "Example Charlie task"});
		fireEvent.click(fork);
		fireEvent.click(button(footer, "Copy"));
		await act(async () => {});
		expect({
			loading,
			remainingLoading: screen.queryByText("Loading tasks…"),
			tasks: screen.getAllByRole("heading", {level: 3}).map((heading) => heading.textContent),
			sameFooter: footers(view.container)[0] === footer,
			focused: document.activeElement === fork,
			anchors: footers(view.container).map(anchor),
			fork: forkFrom.mock.calls,
			copy: vi.mocked(writeClipboardText).mock.calls,
		}).toStrictEqual({
			loading: "status",
			remainingLoading: null,
			tasks: ["Example Alice task", "Example Bob task", "Example Charlie task"],
			sameFooter: true,
			focused: true,
			anchors: ["1"],
			fork: [[{sessionId: "example-main", uuid: "example-Charlie"}]],
			copy: [["Example task plan."]],
		});
	});
});
