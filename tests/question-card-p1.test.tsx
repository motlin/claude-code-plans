// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {QuestionCard} from "../src/components/question-card";
import {QuestionReceipt} from "../src/components/question-receipt";
import type {QuestionLike} from "../src/lib/ask-user-question";

afterEach(cleanup);

const SINGLE: QuestionLike = {
	question: "Which test runner?",
	header: "Runner",
	options: [
		{label: "Vitest", description: "Vite-native"},
		{label: "Jest", description: "Widely adopted"},
	],
};

const MULTI: QuestionLike = {
	question: "Which features?",
	header: "Features",
	multiSelect: true,
	options: [{label: "Coverage"}, {label: "Watch"}, {label: "UI"}],
};

function focusedName(): string | null {
	const active = document.activeElement;
	if (active === null || active === document.body) return null;
	if (active.hasAttribute("data-approval-card-root")) return "root";
	return active.getAttribute("aria-label") ?? active.textContent;
}

function pressed(): Array<string | null> {
	return Array.from(document.querySelectorAll("[data-question-answer]")).map((node) =>
		node.getAttribute("aria-pressed"),
	);
}

describe("QuestionCard ArrowUp/ArrowDown roving, as upstream's st()", () => {
	it("marks every option and the Other button with data-question-answer", () => {
		render(<QuestionCard questions={[SINGLE]} onSubmit={async () => {}} />);

		expect(
			Array.from(document.querySelectorAll("[data-question-answer]")).map(
				(node) => node.getAttribute("aria-label") ?? node.textContent,
			),
		).toStrictEqual(["VitestVite-native", "JestWidely adopted", "Other"]);
	});

	it("from the card root, ArrowDown focuses the first option and ArrowUp the last, without changing the selection", () => {
		render(<QuestionCard questions={[SINGLE]} onSubmit={async () => {}} />);
		const root = screen.getByRole("group", {name: "Which test runner?"});
		root.focus();
		const down = fireEvent.keyDown(root, {key: "ArrowDown"});
		const afterDown = focusedName();
		root.focus();
		const up = fireEvent.keyDown(root, {key: "ArrowUp"});

		expect({down, afterDown, up, afterUp: focusedName(), pressed: pressed()}).toStrictEqual({
			down: false,
			afterDown: "VitestVite-native",
			up: false,
			afterUp: "Other",
			pressed: ["true", "false", "false"],
		});
	});

	it("moves between options and clamps at both ends, still preventing the key", () => {
		render(<QuestionCard questions={[SINGLE]} onSubmit={async () => {}} />);
		const first = screen.getByRole("button", {name: /^Vitest/});
		first.focus();
		const upAtTop = fireEvent.keyDown(first, {key: "ArrowUp"});
		const atTop = focusedName();
		fireEvent.keyDown(first, {key: "ArrowDown"});
		const second = focusedName();
		const other = screen.getByRole("button", {name: "Other"});
		other.focus();
		const downAtBottom = fireEvent.keyDown(other, {key: "ArrowDown"});

		expect({
			upAtTop,
			atTop,
			second,
			downAtBottom,
			atBottom: focusedName(),
			pressed: pressed(),
		}).toStrictEqual({
			upAtTop: false,
			atTop: "VitestVite-native",
			second: "JestWidely adopted",
			downAtBottom: false,
			atBottom: "Other",
			pressed: ["true", "false", "false"],
		});
	});

	it("lets modified arrows pass, and swallows a repeat ArrowDown on the root without moving", () => {
		render(<QuestionCard questions={[SINGLE]} onSubmit={async () => {}} />);
		const first = screen.getByRole("button", {name: /^Vitest/});
		first.focus();
		const shift = fireEvent.keyDown(first, {key: "ArrowDown", shiftKey: true});
		const afterShift = focusedName();
		const root = screen.getByRole("group", {name: "Which test runner?"});
		root.focus();
		const repeat = fireEvent.keyDown(root, {key: "ArrowDown", repeat: true});

		expect({shift, afterShift, repeat, afterRepeat: focusedName()}).toStrictEqual({
			shift: true,
			afterShift: "VitestVite-native",
			repeat: false,
			afterRepeat: "root",
		});
	});
});

describe("QuestionCard multi-select status, as upstream's pt", () => {
	it("reads 0 selected, then 2 selected after two picks", () => {
		render(<QuestionCard questions={[MULTI]} onSubmit={async () => {}} />);
		const before = screen.getByRole("status");
		const initial = [before.textContent, before.className, before.getAttribute("data-find-omitted")];
		fireEvent.click(screen.getByRole("button", {name: "Coverage"}));
		fireEvent.click(screen.getByRole("button", {name: "UI"}));

		expect({initial, after: screen.getByRole("status").textContent}).toStrictEqual({
			initial: ["0 selected", "sr-only select-none", ""],
			after: "2 selected",
		});
	});

	it("counts Other once it is chosen, as upstream's selected holds -1", () => {
		render(<QuestionCard questions={[MULTI]} onSubmit={async () => {}} />);
		fireEvent.click(screen.getByRole("button", {name: "Watch"}));
		fireEvent.click(screen.getByRole("button", {name: "Other"}));

		expect(screen.getByRole("status").textContent).toBe("2 selected");
	});

	it("draws no status on a single-select page", () => {
		render(<QuestionCard questions={[SINGLE]} onSubmit={async () => {}} />);

		expect(screen.queryByRole("status")).toBeNull();
	});
});

describe("QuestionReceipt answer line, as upstream's Cd", () => {
	it("renders the answer as a scroll-capped pre-wrap div that keeps newlines", () => {
		const {container} = render(
			<QuestionReceipt rows={[{question: "Why?", answer: "a\nb", notes: null}]} enters={false} />,
		);
		const row = container.querySelector("[data-answered-question]");
		const [question, answer] = Array.from(row?.children ?? []);

		expect({
			question: [question?.tagName, question?.className],
			answer: [answer?.tagName, answer?.className, answer?.textContent],
		}).toStrictEqual({
			question: ["DIV", "text-body font-medium text-primary break-words [unicode-bidi:plaintext]"],
			answer: [
				"DIV",
				"max-h-[250px] overflow-y-auto whitespace-pre-wrap text-body text-secondary [overflow-wrap:anywhere] [unicode-bidi:plaintext]",
				"a\nb",
			],
		});
	});
});

describe("QuestionCard option descriptions, as upstream's R", () => {
	it("keeps newlines in a plain description and leaves the option a plain button", () => {
		render(
			<QuestionCard
				questions={[{...SINGLE, options: [{label: "Vitest", description: "fast\nnative"}, {label: "Jest"}]}]}
				onSubmit={async () => {}}
			/>,
		);
		const option = screen.getByRole("button", {name: /^Vitest/});
		const description = option.querySelector(".text-secondary");

		expect({
			tag: option.tagName,
			rows: document.querySelectorAll("[data-question-answer-row]").length,
			description: [description?.className.split(" ").includes("whitespace-pre-wrap"), description?.textContent],
		}).toStrictEqual({tag: "BUTTON", rows: 0, description: [true, "fast\nnative"]});
	});

	it("linkifies a description with a URL inside a data-question-answer-row whose link doesn't pick the option", () => {
		const open = vi.fn<(event: Event) => void>((event) => {
			event.preventDefault();
		});
		render(
			<QuestionCard
				questions={[
					{
						...SINGLE,
						options: [{label: "Vitest"}, {label: "Jest", description: "see https://example.com\nnext"}],
					},
				]}
				onSubmit={async () => {}}
			/>,
		);
		const row = document.querySelector("[data-question-answer-row]");
		const button = row?.querySelector("button[data-question-answer]");
		const link = row?.querySelector("a");
		link?.addEventListener("click", open);
		fireEvent.click(link!);
		const afterLink = button?.getAttribute("aria-pressed");
		fireEvent.click(screen.getByText("Jest"));

		expect({
			rowCount: document.querySelectorAll("[data-question-answer-row]").length,
			labelled: document.getElementById(button?.getAttribute("aria-labelledby") ?? "")?.textContent,
			button: button?.className
				.split(" ")
				.filter((name) => ["absolute", "inset-0", "rounded-[inherit]"].includes(name)),
			link: [link?.getAttribute("href"), link?.getAttribute("target"), link?.getAttribute("rel")],
			descriptionText: link?.parentElement?.textContent,
			opened: open.mock.calls.length,
			afterLink,
			afterRow: button?.getAttribute("aria-pressed"),
			name: screen.getByRole("button", {name: /^Jest/}) === button,
		}).toStrictEqual({
			rowCount: 1,
			labelled: "Jestsee https://example.com\nnext",
			button: ["absolute", "inset-0", "rounded-[inherit]"],
			link: ["https://example.com", "_blank", "noreferrer"],
			descriptionText: "see https://example.com\nnext",
			opened: 1,
			afterLink: "false",
			afterRow: "true",
			name: true,
		});
	});

	it("roves from a link inside a row to the next option", () => {
		render(
			<QuestionCard
				questions={[
					{...SINGLE, options: [{label: "Vitest", description: "https://vitest.dev"}, {label: "Jest"}]},
				]}
				onSubmit={async () => {}}
			/>,
		);
		const link = document.querySelector("[data-question-answer-row] a") as HTMLAnchorElement;
		link.focus();
		const result = fireEvent.keyDown(link, {key: "ArrowDown"});

		expect({result, focused: focusedName()}).toStrictEqual({result: false, focused: "Jest"});
	});
});

describe("QuestionCard Escape in the Other box, as upstream's ct", () => {
	it("cedes focus to the card root, keeps the text, and submits nothing", () => {
		const onSubmit = vi.fn<() => Promise<void>>(async () => {});
		render(<QuestionCard questions={[SINGLE]} onSubmit={onSubmit} />);
		fireEvent.click(screen.getByRole("button", {name: "Other"}));
		const box = screen.getByRole("textbox", {name: "Other option"});
		fireEvent.change(box, {target: {value: "x"}});
		fireEvent.keyDown(box, {key: "Escape"});

		expect({
			focused: focusedName(),
			text: screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Other option"}).value,
			calls: onSubmit.mock.calls.length,
		}).toStrictEqual({focused: "root", text: "x", calls: 0});
	});
});
