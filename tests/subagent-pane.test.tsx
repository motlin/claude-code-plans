// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {useRegisterSubagentPane} from "../src/components/panes/subagent-pane";
import {TileHost} from "../src/components/panes/tile-host";
import {SettingsProvider} from "../src/components/settings-provider";
import {sessionQueryKeys, type TranscriptData} from "../src/lib/api/sessions";
import {
	defaultPaneLayout,
	loadSubagentPaneAgent,
	openPane,
	savePaneLayout,
	saveSubagentPaneAgent,
} from "../src/lib/pane-layout";
import {extractAgentPrompts, type Subagent} from "../src/lib/subagents";
import {installLocalStorage} from "./fake-storage";

vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
	hmrTake: () => undefined,
	hmrDispose: () => {},
}));

const SESSION_ID = "parent-session";

const PROMPT = "Audit every pane registration and report which kinds have no renderer.";

const SUBAGENTS: Subagent[] = [
	{
		id: "agent-a1",
		sessionId: SESSION_ID,
		projectId: "project",
		parentAgentId: null,
		agentType: "Explore",
		attributionAgent: null,
		slug: null,
		description: "Audit pane registrations",
		model: "claude-fable-5-1",
		startedAt: "2026-09-30T10:00:00.000Z",
		finishedAt: null,
	},
	{
		id: "agent-b2",
		sessionId: SESSION_ID,
		projectId: "project",
		parentAgentId: null,
		agentType: "Plan",
		attributionAgent: null,
		slug: null,
		description: "Plan the follow-up",
		model: null,
		startedAt: "2026-09-30T10:01:00.000Z",
		finishedAt: "2026-09-30T10:02:00.000Z",
	},
];

const PARENT_RECORDS = [
	{
		type: "assistant",
		timestamp: "2026-09-30T10:00:00.000Z",
		sessionId: SESSION_ID,
		message: {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "toolu_1",
					name: "Agent",
					input: {description: "Audit pane registrations", prompt: PROMPT, subagent_type: "Explore"},
				},
			],
		},
	},
	{
		type: "user",
		timestamp: "2026-09-30T10:00:30.000Z",
		sessionId: SESSION_ID,
		message: {
			role: "user",
			content: [{type: "tool_result", tool_use_id: "toolu_1", content: "Done.\nagentId: a1 (use SendMessage)"}],
		},
	},
];

const EMPTY_TRANSCRIPT: TranscriptData = {records: [], byteOffset: 0, startIndex: 0, precedingMessageCount: 0};

class FakeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

function Harness() {
	useRegisterSubagentPane({sessionId: SESSION_ID, subagents: SUBAGENTS, records: PARENT_RECORDS});
	return null;
}

function renderPane(): void {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	for (const agent of SUBAGENTS) queryClient.setQueryData(sessionQueryKeys.transcript(agent.id), EMPTY_TRANSCRIPT);
	render(
		<QueryClientProvider client={queryClient}>
			<SettingsProvider>
				<TileHost sessionId={SESSION_ID} onExpandWithoutPane={() => {}}>
					<Harness />
				</TileHost>
			</SettingsProvider>
		</QueryClientProvider>,
	);
}

function pane(): HTMLElement {
	return screen.getByRole("region", {name: "Subagents"});
}

function header(): HTMLElement {
	const element = pane().querySelector<HTMLElement>("[data-subagent-header]");
	if (element === null) throw new Error("missing Subagent pane header");
	return element;
}

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({x: 0, y: 0, width: 1200, height: 800}),
	);
	// jsdom lays nothing out; report a prompt taller than its 16rem clamp.
	vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(600);
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(256);
	savePaneLayout(SESSION_ID, openPane(defaultPaneLayout(), "subagents"));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("extractAgentPrompts", () => {
	it("maps each finished Agent call's agent id to the prompt it was given", () => {
		expect([...extractAgentPrompts(PARENT_RECORDS)]).toEqual([["agent-a1", PROMPT]]);
	});
});

describe("Subagent pane", () => {
	it("shows the focused agent with upstream's header, model footnote, clamped prompt and empty activity", () => {
		saveSubagentPaneAgent(SESSION_ID, "agent-a1");
		renderPane();
		const region = within(pane());
		const headerRow = within(header());

		expect({
			controls: headerRow.getAllByRole("button").map((button) => button.getAttribute("aria-label")),
			title: headerRow.getByRole("heading").textContent,
			footnote: region.getByText(/^Model /).textContent,
			prompt: region.getByText(PROMPT).closest("[data-subagent-prompt]")?.getAttribute("data-clamped"),
			showMore: region.getByRole("button", {name: "Show more"}).getAttribute("aria-expanded"),
			activity: region.getByText("No activity yet").tagName,
		}).toEqual({
			controls: ["Back", "Move", "Expand", "Close"],
			title: "Audit pane registrations",
			footnote: "Model Fable 5.1",
			prompt: "true",
			showMore: "false",
			activity: "P",
		});
	});

	it("expands the prompt with Show more", () => {
		saveSubagentPaneAgent(SESSION_ID, "agent-a1");
		renderPane();
		fireEvent.click(within(pane()).getByRole("button", {name: "Show more"}));

		expect({
			clamped: within(pane()).getByText(PROMPT).closest("[data-subagent-prompt]")?.getAttribute("data-clamped"),
			showMore: within(pane()).queryByRole("button", {name: "Show more"}),
		}).toEqual({clamped: "false", showMore: null});
	});

	it("Back returns to the subagents list, and picking a row focuses that agent", () => {
		saveSubagentPaneAgent(SESSION_ID, "agent-a1");
		renderPane();
		fireEvent.click(within(pane()).getByRole("button", {name: "Back"}));
		const list = within(pane())
			.getAllByRole("button", {name: /^Open subagent /})
			.map((row) => row.textContent);
		const afterBack = loadSubagentPaneAgent(SESSION_ID);
		fireEvent.click(within(pane()).getByRole("button", {name: "Open subagent Plan the follow-up"}));

		expect({
			list,
			afterBack,
			afterPick: loadSubagentPaneAgent(SESSION_ID),
			title: within(header()).getByRole("heading").textContent,
			footnote: within(pane()).queryByText(/^Model /),
		}).toEqual({
			list: ["Audit pane registrations", "Plan the follow-up"],
			afterBack: null,
			afterPick: "agent-b2",
			title: "Plan the follow-up",
			footnote: null,
		});
	});
});
