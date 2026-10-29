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

function records(attachment: Record<string, unknown>): unknown[] {
	return [
		{type: "user", uuid: "u-1", message: {role: "user", content: "keep going"}},
		{type: "attachment", uuid: "t-1", parentUuid: "u-1", attachment},
		{
			type: "assistant",
			uuid: "a-1",
			parentUuid: "t-1",
			message: {role: "assistant", content: [{type: "text", text: "Done."}]},
		},
	];
}

function noticesFor(attachment: Record<string, unknown>): (string | null)[] {
	const {lines, toolResultMap} = processTranscript(records(attachment));
	const {container} = render(
		<SessionChat sessionId="test-session" lines={lines} toolResultMap={toolResultMap} shouldScrollToEnd={false} />,
	);
	return [...container.querySelectorAll("[data-context-refresh]")].map((el) => el.textContent);
}

describe("context refresh announcements", () => {
	it.each([
		[
			{type: "instructions", files: [], changed: true, reason: "compaction"},
			["Instructions re-read after the conversation was compacted"],
		],
		[
			{type: "session_context", context: {}, changed: true, reason: "account_change"},
			["Session context refreshed after the account changed"],
		],
		[{type: "instructions", changed: true, reason: "some_future_reason"}, ["Instructions re-read"]],
		[{type: "instructions", files: [{path: "/repo/CLAUDE.md", content: "rules"}]}, []],
	])("draws %j as %j", (attachment, expected) => {
		expect(noticesFor(attachment)).toStrictEqual(expected);
	});
});
