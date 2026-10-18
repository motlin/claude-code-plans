// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {BackgroundTasksOpenerProvider} from "../src/components/background-tasks-opener-context";
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
	vi.stubGlobal("innerHeight", 10_000);
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

describe("an in-flight call's row", () => {
	it("leads with upstream's 20px running spinner and follows the label with the live elapsed time", () => {
		const records = [
			{type: "user", uuid: "user-1", message: {role: "user", content: "Check the login"}},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - 22_000).toISOString(),
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_running",
							name: "Bash",
							input: {command: "ssh -T git@github.com", description: "Recheck SSH auth"},
						},
					],
				},
			},
		];
		const container = renderRecords(records);
		const rows = [...container.querySelectorAll(".group\\/tool")].filter((row) =>
			row.textContent.includes("Rechecking SSH auth"),
		);
		const row = rows[0];

		expect({
			rows: rows.length,
			spinner: row?.querySelector("[data-running-spinner]")?.getAttribute("class"),
			elapsed: /^\d+s$/.test(row?.querySelector("[data-running-elapsed]")?.textContent ?? ""),
			chevron: row?.querySelector("svg[width='12']") !== null,
		}).toStrictEqual({
			rows: 1,
			spinner: "running-spinner me-1.5 inline-flex size-5 shrink-0",
			elapsed: true,
			chevron: true,
		});
	});

	it("offers 'View live output' on a background command whose task still runs, opening the Background tasks pane", () => {
		const opened = vi.fn<() => void>();
		const {lines, toolResultMap} = processTranscript([
			{type: "user", uuid: "user-1", message: {role: "user", content: "Benchmark it"}},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - 5_000).toISOString(),
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_background",
							name: "Bash",
							input: {
								command: "./gradlew jmh",
								description: "After JMH finishes, git test the three new candidates",
								run_in_background: true,
							},
						},
					],
				},
			},
			{
				type: "user",
				uuid: "user-2",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_background",
							content: "Command running in background with ID: bjmh100",
						},
					],
				},
			},
		]);
		const {getByRole} = render(
			<BackgroundTasksOpenerProvider value={{open: opened, running: new Set(["toolu_background"])}}>
				<SessionChat
					sessionId="test-session"
					lines={lines}
					toolResultMap={toolResultMap}
					showCompactSummaries={true}
					showTranscriptOnly={true}
					shouldScrollToEnd={false}
					transcriptMode="normal"
				/>
			</BackgroundTasksOpenerProvider>,
		);
		const button = getByRole("button", {name: "View live output"});
		fireEvent.click(button);

		expect({className: button.className, opened: opened.mock.calls.length}).toStrictEqual({
			className:
				"shrink-0 cursor-pointer rounded-r3 text-[13px]/[19px] text-primary underline-offset-[3px] hover:underline",
			opened: 1,
		});
	});

	function renderBackgroundAgent(description: string, running: ReadonlySet<string>): Element | undefined {
		const {lines, toolResultMap} = processTranscript([
			{type: "user", uuid: "user-1", message: {role: "user", content: "Do the tasks"}},
			{
				type: "assistant",
				uuid: "assistant-1",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_agent",
							name: "Agent",
							input: {description, prompt: "p", run_in_background: true},
						},
					],
				},
			},
			{
				type: "user",
				uuid: "user-2",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_agent",
							content: "Async agent launched successfully.\nagentId: a1b2c3",
						},
					],
				},
			},
		]);
		const {container} = render(
			<BackgroundTasksOpenerProvider value={{open: vi.fn<() => void>(), running}}>
				<SessionChat
					sessionId="test-session"
					lines={lines}
					toolResultMap={toolResultMap}
					showCompactSummaries={true}
					showTranscriptOnly={true}
					shouldScrollToEnd={false}
					transcriptMode="normal"
				/>
			</BackgroundTasksOpenerProvider>,
		);
		return container.querySelector(".group\\/tool") ?? undefined;
	}

	function agentRowFacts(row: Element | undefined) {
		return {
			text: row?.textContent,
			state: row?.getAttribute("data-state") ?? null,
			shimmer: row?.querySelector(".tool-shimmer")?.textContent ?? null,
			srOnly: row?.querySelector(".sr-only")?.textContent ?? null,
		};
	}

	it("labels a still-running background Agent in the present tense with shimmer, as upstream does", () => {
		expect({
			inflected: agentRowFacts(renderBackgroundAgent("Do task M1-42", new Set(["toolu_agent"]))),
			bare: agentRowFacts(renderBackgroundAgent("Mobile audit: session page", new Set(["toolu_agent"]))),
		}).toStrictEqual({
			inflected: {
				text: "Doing task M1-42running",
				state: "busy",
				shimmer: "Doing task M1-42",
				srOnly: "running",
			},
			bare: {
				text: "Mobile audit: session pagerunning",
				state: "busy",
				shimmer: "Mobile audit: session page",
				srOnly: "running",
			},
		});
	});

	it("settles a background Agent whose task has finished on its 'Ran agent' row", () => {
		expect(agentRowFacts(renderBackgroundAgent("Do task M1-42", new Set()))).toStrictEqual({
			text: "Ran agentDo task M1-42",
			state: null,
			shimmer: null,
			srOnly: null,
		});
	});

	it("draws no message actions under a turn still waiting on its question, as upstream leaves the gap to the next row", () => {
		const ask = {
			type: "assistant",
			uuid: "assistant-q",
			timestamp: "2026-10-13T22:40:00.000Z",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_question",
						name: "AskUserQuestion",
						input: {
							questions: [{question: "Which PRs?", header: "PRs", options: [{label: "A"}, {label: "B"}]}],
						},
					},
				],
			},
		};
		const pending = renderRecords([
			{type: "user", uuid: "user-1", message: {role: "user", content: "Open PRs"}},
			ask,
		]);
		const pendingFooters = pending.querySelectorAll("[data-assistant-span-footer]").length;
		cleanup();
		const answered = renderRecords([
			{type: "user", uuid: "user-1", message: {role: "user", content: "Open PRs"}},
			ask,
			{
				type: "user",
				uuid: "user-2",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_question",
							content:
								'User has answered your questions: "Which PRs?"="A". You can now continue with the user\'s answers in mind.',
						},
					],
				},
			},
		]);

		expect({
			pending: pendingFooters,
			answered: answered.querySelectorAll("[data-assistant-span-footer]").length,
		}).toStrictEqual({
			pending: 0,
			answered: 1,
		});
	});
});
