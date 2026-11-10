// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {LabelledSection, ToolOutputSection} from "../src/components/tool-renderers/tool-output-section";
import {collectFindRanges} from "../src/lib/find-in-page/match";
import {resolveToolOutput} from "../src/lib/tool-output-resolve";
import type {ToolOutputShape} from "../src/lib/tool-output-shape";

vi.mock("../src/hooks/use-shiki", () => ({
	useHighlightedLines: () => null,
	getHighlighterSync: () => null,
	getHighlighterVersion: () => 0,
	subscribeHighlighter: () => () => {},
}));

afterEach(cleanup);

const TOLD =
	"Error: result (9 characters) exceeds maximum allowed tokens. Output has been saved to /x/tool-results/a.txt.\nFormat: Plain text";

function draw(shape: ToolOutputShape, label?: string): HTMLElement {
	const output = resolveToolOutput(shape, {allowMarkdown: true});
	return render(
		<div data-testid="host">
			<ToolOutputSection output={output} {...(label !== undefined && {label})} />
		</div>,
	).getByTestId("host");
}

function noteText(container: HTMLElement): string | null | undefined {
	return container.querySelector(".text-footnote.text-muted-as-secondary[data-find-omitted]")?.textContent;
}

describe("ToolOutputSection (upstream tS / Xx / iS)", () => {
	it("explains a saved result with a note and a closed Details for Claude fold", () => {
		const container = draw({note: {kind: "saved", path: "/x/tool-results/a.txt"}, toldClaude: TOLD});
		const trigger = screen.getByRole("button", {name: "Details for Claude"});
		const root = trigger.closest("[data-cds]");
		const triggerClasses = trigger.className.split(" ");
		expect({
			note: noteText(container),
			chip: container.querySelector("code.epitaxy-code-chip")?.textContent,
			expanded: trigger.getAttribute("aria-expanded"),
			classes: ["text-footnote", "text-muted-as-secondary", "group/clp", "text-body", "text-secondary"].map((c) =>
				triggerClasses.includes(c),
			),
			root: [root?.getAttribute("data-cds"), root?.hasAttribute("data-find-omitted")],
			toldInDom: container.textContent.includes("exceeds maximum allowed tokens"),
		}).toStrictEqual({
			note: "This result is too long to show here. It’s saved in /x/tool-results/a.txt.",
			chip: "/x/tool-results/a.txt",
			expanded: "false",
			classes: [true, true, true, false, false],
			root: ["Collapsible", true],
			toldInDom: false,
		});

		fireEvent.click(trigger);
		const panelRegion = container.querySelector<HTMLElement>('[role="group"][aria-label="Tool output"]');
		expect({
			expanded: trigger.getAttribute("aria-expanded"),
			region: panelRegion?.className,
			text: panelRegion?.textContent,
		}).toStrictEqual({expanded: "true", region: "max-h-[400px] overflow-y-auto", text: TOLD});
	});

	it("words the preview, capped and whole-result notes exactly", () => {
		const preview = noteText(draw({note: {kind: "preview", path: "/x/tool-results/b.txt"}, body: "x"}));
		cleanup();
		const capped = noteText(draw({note: {kind: "cappedPreview", path: "/x/tool-results/c.txt"}, body: "x"}));
		cleanup();
		const whole = noteText(draw({note: {kind: "wholeResultShown"}, body: "x"}));
		expect([preview, capped, whole]).toStrictEqual([
			"This is the start of a longer result. The rest is saved in /x/tool-results/b.txt.",
			"This is the start of a longer result. Only part of the rest is saved, in /x/tool-results/c.txt.",
			"Claude received only the start of this result. More of it is in a saved file.",
		]);
	});

	it("says No output or Waiting for the result in muted body text, find-omitted", () => {
		const empty = draw({status: "empty"});
		const emptyStack = empty.firstElementChild;
		cleanup();
		const waiting = draw({status: "waiting"});
		const waitingLine = waiting.firstElementChild?.firstElementChild;
		expect({
			emptyStack: emptyStack?.className,
			emptyChildren: [...(emptyStack?.children ?? [])].map((c) => [
				c.className,
				c.hasAttribute("data-find-omitted"),
				c.textContent,
			]),
			waiting: [waitingLine?.className, waitingLine?.hasAttribute("data-find-omitted"), waitingLine?.textContent],
		}).toStrictEqual({
			emptyStack: "flex flex-col gap-xs",
			emptyChildren: [["text-muted-as-secondary", true, "No output"]],
			waiting: ["text-muted-as-secondary", true, "Waiting for the result"],
		});
	});

	it("rules and labels the section only when given a label", () => {
		const labelled = draw({body: "out"}, "Output");
		const rule = labelled.firstElementChild;
		const stack = rule?.nextElementSibling;
		const label = stack?.firstElementChild;
		const shape = {
			rule: rule?.className,
			stack: stack?.className,
			label: [label?.className, label?.hasAttribute("data-find-omitted"), label?.textContent],
		};
		cleanup();
		const bare = draw({body: "out"});
		expect({...shape, bareRule: bare.querySelector(".border-t") !== null}).toStrictEqual({
			rule: "border-t",
			stack: "flex flex-col gap-xs",
			label: ["text-footnote text-muted-as-secondary", true, "Output"],
			bareRule: false,
		});
	});

	it("lets in-app Find skip the label, the note, No output and the fold but match the body", () => {
		const saved = draw({note: {kind: "saved", path: "/x/tool-results/a.txt"}, toldClaude: TOLD}, "Output");
		const savedHits = ["Details for Claude", "Output", "too long"].map((q) => collectFindRanges(saved, q).length);
		cleanup();
		const body = draw({note: {kind: "preview", path: "/x/tool-results/b.txt"}, body: "zebra line"}, "Output");
		const bodyHits = ["zebra", "start of a longer"].map((q) => collectFindRanges(body, q).length);
		cleanup();
		const empty = draw({status: "empty"});
		expect({savedHits, bodyHits, empty: collectFindRanges(empty, "No output").length}).toStrictEqual({
			savedHits: [0, 0, 0],
			bodyHits: [1, 0],
			empty: 0,
		});
	});

	it("exports the bare labelled section", () => {
		const {container} = render(
			<LabelledSection label="Input">
				<span>rows</span>
			</LabelledSection>,
		);
		expect(container.innerHTML).toBe(
			'<div class="flex flex-col gap-xs"><div data-find-omitted="" class="text-footnote text-muted-as-secondary">Input</div><span>rows</span></div>',
		);
	});
});
