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

const WATCH_ENDED = [
	"<task-notification>",
	"<task-type>artifact-watch-lifecycle</task-type>",
	'<summary>Stopped watching Artifact: "Brace Review" (artifact not found)</summary>',
	"<event>Watch on https://claude.ai/artifact/abc ended — no such artifact for this account.</event>",
	"</task-notification>",
].join("\n");

function records(): unknown[] {
	return [
		{type: "user", uuid: "u-1", message: {role: "user", content: "publish the review"}},
		{
			type: "assistant",
			uuid: "a-1",
			parentUuid: "u-1",
			message: {role: "assistant", content: [{type: "text", text: "Published."}]},
		},
		{
			type: "user",
			uuid: "n-1",
			parentUuid: "a-1",
			promptSource: "system",
			turnOrigin: "task_notification",
			queueOrigin: {
				kind: "task-notification",
				source: "artifact-watch-lifecycle",
				slug: "slug-1",
				displayName: '"Brace Review"',
				watchEnded: true,
			},
			message: {role: "user", content: WATCH_ENDED},
		},
		{
			type: "assistant",
			uuid: "a-2",
			parentUuid: "n-1",
			message: {role: "assistant", content: [{type: "text", text: "Noted."}]},
		},
	];
}

function renderChat() {
	const {lines, toolResultMap} = processTranscript(records());
	return render(
		<SessionChat sessionId="test-session" lines={lines} toolResultMap={toolResultMap} shouldScrollToEnd={false} />,
	);
}

describe("artifact watch lifecycle notifications", () => {
	it("draws a muted 'Stopped watching' line instead of the raw task-notification", () => {
		const {container} = renderChat();
		const notices = [...container.querySelectorAll("[data-artifact-watch-ended]")].map((el) => el.textContent);
		expect({notices, raw: container.textContent.includes("<task-notification>")}).toStrictEqual({
			notices: ['Stopped watching "Brace Review"'],
			raw: false,
		});
	});
});
