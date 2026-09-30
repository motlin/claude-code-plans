// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ApprovalDock} from "../src/components/approval-dock";
import {AskUserQuestionProvider} from "../src/components/ask-user-question-context";
import {AskUserQuestionRenderer} from "../src/components/tool-renderers/ask-user-question-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";
import {
	approvalDockReducer,
	approvalDockAnswers,
	findPendingAskUserQuestion,
	initialApprovalDockState,
	type ApprovalDockState,
} from "../src/lib/approval-dock";
import type {QuestionLike} from "../src/lib/ask-user-question";

afterEach(cleanup);

const QUESTIONS: QuestionLike[] = [
	{
		question: "Which test runner?",
		header: "Runner",
		options: [
			{label: "Vitest", description: "Vite-native"},
			{label: "Jest", description: "Widely adopted"},
		],
	},
	{
		question: "Which features?",
		header: "Features",
		multiSelect: true,
		options: [{label: "Coverage"}, {label: "Watch"}, {label: "UI"}],
	},
];

function assistantToolUse(id: string, name: string, input: Record<string, unknown>, extra = {}) {
	return {
		type: "assistant",
		message: {content: [{type: "tool_use", id, name, input}]},
		...extra,
	};
}

function toolResult(id: string) {
	return {
		type: "user",
		message: {content: [{type: "tool_result", tool_use_id: id, content: "ok"}]},
	};
}

describe("findPendingAskUserQuestion", () => {
	it("finds an unanswered AskUserQuestion that is the last assistant tool_use", () => {
		const records = [
			assistantToolUse("t1", "Bash", {command: "ls"}),
			toolResult("t1"),
			assistantToolUse("t2", "AskUserQuestion", {questions: QUESTIONS}),
		];
		expect(findPendingAskUserQuestion(records)).toStrictEqual({
			toolUseId: "t2",
			questions: QUESTIONS,
		});
	});

	it("returns null once the question has a tool_result", () => {
		const records = [assistantToolUse("t2", "AskUserQuestion", {questions: QUESTIONS}), toolResult("t2")];
		expect(findPendingAskUserQuestion(records)).toBeNull();
	});

	it("returns null when a later tool_use follows the question", () => {
		const records = [
			assistantToolUse("t2", "AskUserQuestion", {questions: QUESTIONS}),
			assistantToolUse("t3", "Bash", {command: "ls"}),
		];
		expect(findPendingAskUserQuestion(records)).toBeNull();
	});

	it("ignores sidechain records", () => {
		const records = [
			assistantToolUse("t2", "AskUserQuestion", {questions: QUESTIONS}),
			assistantToolUse("s1", "Bash", {command: "ls"}, {isSidechain: true}),
		];
		expect(findPendingAskUserQuestion(records)?.toolUseId).toStrictEqual("t2");
	});

	it("normalizes the single-question form", () => {
		const records = [
			assistantToolUse("t4", "AskUserQuestion", {
				question: "Pick?",
				options: [{label: "A"}, {label: "B"}],
			}),
		];
		expect(findPendingAskUserQuestion(records)).toStrictEqual({
			toolUseId: "t4",
			questions: [{question: "Pick?", options: [{label: "A"}, {label: "B"}]}],
		});
	});
});

describe("approvalDockReducer", () => {
	function run(...actions: Parameters<typeof approvalDockReducer>[1][]): ApprovalDockState {
		return actions.reduce(
			(state, action) => approvalDockReducer(state, action, QUESTIONS),
			initialApprovalDockState(QUESTIONS),
		);
	}

	it("starts at the first question with nothing chosen", () => {
		const state = run();
		expect({
			index: state.index,
			collapsed: state.collapsed,
			dismissed: state.dismissed,
			answers: approvalDockAnswers(QUESTIONS, state),
		}).toStrictEqual({
			index: 0,
			collapsed: false,
			dismissed: false,
			answers: [
				{question: "Which test runner?", answer: ""},
				{question: "Which features?", answer: ""},
			],
		});
	});

	it("selects a single option, replacing an earlier pick, and refuses Next until chosen", () => {
		expect(run({type: "next"}).index).toStrictEqual(0);
		const state = run({type: "select", option: 0}, {type: "select", option: 1});
		expect(approvalDockAnswers(QUESTIONS, state)[0]).toStrictEqual({
			question: "Which test runner?",
			answer: "Jest",
		});
		expect(approvalDockReducer(state, {type: "next"}, QUESTIONS).index).toStrictEqual(1);
	});

	it("toggles multi-select options on the second question", () => {
		const state = run(
			{type: "select", option: 0},
			{type: "next"},
			{type: "select", option: 0},
			{type: "select", option: 2},
			{type: "select", option: 0},
		);
		expect(approvalDockAnswers(QUESTIONS, state)).toStrictEqual([
			{question: "Which test runner?", answer: "Vitest"},
			{question: "Which features?", answer: "UI"},
		]);
	});

	it("uses the Other text in place of a selection", () => {
		const state = run(
			{type: "select", option: 0},
			{type: "selectOther"},
			{type: "setOtherText", text: "  Mocha  "},
		);
		expect(approvalDockAnswers(QUESTIONS, state)[0]!.answer).toStrictEqual("Mocha");
	});

	it("Skip clears the current answer and advances", () => {
		const state = run({type: "select", option: 1}, {type: "skip"});
		expect({
			index: state.index,
			answer: approvalDockAnswers(QUESTIONS, state)[0]!.answer,
		}).toStrictEqual({index: 1, answer: ""});
	});

	it("goes back to an earlier question with its draft kept", () => {
		const state = run({type: "select", option: 1}, {type: "next"}, {type: "goto", index: 0});
		expect({
			index: state.index,
			answer: approvalDockAnswers(QUESTIONS, state)[0]!.answer,
		}).toStrictEqual({index: 0, answer: "Jest"});
	});

	it("collapses, expands, and dismisses", () => {
		expect(run({type: "toggleCollapsed"}).collapsed).toStrictEqual(true);
		expect(run({type: "toggleCollapsed"}, {type: "toggleCollapsed"}).collapsed).toStrictEqual(false);
		expect(run({type: "dismiss"}).dismissed).toStrictEqual(true);
	});
});

function renderDock(onSubmit = vi.fn(async () => {})) {
	const utils = render(
		<div>
			<div data-focus-region="composer">
				<textarea aria-label="Prompt" />
			</div>
			<ApprovalDock toolUseId="t2" questions={QUESTIONS} onSubmit={onSubmit} />
		</div>,
	);
	return {...utils, onSubmit};
}

function optionButton(label: string) {
	return screen.getByRole("button", {name: new RegExp(`^${label}`)});
}

describe("ApprovalDock", () => {
	it("renders the i/n pill, the question, options with keycaps, and Other", () => {
		const {container} = renderDock();
		const card = container.querySelector("[data-approval-card-root]")!;
		expect({
			pill: card.querySelector("[data-approval-pill]")?.textContent,
			question: card.querySelector("[data-approval-question]")?.textContent,
			keycaps: [...card.querySelectorAll("kbd")].map((kbd) => kbd.textContent),
			other: screen.getByRole("textbox", {name: "Other option"}).getAttribute("placeholder"),
			next: (screen.getByRole("button", {name: "Next"}) as HTMLButtonElement).disabled,
		}).toStrictEqual({
			pill: "1/2",
			question: "Which test runner?",
			keycaps: ["1", "2", "3"],
			other: "Type your own answer here",
			next: true,
		});
	});

	it("digit keys select options when the composer is empty or unfocused", () => {
		renderDock();
		fireEvent.keyDown(document.body, {key: "2"});
		expect(optionButton("Jest").getAttribute("aria-pressed")).toStrictEqual("true");

		const prompt = screen.getByRole("textbox", {name: "Prompt"});
		prompt.focus();
		fireEvent.keyDown(prompt, {key: "1"});
		expect(optionButton("Vitest").getAttribute("aria-pressed")).toStrictEqual("true");
	});

	it("digit keys are ignored while the composer has text", () => {
		renderDock();
		const prompt = screen.getByRole("textbox", {name: "Prompt"}) as HTMLTextAreaElement;
		fireEvent.change(prompt, {target: {value: "hello"}});
		prompt.focus();
		fireEvent.keyDown(prompt, {key: "1"});
		expect(optionButton("Vitest").getAttribute("aria-pressed")).toStrictEqual("false");
	});

	it("the digit after the last option focuses the Other textarea", () => {
		renderDock();
		fireEvent.keyDown(document.body, {key: "3"});
		expect(document.activeElement).toStrictEqual(screen.getByRole("textbox", {name: "Other option"}));
	});

	it("walks Next to the last question and submits the answer payload", async () => {
		const {onSubmit} = renderDock();
		fireEvent.click(optionButton("Jest"));
		fireEvent.click(screen.getByRole("button", {name: "Next"}));
		expect(screen.getByText("2/2")).toBeTruthy();
		fireEvent.change(screen.getByRole("textbox", {name: "Other option"}), {
			target: {value: "Snapshots"},
		});
		await act(async () => {
			fireEvent.click(screen.getByRole("button", {name: "Submit"}));
		});
		expect(onSubmit.mock.calls).toStrictEqual([
			[
				{
					toolUseId: "t2",
					answers: [
						{question: "Which test runner?", answer: "Jest"},
						{question: "Which features?", answer: "Snapshots"},
					],
				},
			],
		]);
	});

	it("Skip on the last question submits with that answer blank", async () => {
		const {onSubmit} = renderDock();
		fireEvent.click(optionButton("Vitest"));
		fireEvent.click(screen.getByRole("button", {name: "Next"}));
		await act(async () => {
			fireEvent.click(screen.getByRole("button", {name: "Skip"}));
		});
		expect(onSubmit.mock.calls).toStrictEqual([
			[
				{
					toolUseId: "t2",
					answers: [
						{question: "Which test runner?", answer: "Vitest"},
						{question: "Which features?", answer: ""},
					],
				},
			],
		]);
	});

	it("collapses the options and dismisses the card", () => {
		const onDismiss = vi.fn();
		const {container} = render(
			<ApprovalDock toolUseId="t2" questions={QUESTIONS} onSubmit={async () => {}} onDismiss={onDismiss} />,
		);
		fireEvent.click(screen.getByRole("button", {name: "View question options"}));
		expect(screen.queryByRole("button", {name: /^Vitest/})).toBeNull();
		fireEvent.click(screen.getByRole("button", {name: "Dismiss question"}));
		expect(container.querySelector("[data-approval-card-root]")).toBeNull();
		expect(onDismiss.mock.calls).toStrictEqual([[]]);
	});
});

describe("AskUserQuestionRenderer while docked", () => {
	const call: ClientToolCall = {
		id: "t2",
		name: "AskUserQuestion",
		param: "",
		sourceUuid: "uuid-1",
		input: {questions: QUESTIONS},
	};

	function renderInline(dockedToolUseId: string | null) {
		return render(
			<AskUserQuestionProvider value={{isSessionActive: true, submitAnswer: async () => {}, dockedToolUseId}}>
				<AskUserQuestionRenderer toolCall={call} />
			</AskUserQuestionProvider>,
		);
	}

	it("shows a collapsed Asking <header> summary instead of the form", () => {
		renderInline("t2");
		const summary = screen.getByRole("button", {name: /Asking Runner/});
		expect({
			expanded: summary.getAttribute("aria-expanded"),
			form: screen.queryByRole("button", {name: "Submit"}),
			question: screen.queryByText("Which test runner?"),
		}).toStrictEqual({expanded: "false", form: null, question: null});

		fireEvent.click(summary);
		expect(summary.getAttribute("aria-expanded")).toStrictEqual("true");
		expect(screen.getByText("Which test runner?")).toBeTruthy();
	});

	it("keeps the inline form when another question is docked", () => {
		renderInline("other");
		expect(screen.getByRole("button", {name: "Submit"})).toBeTruthy();
	});
});
