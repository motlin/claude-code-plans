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
