// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionChat} from "../src/components/session-chat";
import {registerComposer} from "../src/lib/context-attach";
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
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const user = (text: string, uuid: string) => ({type: "user", uuid, message: {role: "user", content: text}});
const assistant = (text: string, uuid: string, extra: Record<string, unknown> = {}) => ({
	type: "assistant",
	uuid,
	message: {role: "assistant", content: [{type: "text", text}]},
	...extra,
});
const blocked = (uuid: string) => ({
	type: "system",
	subtype: "informational",
	level: "warning",
	preventContinuation: true,
	uuid,
	content: "UserPromptSubmit operation blocked by hook:\nworker unreachable\n\n\nOriginal prompt: what's next?",
});

function renderRecords(records: unknown[], sessionId = "blocked-session") {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat sessionId={sessionId} lines={lines} toolResultMap={toolResultMap} showSystemBanners={false} />,
	);
}

const found = (container: HTMLElement) => ({
	card: container.querySelectorAll("[data-hook-blocked-card]").length,
	marker: container.querySelectorAll("[data-hook-blocked-marker]").length,
	apiCard: container.querySelectorAll("[data-api-error-card]").length,
	apiMarker: container.querySelectorAll("[data-api-error-marker]").length,
});

describe("SessionChat hook-blocked prompt", () => {
	it("draws the card when the block is the last entry, even with system banners off", () => {
		const {container} = renderRecords([user("hi", "u1"), assistant("hello", "a1"), blocked("b1")]);
		expect(found(container)).toStrictEqual({card: 1, marker: 0, apiCard: 0, apiMarker: 0});
	});

	it("draws the marker once a later entry follows", () => {
		const {container} = renderRecords([blocked("b1"), user("next", "u1"), assistant("ok", "a1")]);
		expect(found(container)).toStrictEqual({card: 0, marker: 1, apiCard: 0, apiMarker: 0});
	});

	it("collapses an earlier API error to its marker when the block ends the transcript", () => {
		const {container} = renderRecords([
			user("hi", "u1"),
			assistant("API Error: 529 Overloaded", "a1", {isApiErrorMessage: true, apiErrorStatus: 529}),
			blocked("b1"),
		]);
		expect(found(container)).toStrictEqual({card: 1, marker: 0, apiCard: 0, apiMarker: 1});
	});

	it("offers Edit prompt only while a composer is mounted, and prefills it", () => {
		const prefill = vi.fn<(text: string) => boolean>(() => true);
		renderRecords([user("hi", "u1"), assistant("hello", "a1"), blocked("b-edit")], "edit-session");
		expect(screen.queryByRole("button", {name: "Edit prompt"})).toBeNull();
		let unregister = () => {};
		act(() => {
			unregister = registerComposer("edit-session", {insertText: () => {}, focus: () => {}, prefill});
		});
		fireEvent.click(screen.getByRole("button", {name: "Edit prompt"}));
		expect({
			calls: prefill.mock.calls,
			button: screen.queryByRole("button", {name: "Edit prompt"}),
		}).toStrictEqual({calls: [["what's next?"]], button: null});
		act(unregister);
	});
});
