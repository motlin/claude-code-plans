// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {QuestionCard} from "../src/components/question-card";
import {QuestionReceipt} from "../src/components/question-receipt";
import type {QuestionLike} from "../src/lib/ask-user-question";
import {clearLanding, landingSeams, recordLanding} from "../src/lib/approval-slot-landing";
import {compileAll} from "./helpers/tailwind-design-system";

afterEach(cleanup);

// A fake PEM armor, assembled so no literal key header sits in the source.
const KEY_KIND = ["RSA", "PRIVATE", "KEY"].join(" ");
const PEM_BEGIN = `-----BEGIN ${KEY_KIND}-----`;

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

describe("QuestionCard root radius, as upstream's epitaxy-approval-card rounded-card", () => {
	it("rounds the card root with rounded-card (12px comfortable), not the fixed 10px rounded-r7", () => {
		render(<QuestionCard questions={[SINGLE]} onSubmit={async () => {}} />);
		const classes = screen.getByRole("group", {name: "Which test runner?"}).className.split(" ");
		expect({card: classes.includes("rounded-card"), r7: classes.includes("rounded-r7")}).toStrictEqual({
			card: true,
			r7: false,
		});
	});
});

describe("QuestionCard pad, gap and checkbox tokens, as upstream's comfortable card", () => {
	it("draws the header, pager, options, marks, Other row, textarea and actions on the density tokens", () => {
		render(<QuestionCard questions={[SINGLE, MULTI]} onSubmit={async () => {}} />);
		const card = screen.getByRole("group", {name: "Which test runner?"});
		const header = card.firstElementChild!;
		const option = screen.getByRole("button", {name: "VitestVite-native"});
		const radioMarks = Array.from(card.querySelectorAll("[data-checked], [data-unchecked]")).map((mark) => ({
			className: mark.className,
			inner: mark.firstElementChild?.getAttribute("class") ?? null,
		}));
		fireEvent.click(screen.getByRole("button", {name: "Other"}));
		const otherRow = screen.getByRole("button", {name: "Other"}).parentElement!;
		const textarea = screen.getByRole("textbox", {name: "Other option"});
		fireEvent.click(screen.getByRole("button", {name: "Show next question"}));
		fireEvent.click(screen.getByRole("button", {name: "Coverage"}));
		const checkbox = screen.getByRole("button", {name: "Coverage"}).querySelector("[data-checked]")!;
		const actions = card.querySelector(".epitaxy-approval-actions")!;

		expect({
			header: header.className,
			pager: header.lastElementChild?.className,
			pagerIcons: Array.from(header.querySelectorAll("button svg")).map((icon) => icon.getAttribute("class")),
			option: option.className,
			optionText: option.querySelector("div")?.className,
			radioMarks,
			checkbox: {className: checkbox.className, check: checkbox.firstElementChild?.getAttribute("class")},
			otherRow: otherRow.className,
			textarea: textarea.className,
			actions: actions.className,
		}).toStrictEqual({
			header: "bg-alpha-1 px-lg flex gap-md py-md items-center",
			pager: "flex shrink-0 items-center -my-xs -me-sm gap-xs text-caption text-muted-as-secondary",
			pagerIcons: ["lucide lucide-chevron-left size-icon", "lucide lucide-chevron-right size-icon"],
			option: "epitaxy-answer-option group flex w-full items-start gap-md px-lg py-lg text-start cursor-pointer focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus disabled:cursor-default",
			optionText: "relative flex min-w-0 flex-1 flex-col gap-xs select-text",
			radioMarks: [
				{
					className:
						"mt-[calc((1lh-var(--cds-checkbox,1rem))/2)] flex size-[var(--cds-checkbox)] shrink-0 items-center justify-center rounded-full bg-fill-accent text-white",
					inner: "size-[calc(var(--cds-checkbox)-0.625rem)] rounded-full bg-white",
				},
				{
					className:
						"mt-[calc((1lh-var(--cds-checkbox,1rem))/2)] flex size-[var(--cds-checkbox)] shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_var(--color-checkbox-edge)] group-hover:shadow-[inset_0_0_0_1px_var(--color-checkbox-edge-hover)]",
					inner: null,
				},
				{
					className:
						"mt-[calc((1lh-var(--cds-checkbox,1rem))/2)] flex size-[var(--cds-checkbox)] shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_var(--color-checkbox-edge)] group-hover:shadow-[inset_0_0_0_1px_var(--color-checkbox-edge-hover)]",
					inner: null,
				},
			],
			checkbox: {
				className:
					"mt-[calc((1lh-var(--cds-checkbox,1rem))/2)] flex size-[var(--cds-checkbox)] shrink-0 items-center justify-center rounded-[var(--cds-checkbox-radius)] bg-fill-accent text-white",
				check: "lucide lucide-check size-[calc(var(--cds-checkbox)-0.25rem)]",
			},
			otherRow:
				"epitaxy-answer-option group relative grid grid-cols-[auto_1fr] items-start gap-x-md gap-y-sm px-lg py-lg",
			textarea:
				"relative z-[1] col-start-2 row-start-2 min-h-[calc(1lh+2*var(--cds-pad-sm))] max-h-[calc(4lh+2*var(--cds-pad-sm))] w-full resize-none rounded-[var(--upstream-radius)] bg-fill-field px-md py-sm font-sans text-body text-primary outline-none [field-sizing:content] placeholder:text-ink-muted shadow-field-ring transition duration-150 hover:shadow-field-hover focus-visible:shadow-focus disabled:opacity-50",
			actions:
				"epitaxy-approval-actions flex items-center justify-end gap-sm px-lg pb-lg pt-md @max-[420px]:flex-col @max-[420px]:items-stretch @max-[420px]:[&>*]:w-full",
		});
	});

	it("compiles the mark, dot, check and textarea sizes from the checkbox and pad tokens", async () => {
		const candidates = [
			"size-[var(--cds-checkbox)]",
			"mt-[calc((1lh-var(--cds-checkbox,1rem))/2)]",
			"size-[calc(var(--cds-checkbox)-0.625rem)]",
			"size-[calc(var(--cds-checkbox)-0.25rem)]",
			"rounded-[var(--cds-checkbox-radius)]",
			"max-h-[calc(4lh+2*var(--cds-pad-sm))]",
		];
		const css = await compileAll(candidates);
		expect(candidates.map((candidate) => css[candidate]?.replace(/^[^{]*\{ | \}$/g, ""))).toStrictEqual([
			"width: var(--cds-checkbox); height: var(--cds-checkbox);",
			"margin-top: calc((1lh - var(--cds-checkbox,1rem)) / 2);",
			"width: calc(var(--cds-checkbox) - 0.625rem); height: calc(var(--cds-checkbox) - 0.625rem);",
			"width: calc(var(--cds-checkbox) - 0.25rem); height: calc(var(--cds-checkbox) - 0.25rem);",
			"border-radius: var(--cds-checkbox-radius);",
			"max-height: calc(4lh + 2 * var(--cds-pad-sm));",
		]);
	});

	it("pads the read-only hint by the card's pad tokens", () => {
		render(<QuestionCard questions={[SINGLE]} />);
		const actions = document.querySelector(".epitaxy-approval-actions")!;

		expect(actions.previousElementSibling?.className).toStrictEqual("px-lg pt-sm text-footnote text-secondary");
	});
});

describe("QuestionCard question text, as upstream's code chip and TextLink header", () => {
	it("paints a backtick run as upstream's code chip and a URL as a TextLink, keeping the raw text in the label", () => {
		const question = "See `docs/a.md` or https://example.com/a";
		render(<QuestionCard questions={[{question, options: [{label: "Yes"}]}]} onSubmit={async () => {}} />);
		const card = screen.getByRole("group", {name: question});
		const title = card.firstElementChild!.firstElementChild!;

		expect({
			codes: Array.from(title.querySelectorAll("code")).map((code) => ({
				className: code.className,
				dir: code.getAttribute("dir"),
				text: code.textContent,
			})),
			links: Array.from(title.querySelectorAll("a")).map((link) => link.getAttribute("href")),
			text: title.textContent,
		}).toStrictEqual({
			codes: [
				{
					className:
						"rounded-[calc(var(--cds-h-control-nested)/4)] bg-alpha-1 px-xs font-mono text-code font-normal",
					dir: "ltr",
					text: "docs/a.md",
				},
			],
			links: ["https://example.com/a"],
			text: "See docs/a.md or https://example.com/a",
		});
	});
	it("draws **text** as upstream's strong.font-medium with code chips nested, leaving flanked and unmatched ** literal", () => {
		const chip = `<code dir="ltr" class="rounded-[calc(var(--cds-h-control-nested)/4)] bg-alpha-1 px-xs font-mono text-code font-normal">`;
		const titleHtml = (question: string) => {
			render(<QuestionCard questions={[{question, options: [{label: "Yes"}]}]} onSubmit={async () => {}} />);
			const html = screen.getByRole("group", {name: question}).firstElementChild!.firstElementChild!.innerHTML;
			cleanup();
			return html;
		};

		expect(
			[
				"Run **`vitest` now** or **see https://example.com/a**?",
				"a**b** and **c and ** d ** and **e**f",
				"Keep `x**y**z` and **a** ``b``",
			].map(titleHtml),
		).toStrictEqual([
			`Run <strong class="font-medium">${chip}vitest</code> now</strong> or <strong class="font-medium">see <a href="https://example.com/a" target="_blank" rel="noreferrer" dir="ltr" class="cds-reset text-link inline cursor-pointer">https://example.com/a</a></strong>?`,
			"a**b** and **c and ** d ** and **e**f",
			"Keep `x**y**z` and **a** ``b``",
		]);
	});
});

describe("QuestionCard Skip while read-only, as upstream's disabled cds Button", () => {
	it("keeps the disabled Skip at opacity 1 with the fizzy disabled ink and fill, opacity .4 elsewhere, and no pointer events", () => {
		render(<QuestionCard questions={[SINGLE]} />);
		const skip = screen.getByRole("button", {name: "Skip"});
		const classes = skip.className.split(" ");
		expect({
			disabled: skip.hasAttribute("disabled"),
			disabledClasses: classes.filter((name) => name.includes("disabled") || name.includes("not-allowed")),
		}).toStrictEqual({
			disabled: true,
			disabledClasses: [
				"[&:disabled:not([aria-busy])]:opacity-disabled",
				"disabled:pointer-events-none",
				"stacks:[&:disabled:not([aria-busy])]:opacity-100",
				"stacks:[&:disabled:not([aria-busy])]:text-button-disabled",
				"stacks:[&:disabled:not([aria-busy])]:[--shortcut-cap-ink:currentColor]",
				"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
			],
		});
	});
});

describe("QuestionCard pager arrows, as upstream's ghost icon-only cds Buttons", () => {
	it("gives both arrows the disabled look with the dimmer icon-only ink under fizzy colour, and no pointer events", () => {
		render(<QuestionCard questions={[SINGLE, MULTI]} onSubmit={async () => {}} />);
		const classes = ["Show previous question", "Show next question"].map(
			(name) => screen.getByRole("button", {name}).className,
		);
		const arrow =
			"flex h-control aspect-square cursor-pointer items-center justify-center rounded-[var(--upstream-radius)] hover:bg-fill-ghost-hover [&:disabled:not([aria-busy])]:opacity-disabled disabled:pointer-events-none stacks:[&:disabled:not([aria-busy])]:opacity-100 stacks:[&:disabled:not([aria-busy])]:text-button-disabled stacks:[&:disabled:not([aria-busy])]:[--shortcut-cap-ink:currentColor] stacks:[&:disabled:not([aria-busy])]:not-in-data-[cds=SplitDropdownButton]:[--upstream-text-button-disabled:var(--upstream-icon-only-disabled)]";
		expect(classes).toStrictEqual([arrow, arrow]);
	});

	it("compiles the icon-only ink swap only under fizzy colour, outside a SplitDropdownButton, and never while busy", async () => {
		const candidate =
			"stacks:[&:disabled:not([aria-busy])]:not-in-data-[cds=SplitDropdownButton]:[--upstream-text-button-disabled:var(--upstream-icon-only-disabled)]";
		expect((await compileAll([candidate]))[candidate]).toStrictEqual(
			String.raw`@media (forced-colors: none) { .stacks\:\[\&\:disabled\:not\(\[aria-busy\]\)\]\:not-in-data-\[cds\=SplitDropdownButton\]\:\[--upstream-text-button-disabled\:var\(--upstream-icon-only-disabled\)\]:where([data-cds-fizzy-lake~="color"], [data-cds-fizzy-lake~="color"] *):not(:where([data-cds-theme], [data-cds-theme] *)):disabled:not([aria-busy]):not(:where([data-cds="SplitDropdownButton"]) *) { --upstream-text-button-disabled: var(--upstream-icon-only-disabled); } }`,
		);
	});
});

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
			question: ["DIV", "text-body font-control text-primary break-words [unicode-bidi:plaintext]"],
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
		const link = document.querySelector<HTMLAnchorElement>("[data-question-answer-row] a")!;
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

describe("QuestionCard marks, as upstream's cds Checkbox / Radio edge", () => {
	const EDGE = "shadow-[inset_0_0_0_1px_var(--color-checkbox-edge)]";
	const EDGE_HOVER = "group-hover:shadow-[inset_0_0_0_1px_var(--color-checkbox-edge-hover)]";

	function marks() {
		return Array.from(document.querySelectorAll("[data-question-answer]")).map((answer) => {
			const option = answer.closest(".epitaxy-answer-option");
			const mark = option?.querySelector("[data-unchecked], [data-checked]");
			return {
				group: option?.classList.contains("group") ?? false,
				edge: mark?.classList.contains(EDGE) ?? false,
				edgeHover: mark?.classList.contains(EDGE_HOVER) ?? false,
				borderStrong: mark?.className.includes("--upstream-border-strong") ?? true,
			};
		});
	}

	const UNCHECKED = {group: true, edge: true, edgeHover: true, borderStrong: false};
	const CHECKED = {group: true, edge: false, edgeHover: false, borderStrong: false};

	it("draws unchecked radio marks with the checkbox edge and the hover edge", () => {
		render(<QuestionCard questions={[SINGLE]} onSubmit={async () => {}} />);
		fireEvent.click(screen.getByRole("button", {name: "JestWidely adopted"}));

		expect(marks()).toStrictEqual([UNCHECKED, CHECKED, UNCHECKED]);
	});

	it("draws unchecked checkbox marks the same way", () => {
		render(<QuestionCard questions={[MULTI]} onSubmit={async () => {}} />);

		expect(marks()).toStrictEqual([UNCHECKED, UNCHECKED, UNCHECKED, UNCHECKED]);
	});
});

describe("QuestionCard after a landing", () => {
	let now = 0;
	beforeEach(() => {
		now = 1000;
		vi.spyOn(performance, "now").mockImplementation(() => now);
		vi.spyOn(landingSeams, "isTrusted").mockReturnValue(true);
	});
	afterEach(() => {
		clearLanding(window);
		vi.restoreAllMocks();
	});

	it("keeps an arrow under 400ms on the landed root, then roves on a fresh pick and lets the next key through", () => {
		render(<QuestionCard questions={[SINGLE]} onSubmit={async () => {}} />);
		const root = screen.getByRole("group", {name: "Which test runner?"});
		root.focus();
		recordLanding(window, {
			at: root,
			onCard: true,
			from: root.parentElement!,
			drawn: () => ({chordActsAnywhere: false, toComposer: () => undefined}),
		});
		now += 100;
		fireEvent.keyDown(root, {key: "ArrowDown"});
		const early = focusedName();
		const earlyEnter = fireEvent.keyDown(root, {key: "Enter"});
		now += 350;
		fireEvent.keyDown(root, {key: "ArrowDown"});
		const fresh = focusedName();
		const enter = fireEvent.keyDown(document.activeElement!, {key: "Enter"});
		expect({early, earlyEnter, fresh, enter}).toStrictEqual({
			early: "root",
			earlyEnter: false,
			fresh: "VitestVite-native",
			enter: true,
		});
	});
});

describe("QuestionCard option preview panel, as upstream's GF under Mt", () => {
	const PREVIEWED: QuestionLike = {
		question: "Layout?",
		options: [{label: "Grid", preview: "grid **bold**"}, {label: "List", preview: "list view"}, {label: "Plain"}],
	};
	const PREVIEW_CLASS =
		"px-lg max-h-[240px] overflow-y-auto pb-lg text-secondary flex flex-col gap-2 font-sans text-body";

	function previews(): HTMLElement[] {
		return Array.from(document.querySelectorAll<HTMLElement>("[data-question-option-preview]"));
	}

	function previewed(): Array<{after: string | null; text: string}> {
		return previews().map((node) => ({
			after: node.previousElementSibling?.textContent ?? null,
			text: node.textContent.trim(),
		}));
	}

	it("shows the preselected option's preview right after it at mount, as a focusable scroll region", () => {
		render(<QuestionCard questions={[PREVIEWED]} onSubmit={async () => {}} />);
		const [block] = previews();

		expect({
			count: previews().length,
			afterPressed: block?.previousElementSibling?.getAttribute("aria-pressed"),
			className: block?.className,
			tabIndex: block?.tabIndex,
			bold: block?.querySelector("strong")?.textContent,
			inner: block?.firstElementChild?.className,
		}).toStrictEqual({
			count: 1,
			afterPressed: "true",
			className: PREVIEW_CLASS,
			tabIndex: 0,
			bold: "bold",
			inner: "[&_pre_code]:!whitespace-pre",
		});
	});

	it("follows the pick, and leaves for an option without one, for Other and for Skip", () => {
		render(<QuestionCard questions={[PREVIEWED, SINGLE]} onSubmit={async () => {}} />);
		const atMount = previewed();
		fireEvent.click(screen.getByRole("button", {name: "List"}));
		const onList = previewed();
		fireEvent.click(screen.getByRole("button", {name: "Plain"}));
		const onPlain = previewed();
		fireEvent.click(screen.getByRole("button", {name: "Grid"}));
		fireEvent.click(screen.getByRole("button", {name: "Other"}));
		const onOther = previewed();

		expect({atMount, onList, onPlain, onOther}).toStrictEqual({
			atMount: [{after: "Grid", text: "grid bold"}],
			onList: [{after: "List", text: "list view"}],
			onPlain: [],
			onOther: [],
		});
	});

	it("leaves when the question is skipped", () => {
		render(<QuestionCard questions={[PREVIEWED, SINGLE]} onSubmit={async () => {}} />);
		fireEvent.click(screen.getByRole("button", {name: "Skip"}));
		fireEvent.click(screen.getByRole("button", {name: "Show previous question"}));

		expect(previewed()).toStrictEqual([]);
	});

	it("never shows one on a multi-select question, or for a blank or null preview", () => {
		const {unmount} = render(
			<QuestionCard questions={[{...PREVIEWED, multiSelect: true}]} onSubmit={async () => {}} />,
		);
		fireEvent.click(screen.getByRole("button", {name: "Grid"}));
		const multi = previewed();
		unmount();
		const {unmount: unmountBlank} = render(
			<QuestionCard
				questions={[{question: "Q?", options: [{label: "A", preview: "   "}]}]}
				onSubmit={async () => {}}
			/>,
		);
		const blank = previewed();
		unmountBlank();
		render(
			<QuestionCard
				questions={[{question: "Q?", options: [{label: "A", preview: null}]}]}
				onSubmit={async () => {}}
			/>,
		);

		expect({multi, blank, nulled: previewed()}).toStrictEqual({multi: [], blank: [], nulled: []});
	});

	it("shows page 2's own preview after Next", () => {
		const second: QuestionLike = {question: "Theme?", options: [{label: "Dark", preview: "dark mode"}]};
		render(<QuestionCard questions={[PREVIEWED, second]} onSubmit={async () => {}} />);
		fireEvent.click(screen.getByRole("button", {name: /^Next/}));

		expect(previewed()).toStrictEqual([{after: "Dark", text: "dark mode"}]);
	});

	it("renders an HTML preview sanitized once its sanitizer loads, without the flex column", async () => {
		render(
			<QuestionCard
				questions={[
					{question: "Q?", options: [{label: "A", preview: '<div class="x" style="color:red">hi</div>'}]},
				]}
				onSubmit={async () => {}}
			/>,
		);
		const block = await waitFor(() => {
			const [found] = previews();
			if (found === undefined) throw new Error("no preview yet");
			return found;
		});

		expect({className: block.className, html: block.innerHTML}).toStrictEqual({
			className: "px-lg max-h-[240px] overflow-y-auto pb-lg text-secondary font-sans text-body",
			html: '<div style="color:red">hi</div>',
		});
	});

	it("lets ArrowDown scroll a focused preview instead of roving", () => {
		render(<QuestionCard questions={[PREVIEWED]} onSubmit={async () => {}} />);
		const [block] = previews();
		block?.focus();
		const notPrevented = block === undefined ? null : fireEvent.keyDown(block, {key: "ArrowDown"});

		expect({notPrevented, focused: document.activeElement === block}).toStrictEqual({
			notPrevented: true,
			focused: true,
		});
	});
});

describe("QuestionCard option hairlines, as upstream's .epitaxy-answer-option + .epitaxy-answer-option", () => {
	const SIBLING = ".epitaxy-answer-option + .epitaxy-answer-option";

	function hairlines(): boolean[] {
		return Array.from(document.querySelectorAll(".epitaxy-answer-option")).map((node) => node.matches(SIBLING));
	}

	it("draws no divide-y on the options container and a hairline above every option after the first", () => {
		render(<QuestionCard questions={[{...SINGLE, multiSelect: true}]} onSubmit={async () => {}} />);
		const container = document.querySelector(".epitaxy-answer-option")?.parentElement;

		expect({divide: container?.className.includes("divide-y"), hairlines: hairlines()}).toStrictEqual({
			divide: false,
			hairlines: [false, true, true],
		});
	});

	it("draws none above the option right after an open preview", () => {
		render(
			<QuestionCard
				questions={[{question: "Layout?", options: [{label: "Grid", preview: "grid"}, {label: "List"}]}]}
				onSubmit={async () => {}}
			/>,
		);

		expect(hairlines()).toStrictEqual([false, false, true]);
	});
});

describe("QuestionCard secret masking (upstream c2f6611a3)", () => {
	const FAKE_GH = `ghp_${"A".repeat(36)}`;
	const MASKED_GH = `ghp_AAAA${"•".repeat(32)}`;
	const FAKE_AWS = "AKIAEXAMPLEFAKE12345";

	it("masks option labels and descriptions, and the question name compactly", () => {
		render(
			<QuestionCard
				questions={[
					{
						question: `Use ${FAKE_AWS}?`,
						header: "Key",
						options: [{label: `Token ${FAKE_GH}`, description: `desc ${FAKE_GH}`}, {label: "No"}],
					},
				]}
				onSubmit={async () => {}}
			/>,
		);
		const root = document.querySelector("[data-approval-card-root]")!;
		expect({
			name: root.getAttribute("aria-label"),
			heading: root.firstElementChild!.textContent,
			option: document.querySelector("[data-question-answer]")!.textContent,
		}).toStrictEqual({
			name: `Use AKIAEXAM${"•".repeat(7)}?`,
			heading: `Use AKIAEXAM${"•".repeat(7)}?`,
			option: `Token ${MASKED_GH}desc ${MASKED_GH}`,
		});
	});

	it("cuts the question name before an unterminated private key", () => {
		render(
			<QuestionCard
				questions={[{question: `Paste ${PEM_BEGIN}\nMIIB`, header: "K", options: [{label: "a"}]}]}
				onSubmit={async () => {}}
			/>,
		);
		expect(document.querySelector("[data-approval-card-root]")!.getAttribute("aria-label")).toBe("Paste …");
	});
});
