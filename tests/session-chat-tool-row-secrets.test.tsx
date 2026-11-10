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
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("innerHeight", 4000);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const prompt = {
	type: "user",
	uuid: "u-prompt",
	message: {role: "user", content: "Fabricated request"},
};

interface Call {
	id: string;
	name: string;
	input: Record<string, unknown>;
	result?: string;
	isError?: boolean;
	/** No result yet: the call is still running. */
	pending?: true;
}

/** One assistant message making every call, then each call's result. */
function turn(calls: Call[]): unknown[] {
	return [
		prompt,
		{
			type: "assistant",
			uuid: "a1",
			message: {
				id: "msg-1",
				role: "assistant",
				content: calls.map(({id, name, input}) => ({type: "tool_use", id, name, input})),
			},
		},
		...calls
			.filter((call) => call.pending !== true)
			.map(({id, result, isError}) => ({
				type: "user",
				uuid: `r-${id}`,
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: id,
							content: result ?? "ok",
							...(isError === true ? {is_error: true} : {}),
						},
					],
				},
			})),
	];
}

function draw(calls: Call[]): HTMLElement {
	const {lines, toolResultMap} = processTranscript(turn(calls));
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			transcriptMode="normal"
			showTools
			showThinking={false}
			shouldScrollToEnd={false}
		/>,
	).container;
}

function headers(container: HTMLElement): (string | null)[] {
	return [...container.querySelectorAll('[data-tool-row] > [role="button"], [data-tool-row] > button')].map(
		(row) => row.textContent,
	);
}

/** Obviously fake: a GitHub-token-shaped run of A's. */
const FAKE_GH = `ghp_${"A".repeat(36)}`;
/** A right-to-left override and a zero-width space, which upstream's Iv strips from tool labels. */
const CONTROLS = "\u202E\u200B";

describe("tool row labels mask secrets (upstream Iv)", () => {
	it("masks a Bash command preview and strips its display controls", () => {
		const container = draw([
			{
				id: "b1",
				name: "Bash",
				input: {command: `git push https://${FAKE_GH}@example.invalid/r${CONTROLS}.git`},
			},
		]);
		expect(headers(container)).toStrictEqual([
			"git push https://ghp_AAAA••••••••••••••••••••••••••••••••@example.invalid/r.git",
		]);
	});

	it("masks a tool's meta param", () => {
		const container = draw([{id: "g1", name: "Grep", input: {pattern: `token=${FAKE_GH}${CONTROLS}`}}]);
		expect(headers(container)).toStrictEqual(["Searchedtoken=ghp_AAAA••••••••••••••••••••••••••••••••"]);
	});

	it("masks a pending call's running label", () => {
		const container = draw([
			{
				id: "b1",
				name: "Bash",
				input: {command: "true", description: `Use ${FAKE_GH}${CONTROLS}`},
				pending: true,
			},
		]);
		expect(headers(container)).toStrictEqual(["Using ghp_AAAA••••••••••••••••••••••••••••••••running"]);
	});

	it("masks the group header's running label", () => {
		const container = draw([
			{id: "r1", name: "Read", input: {file_path: "/repo/a.ts"}, result: "1\tx"},
			{
				id: "b1",
				name: "Bash",
				input: {command: "true", description: `Use ${FAKE_GH}${CONTROLS}`},
				pending: true,
			},
		]);
		const summary = container.querySelector("[data-cds-row-toggle]")?.textContent ?? null;
		expect(summary).toBe("Using ghp_AAAA••••••••••••••••••••••••••••••••running");
	});
});
