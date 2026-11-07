// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
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

const USER_MESSAGE_COLUMN =
	"group/message-row flex w-full min-w-0 flex-col gap-g5 comfortable:gap-g6 font-sans ms-auto items-end";

function shape(container: HTMLElement) {
	const column = container.querySelector('[data-cds="UserMessage"]');
	const bubble = column?.querySelector(".user-message-bubble");
	const classes = (bubble?.getAttribute("class") ?? "").split(" ");
	return {
		column: column?.getAttribute("class") ?? null,
		bubbleHasWFull: classes.includes("w-full"),
		bubbleHasMaxW85: classes.includes("max-w-[85%]"),
	};
}

describe("user row CDS structure (upstream UserMessage width model)", () => {
	it("puts the 85% cap on a plain prompt's bubble and makes the column full-width like upstream", () => {
		expect(shape(renderRecords([{type: "user", uuid: "u-ok", message: {role: "user", content: "ok"}}]))).toEqual({
			column: USER_MESSAGE_COLUMN,
			bubbleHasWFull: false,
			bubbleHasMaxW85: true,
		});
	});

	it("puts the 85% cap on a slash-command prompt's bubble too", () => {
		expect(
			shape(
				renderRecords([
					{
						type: "user",
						uuid: "u-cmd",
						message: {
							role: "user",
							content:
								"<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>now</command-args>",
						},
					},
				]),
			),
		).toEqual({column: USER_MESSAGE_COLUMN, bubbleHasWFull: false, bubbleHasMaxW85: true});
	});
});
