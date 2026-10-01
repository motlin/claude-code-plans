// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({settings: {showDebug: false}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

class NoopResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords(): ResizeObserverEntry[] {
		return [];
	}
}

globalThis.ResizeObserver = NoopResizeObserver;

afterEach(cleanup);

const USER_PROMPT = {type: "user", uuid: "u0", message: {role: "user", content: "Search please"}};

/** `count` tool calls in one assistant turn, each with its own result. */
function toolCallRecords(count: number): unknown[] {
	const ids = Array.from({length: count}, (_, index) => `t${index + 1}`);
	return [
		{
			type: "assistant",
			uuid: "a1",
			parentUuid: "u0",
			message: {
				role: "assistant",
				content: ids.map((id) => ({type: "tool_use", id, name: "Grep", input: {pattern: `pattern-${id}`}})),
			},
		},
		...ids.map((id) => ({
			type: "user",
			uuid: `r-${id}`,
			parentUuid: "a1",
			message: {role: "user", content: [{type: "tool_result", tool_use_id: id, content: "1 match"}]},
		})),
	];
}

function chat(sessionId: string, records: unknown[]) {
	const {lines, toolResultMap} = processTranscript(records);
	return (
		<SessionChat
			sessionId={sessionId}
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries
			showTranscriptOnly
			showThinking
			shouldScrollToEnd={false}
		/>
	);
}

/** Expand the control, unmount its row by dropping the tool turn, then bring it back. */
function expandUnmountRemount(count: number, selector: string): {before: string | null; after: string | null} {
	const tools = [USER_PROMPT, ...toolCallRecords(count)];
	const {container, rerender} = render(chat("s1", tools));
	fireEvent.click(container.querySelector(selector) as Element);
	const before = container.querySelector(selector)?.getAttribute("aria-expanded") ?? null;
	rerender(chat("s1", [USER_PROMPT]));
	const unmounted = container.querySelector(selector);
	if (unmounted !== null) throw new Error("Expected the tool row to unmount.");
	rerender(chat("s1", tools));
	return {before, after: container.querySelector(selector)?.getAttribute("aria-expanded") ?? null};
}

describe("SessionChat tool row expansion across remounts", () => {
	it("keeps a single tool row expanded after its row unmounts and remounts", () => {
		expect(expandUnmountRemount(1, '[role="button"][aria-expanded]')).toStrictEqual({
			before: "true",
			after: "true",
		});
	});

	it("keeps a grouped tool summary expanded after its row unmounts and remounts", () => {
		expect(expandUnmountRemount(2, "button[aria-expanded]")).toStrictEqual({before: "true", after: "true"});
	});

	it("does not carry expansion into a different session", () => {
		const tools = [USER_PROMPT, ...toolCallRecords(1)];
		const {container, rerender} = render(chat("s1", tools));
		fireEvent.click(container.querySelector('[role="button"][aria-expanded]') as Element);
		rerender(chat("s2", tools));
		expect(container.querySelector('[role="button"][aria-expanded]')?.getAttribute("aria-expanded")).toBe("false");
	});
});
