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
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const user = (text: string, uuid: string) => ({
	type: "user",
	uuid,
	timestamp: "2026-11-05T10:00:00.000Z",
	message: {role: "user", content: text},
});
const assistant = (text: string, uuid: string, extra: Record<string, unknown> = {}) => ({
	type: "assistant",
	uuid,
	timestamp: "2026-11-05T10:01:00.000Z",
	message: {role: "assistant", content: [{type: "text", text}]},
	...extra,
});
const notice = (uuid: string) => ({
	type: "system",
	subtype: "informational",
	level: "notice",
	isMeta: true,
	uuid,
	timestamp: "2026-11-05T11:30:00.000Z",
	content: "Compacted while idle, before the prompt cache expired",
});

function renderRecords(records: unknown[]) {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="notice-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showSystemBanners={false}
			shouldScrollToEnd={false}
		/>,
	).container;
}

/** Each hover bar's `<time>` datetime, the footer's anchor to its turn. */
const barTimes = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("[data-message-actions] time"), (time) => time.getAttribute("datetime"));

describe("SessionChat hook notices", () => {
	it("draws the notice row even with system banners off, omitted from find-in-page", () => {
		const container = renderRecords([user("hi", "u1"), assistant("hello", "a1"), notice("n1")]);
		const rows = Array.from(container.querySelectorAll("[data-hook-notice]"), (row) => ({
			label: row.querySelector("button")?.textContent,
			findOmitted: row.closest("[data-find-omitted]") !== null,
		}));
		expect(rows).toStrictEqual([{label: "Claude Code notice", findOmitted: true}]);
	});

	it("leaves the assistant turn's footer where it was", () => {
		const without = barTimes(renderRecords([user("hi", "u1"), assistant("hello", "a1")]));
		cleanup();
		const withNotice = barTimes(renderRecords([user("hi", "u1"), assistant("hello", "a1"), notice("n1")]));
		expect(withNotice).toStrictEqual(without);
	});

	it("keeps an API error before it drawn as the full card", () => {
		const container = renderRecords([
			user("hi", "u1"),
			assistant("API Error: 529 Overloaded", "a1", {isApiErrorMessage: true, apiErrorStatus: 529}),
			notice("n1"),
		]);
		expect({
			apiCard: container.querySelectorAll("[data-api-error-card]").length,
			apiMarker: container.querySelectorAll("[data-api-error-marker]").length,
			notices: container.querySelectorAll("[data-hook-notice]").length,
		}).toStrictEqual({apiCard: 1, apiMarker: 0, notices: 1});
	});
});

const bashRun = (id: string) => [
	{
		type: "assistant",
		uuid: `a-${id}`,
		timestamp: "2026-11-05T10:01:00.000Z",
		message: {role: "assistant", content: [{type: "tool_use", id, name: "Bash", input: {command: "ls"}}]},
	},
	{
		type: "user",
		uuid: `r-${id}`,
		parentUuid: `a-${id}`,
		timestamp: "2026-11-05T10:01:01.000Z",
		message: {role: "user", content: [{type: "tool_result", tool_use_id: id, content: "file"}]},
	},
];
const sys = (subtype: string, uuid: string, extra: Record<string, unknown> = {}) => ({
	type: "system",
	subtype,
	isMeta: false,
	uuid,
	timestamp: "2026-11-05T10:01:02.000Z",
	...extra,
});

/** Opens every tool group so its steps mount, then reads where the notices landed. */
function noticePlacement(container: HTMLElement) {
	for (const toggle of container.querySelectorAll("[data-tool-row] button[aria-expanded='false']")) {
		fireEvent.click(toggle);
	}
	return {
		standalone: container.querySelectorAll("[data-hook-notice]").length,
		steps: Array.from(
			container.querySelectorAll("[data-tool-row] [data-hook-notice-step]"),
			(step) => step.querySelector("button")?.textContent,
		),
	};
}

describe("SessionChat hook notices after a tool run", () => {
	it("folds a notice-level notice into the run as a Claude Code notice step", () => {
		const container = renderRecords([user("hi", "u1"), ...bashRun("t1"), notice("n1")]);
		expect(noticePlacement(container)).toStrictEqual({standalone: 0, steps: ["Claude Code notice"]});
	});

	it("words the folded step's body with the notice copy", () => {
		const container = renderRecords([user("hi", "u1"), ...bashRun("t1"), sys("agents_killed", "k1")]);
		noticePlacement(container);
		const step = container.querySelector("[data-hook-notice-step]");
		fireEvent.click(step!.querySelector("button")!);
		const body = step!.querySelector("[data-hook-notice-step-body]");
		expect({className: body?.className, text: body?.textContent}).toStrictEqual({
			className: "flex flex-col gap-1 ps-p6 comfortable:ps-p8",
			text: "All background agents stopped",
		});
	});

	it("leaves a warning standalone", () => {
		const container = renderRecords([user("hi", "u1"), ...bashRun("t1"), {...notice("n1"), level: "warning"}]);
		expect(noticePlacement(container)).toStrictEqual({standalone: 1, steps: []});
	});

	it("leaves a recap standalone", () => {
		const container = renderRecords([
			user("hi", "u1"),
			...bashRun("t1"),
			sys("away_summary", "s1", {content: "x"}),
		]);
		expect(noticePlacement(container)).toStrictEqual({standalone: 1, steps: []});
	});

	it("folds agents_killed into the run", () => {
		const container = renderRecords([user("hi", "u1"), ...bashRun("t1"), sys("agents_killed", "k1")]);
		expect(noticePlacement(container)).toStrictEqual({standalone: 0, steps: ["Claude Code notice"]});
	});

	it("leaves a merged informational + recap line standalone", () => {
		const container = renderRecords([
			user("hi", "u1"),
			...bashRun("t1"),
			notice("n1"),
			sys("away_summary", "s1", {content: "x"}),
		]);
		expect(noticePlacement(container)).toStrictEqual({standalone: 1, steps: []});
	});

	it("draws each notice of a merged folded line as its own step", () => {
		const container = renderRecords([user("hi", "u1"), ...bashRun("t1"), notice("n1"), sys("agents_killed", "k1")]);
		expect(noticePlacement(container)).toStrictEqual({
			standalone: 0,
			steps: ["Claude Code notice", "Claude Code notice"],
		});
	});

	it("keeps a notice with no tool run before it standalone", () => {
		const container = renderRecords([user("hi", "u1"), assistant("hello", "a1"), notice("n1")]);
		expect(noticePlacement(container)).toStrictEqual({standalone: 1, steps: []});
	});
});
