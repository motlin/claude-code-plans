// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {
	type BackgroundTasksOpener,
	BackgroundTasksOpenerProvider,
} from "../src/components/background-tasks-opener-context";
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
	it("leads with upstream's activity WorkingMark and follows the label with the live elapsed time", () => {
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
			spinner: row?.querySelector(".running-spinner") ?? null,
			mark: row?.querySelector('[data-cds="WorkingMark"]')?.getAttribute("data-activity"),
			markClass: row?.querySelector('[data-cds="WorkingMark"]')?.getAttribute("class"),
			elapsed: /^\d+s$/.test(row?.querySelector("[data-running-elapsed]")?.textContent ?? ""),
			chevron: row?.querySelector("svg[width='12']") !== null,
		}).toStrictEqual({
			rows: 1,
			spinner: null,
			mark: "code",
			markClass: "relative block shrink-0 select-none me-1.5",
			elapsed: true,
			chevron: true,
		});
	});

	it("plays the read sprite for an in-flight Read row", () => {
		const container = renderRecords([
			{type: "user", uuid: "user-1", message: {role: "user", content: "Look at the app"}},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - 5000).toISOString(),
				message: {
					role: "assistant",
					content: [
						{type: "tool_use", id: "toolu_read", name: "Read", input: {file_path: "/repo/src/app.ts"}},
					],
				},
			},
		]);
		expect(
			[...container.querySelectorAll('[data-cds="WorkingMark"]')].map((mark) =>
				mark.getAttribute("data-activity"),
			),
		).toStrictEqual(["read"]);
	});

	it("shows the row's elapsed time only from 2s, as upstream does", () => {
		const runningRecords = (startedMsAgo: number) => [
			{type: "user", uuid: "user-1", message: {role: "user", content: "Check the login"}},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - startedMsAgo).toISOString(),
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
		const elapsedTexts = (startedMsAgo: number) => {
			const container = renderRecords(runningRecords(startedMsAgo));
			const texts = [...container.querySelectorAll("[data-running-elapsed]")].map((el) => el.textContent);
			cleanup();
			return texts;
		};
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
		try {
			expect({early: elapsedTexts(1_000), atTwo: elapsedTexts(2_000)}).toStrictEqual({
				early: [],
				atTwo: ["2s"],
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("leads an in-flight group header with the call's mark, then the shimmer label, elapsed time and an sr 'running'", () => {
		const container = renderRecords([
			{type: "user", uuid: "user-1", message: {role: "user", content: "Check the login"}},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - 30_000).toISOString(),
				message: {
					role: "assistant",
					content: [{type: "tool_use", id: "toolu_read", name: "Read", input: {file_path: "/repo/a.ts"}}],
				},
			},
			{
				type: "user",
				uuid: "result-1",
				parentUuid: "assistant-1",
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_read", content: "ok"}]},
			},
			{
				type: "assistant",
				uuid: "assistant-2",
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
		]);
		const header = container.querySelector("button[aria-controls].group\\/tool");
		expect({
			children: [...(header?.firstElementChild?.children ?? [])].map(
				(child) => child.getAttribute("data-cds") ?? child.getAttribute("class"),
			),
			mark: header?.querySelector('[data-cds="WorkingMark"]')?.getAttribute("data-activity"),
			label: header?.querySelector('[data-cds="ShimmerText"]')?.firstChild?.textContent,
			elapsed: /^2\ds$/.test(header?.querySelector("[data-running-elapsed]")?.textContent ?? ""),
			srOnly: header?.querySelector(".sr-only")?.textContent,
		}).toStrictEqual({
			children: ["WorkingMark", "ShimmerText", "shrink-0 text-body text-ink-muted tabular-nums", "sr-only"],
			mark: "code",
			label: "Rechecking SSH auth",
			elapsed: true,
			srOnly: "running",
		});
	});

	it("offers 'View live output' on a background command whose task still runs, opening the Background tasks pane at its task", () => {
		const opened = vi.fn<BackgroundTasksOpener["open"]>();
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
			<BackgroundTasksOpenerProvider value={{open: opened, running: new Map([["toolu_background", "bjmh100"]])}}>
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

		expect({className: button.className, opened: opened.mock.calls}).toStrictEqual({
			className:
				"shrink-0 cursor-pointer rounded-r3 text-[13px]/[19px] text-primary underline-offset-[3px] hover:underline",
			opened: [[{taskId: "bjmh100"}]],
		});
	});

	function renderBackgroundAgent(description: string, running: ReadonlyMap<string, string>): Element | undefined {
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
			<BackgroundTasksOpenerProvider value={{open: vi.fn<BackgroundTasksOpener["open"]>(), running}}>
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
			shimmer: row?.querySelector("[data-cds=ShimmerText]")?.firstChild?.textContent ?? null,
			clone: row?.querySelector("[data-cds-shimmer-clone][aria-hidden=true][inert]")?.textContent ?? null,
			srOnly: row?.querySelector(".sr-only")?.textContent ?? null,
		};
	}

	it("labels a still-running background Agent in the present tense with shimmer, as upstream does", () => {
		expect({
			inflected: agentRowFacts(renderBackgroundAgent("Do task M1-42", new Map([["toolu_agent", "a1b2c3"]]))),
			bare: agentRowFacts(
				renderBackgroundAgent("Mobile audit: session page", new Map([["toolu_agent", "a1b2c3"]])),
			),
		}).toStrictEqual({
			inflected: {
				text: "Doing task M1-42Doing task M1-42running",
				state: "busy",
				shimmer: "Doing task M1-42",
				clone: "Doing task M1-42",
				srOnly: "running",
			},
			bare: {
				text: "Mobile audit: session pageMobile audit: session pagerunning",
				state: "busy",
				shimmer: "Mobile audit: session page",
				clone: "Mobile audit: session page",
				srOnly: "running",
			},
		});
	});

	it("settles a background Agent whose task has finished on its 'Ran agent' row", () => {
		expect(agentRowFacts(renderBackgroundAgent("Do task M1-42", new Map()))).toStrictEqual({
			text: "Ran agentDo task M1-42",
			state: null,
			shimmer: null,
			clone: null,
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

describe("a status row's accessible name", () => {
	// The text each aria-labelledby id names, skipping aria-hidden subtrees, joined as accname does.
	const labelledByText = (toggle: Element) =>
		(toggle.getAttribute("aria-labelledby") ?? "")
			.split(" ")
			.map((id) => {
				const copy = document.getElementById(id)?.cloneNode(true);
				if (!(copy instanceof Element)) return "";
				for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
				return copy.textContent;
			})
			.join(" ");
	const toggleNames = (container: HTMLElement) =>
		[...container.querySelectorAll("[aria-labelledby]")].map((toggle) => ({
			name: labelledByText(toggle),
			ids: (toggle.getAttribute("aria-labelledby") ?? "").split(" ").map((id) => id.replace(/^.*-/, "")),
		}));

	it("labels a failed row's toggle by its label then its outcome, and announces both, as upstream does", () => {
		const container = renderRecords([
			{type: "user", uuid: "user-1", message: {role: "user", content: "Fetch it"}},
			{
				type: "assistant",
				uuid: "assistant-1",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_fetch",
							name: "WebFetch",
							input: {url: "https://example.com", prompt: "x"},
						},
					],
				},
			},
			{
				type: "user",
				uuid: "user-2",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "toolu_fetch", content: "boom", is_error: true}],
				},
			},
		]);
		expect({
			toggles: toggleNames(container),
			announced: [...container.querySelectorAll('[role="status"][aria-live="polite"].sr-only')].map(
				(status) => status.textContent,
			),
		}).toStrictEqual({
			toggles: [{name: "Fetched https://example.com Failed", ids: ["label", "meta", "outcome"]}],
			announced: ["Fetched https://example.com Failed"],
		});
	});

	it("labels a busy Read row by its label then an sr 'running'", () => {
		const container = renderRecords([
			{type: "user", uuid: "user-1", message: {role: "user", content: "Look at the app"}},
			{
				type: "assistant",
				uuid: "assistant-1",
				timestamp: new Date(Date.now() - 5000).toISOString(),
				message: {
					role: "assistant",
					content: [
						{type: "tool_use", id: "toolu_read", name: "Read", input: {file_path: "/repo/src/app.ts"}},
					],
				},
			},
		]);
		expect(toggleNames(container)).toStrictEqual([
			{name: "Reading app.ts running", ids: ["label", "meta", "busy"]},
		]);
	});
});
