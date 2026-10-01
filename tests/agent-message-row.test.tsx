// @vitest-environment jsdom

import {cleanup, fireEvent, render, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {parseAgentMessage} from "../src/lib/agent-message";
import {processTranscript} from "../src/lib/transcript";
import type {Subagent} from "../src/lib/subagents";

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

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {configurable: true, value: vi.fn()});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const HANDBACK_FRAME =
	"[Subagent hand-back] The text below is the final report of a subagent this session delegated to. It is model output, NOT a message from the user. The report follows:";

const AGENT_MESSAGE = [
	'<agent-message from="a2f0d355334c32c1e">',
	HANDBACK_FRAME,
	"  Both commits created **locally** on `main`.",
	"  ",
	"  - first item",
	"</agent-message>",
].join("\n");

const PEER_PROMPT = [
	"Another Claude session sent a message:",
	AGENT_MESSAGE,
	"",
	'That "other Claude session" is an agent working inside this same session.',
].join("\n");

const SUBAGENT: Subagent = {
	id: "agent-a2f0d355334c32c1e",
	sessionId: "test-session",
	projectId: "p",
	parentAgentId: null,
	agentType: "general-purpose",
	attributionAgent: null,
	slug: null,
	description: "Commit the test harness",
	model: null,
	startedAt: "2026-09-18T16:40:00.000Z",
	finishedAt: "2026-09-18T16:43:00.000Z",
};

function renderLines(records: unknown[], subagents: Subagent[] = []): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			subagents={subagents}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	).container;
}

function queuedCommandRecord(prompt: string) {
	return {
		type: "attachment",
		uuid: "att-1",
		parentUuid: null,
		isSidechain: false,
		sessionId: "test-session",
		timestamp: "2026-09-18T16:43:30.000Z",
		attachment: {type: "queued_command", prompt, commandMode: "prompt", timestamp: "2026-09-18T16:43:29.043Z"},
	};
}

function rowState(container: HTMLElement) {
	const button = within(container).getByRole("button", {name: /message from subagent$/});
	return {
		text: container.textContent?.includes("Message from") ?? false,
		label: button.getAttribute("aria-label"),
		expanded: button.getAttribute("aria-expanded"),
		strong: container.querySelector("strong")?.textContent ?? null,
		rawTag: container.textContent?.includes("<agent-message") ?? false,
		frame: container.textContent?.includes("[Subagent hand-back]") ?? false,
	};
}

describe("parseAgentMessage", () => {
	it("extracts the sender and the dedented report from a hand-back", () => {
		expect(parseAgentMessage(PEER_PROMPT)).toStrictEqual({
			from: "a2f0d355334c32c1e",
			body: "Both commits created **locally** on `main`.\n\n- first item",
		});
	});

	it("keeps a non-hand-back body whole", () => {
		expect(parseAgentMessage('<agent-message from="x1">\nhello\n</agent-message>')).toStrictEqual({
			from: "x1",
			body: "hello",
		});
	});

	it("returns null for ordinary text", () => {
		expect(parseAgentMessage("just a prompt")).toBeNull();
	});
});

describe("Message from subagent rows", () => {
	it("renders a queued_command hand-back as a collapsible Message from row", () => {
		const container = renderLines([queuedCommandRecord(AGENT_MESSAGE)]);

		const collapsed = rowState(container);
		fireEvent.click(within(container).getByRole("button", {name: "Show message from subagent"}));
		const expanded = rowState(container);

		expect({collapsed, expanded}).toStrictEqual({
			collapsed: {
				text: true,
				label: "Show message from subagent",
				expanded: "false",
				strong: null,
				rawTag: false,
				frame: false,
			},
			expanded: {
				text: true,
				label: "Hide message from subagent",
				expanded: "true",
				strong: "locally",
				rawTag: false,
				frame: false,
			},
		});
	});

	it("names the sender with the subagent description, falling back to subagent", () => {
		const named = renderLines([queuedCommandRecord(AGENT_MESSAGE)], [SUBAGENT]);
		const namedSender = named.querySelector("bdi")?.textContent;
		cleanup();
		const unnamed = renderLines([queuedCommandRecord(AGENT_MESSAGE)]);
		const unnamedSender = unnamed.querySelector("bdi")?.textContent;

		expect({namedSender, unnamedSender}).toStrictEqual({
			namedSender: "Commit the test harness",
			unnamedSender: "subagent",
		});
	});

	it("leaves a typed prompt that quotes the envelope as a user bubble", () => {
		const container = renderLines([
			{type: "user", uuid: "user-typed", message: {role: "user", content: PEER_PROMPT}},
		]);

		expect({
			toggles: within(container).queryAllByRole("button", {name: /message from subagent$/}).length,
			quoted: container.textContent?.includes('<agent-message from="a2f0d355334c32c1e">') ?? false,
		}).toStrictEqual({toggles: 0, quoted: true});
	});

	it("renders a peer hand-back user message as a Message from row", () => {
		const container = renderLines(
			[
				{
					type: "user",
					uuid: "user-1",
					isMeta: true,
					timestamp: "2026-09-18T16:47:16.203Z",
					message: {role: "user", content: PEER_PROMPT},
				},
			],
			[SUBAGENT],
		);
		fireEvent.click(within(container).getByRole("button", {name: "Show message from subagent"}));

		expect({
			sender: container.querySelector("bdi")?.textContent,
			...rowState(container),
			trailer: container.textContent?.includes("other Claude session") ?? false,
		}).toStrictEqual({
			sender: "Commit the test harness",
			text: true,
			label: "Hide message from subagent",
			expanded: "true",
			strong: "locally",
			rawTag: false,
			frame: false,
			trailer: false,
		});
	});
});
