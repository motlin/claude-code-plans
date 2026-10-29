// @vitest-environment jsdom

import {cleanup, fireEvent, render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {AskUserQuestionProvider} from "../src/components/ask-user-question-context";
import {SessionChat} from "../src/components/session-chat";
import {orphansOpenQuestions, type QuestionAnswerRoute} from "../src/lib/question-answer-route";
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

/** An AskUserQuestion call the CLI never wrote a result for. */
const OPEN_QUESTION_RECORDS = [
	{
		type: "assistant",
		uuid: "a-open",
		message: {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "toolu_open",
					name: "AskUserQuestion",
					input: {
						questions: [
							{
								question: "Which animal do you prefer?",
								header: "Animal",
								multiSelect: false,
								options: [
									{label: "Cat", description: "Independent."},
									{label: "Dog", description: "Loyal."},
								],
							},
						],
					},
				},
			],
		},
	},
];

function renderOpenQuestion(answerRoute: QuestionAnswerRoute, sessionLive: boolean | null) {
	const {lines, toolResultMap} = processTranscript(OPEN_QUESTION_RECORDS);
	return render(
		<AskUserQuestionProvider value={{answerRoute, sessionLive, submitAnswer: async () => {}}}>
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				shouldScrollToEnd={false}
				transcriptMode="normal"
			/>
		</AskUserQuestionProvider>,
	);
}

describe("orphansOpenQuestions", () => {
	it("orphans an open question only on the read-only route of a session known not to run", () => {
		expect([
			orphansOpenQuestions("read-only", false),
			orphansOpenQuestions("read-only", null),
			orphansOpenQuestions("read-only", true),
			orphansOpenQuestions("read-only", undefined),
			orphansOpenQuestions("fork", false),
			orphansOpenQuestions("live-pane", false),
		]).toStrictEqual([true, false, false, false, false, false]);
	});
});

describe("an orphaned open question", () => {
	it('draws "Asked Animal · Not answered" with Not answered under the question, and no card', async () => {
		const {container} = renderOpenQuestion("read-only", false);
		const header = container.querySelector(".group\\/tool");
		const row = header === null ? null : Array.from(header.children, (child) => child.textContent).filter(Boolean);
		const card = container.querySelector("[data-approval-card-root]") !== null;
		const toggle = container.querySelector<HTMLElement>('[aria-expanded="false"]');
		if (toggle === null) throw new Error("Expected the question row to be collapsed.");
		fireEvent.click(toggle);
		const body = await waitFor(() => {
			const mounted = container.querySelector(".group\\/body .flex.flex-col.gap-3.pt-1");
			if (mounted === null) throw new Error("Expected the step body to mount.");
			return mounted;
		});
		expect({
			row,
			card,
			body: Array.from(body.children, (item) =>
				Array.from(item.children, (line) => ({className: line.className, text: line.textContent})),
			),
		}).toStrictEqual({
			row: ["Asked Animal", "Not answered"],
			card: false,
			body: [
				[
					{className: "text-secondary", text: "Which animal do you prefer?"},
					{className: "text-ink-muted", text: "Not answered"},
				],
			],
		});
	});

	it("keeps the card while the fork route can still answer it", () => {
		const {container} = renderOpenQuestion("fork", false);
		expect({
			card: container.querySelector("[data-approval-card-root]") !== null,
			row: container.querySelector(".group\\/tool") !== null,
		}).toStrictEqual({card: true, row: false});
	});

	it("keeps the card while the session's liveness is unknown", () => {
		const {container} = renderOpenQuestion("read-only", null);
		expect(container.querySelector("[data-approval-card-root]") !== null).toBe(true);
	});
});
