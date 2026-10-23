// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import type {SlashCommand} from "../src/lib/slash-commands";

afterEach(() => {
	cleanup();
	localStorage.clear();
});

const COMMANDS: SlashCommand[] = [
	{name: "model", description: "Set the model for this session", source: "builtin", argumentHint: "[model]"},
	{name: "plan", description: "Switch to plan mode", source: "builtin"},
];

function setup() {
	render(
		<Composer
			variant="session"
			draftKey="session-alice"
			onSend={vi.fn<(prompt: string) => void>()}
			slashCommands={COMMANDS}
		/>,
	);
	return screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
}

function accept(textarea: HTMLTextAreaElement, typed: string): void {
	fireEvent.change(textarea, {target: {value: typed}});
	fireEvent.keyDown(textarea, {key: "Enter"});
}

function describeElement(element: Element): unknown {
	return {
		tag: element.tagName.toLowerCase(),
		className: element.getAttribute("class"),
		ariaHidden: element.getAttribute("aria-hidden"),
		text: element.children.length === 0 ? element.textContent : null,
		children: [...element.children].map(describeElement),
	};
}

describe("Composer skill chip", () => {
	it("paints an accepted command as upstream's accent chip over the transparent textarea text", () => {
		const textarea = setup();
		accept(textarea, "/mo");

		const chip = screen.getByTestId("composer-skill-chip");
		const overlay = chip.parentElement;
		expect({
			value: textarea.value,
			skillId: chip.getAttribute("data-skill-id"),
			text: chip.textContent,
			chip: describeElement(chip),
			chipLength: textarea.getAttribute("data-chip-length"),
			textareaTransparent: textarea.className
				.split(" ")
				.filter((token) => /^(text-transparent|caret-)/.test(token)),
			overlayAriaHidden: overlay?.getAttribute("aria-hidden"),
			rest: overlay?.querySelector("[data-skill-chip-rest]")?.outerHTML,
		}).toStrictEqual({
			value: "/model ",
			skillId: "model",
			text: "/model",
			chip: {
				tag: "span",
				className: "group/chip inline-flex relative cursor-interactive text-upstream-accent",
				ariaHidden: null,
				text: null,
				children: [
					{
						tag: "span",
						className:
							"absolute -inset-y-0.5 -start-0.5 -end-1 rounded-r5 pointer-events-none group-hover/chip:[@media(hover:hover)]:bg-upstream-accent-pressed group-data-[card-open]/chip:bg-upstream-accent-pressed",
						ariaHidden: null,
						text: "",
						children: [],
					},
					{
						tag: "span",
						className: "relative ps-2",
						ariaHidden: null,
						text: null,
						children: [
							{
								tag: "span",
								className:
									"absolute top-1/2 -translate-y-1/2 start-0 w-2 h-5 flex items-center justify-center text-[13px]/[19px] font-medium opacity-50 select-none",
								ariaHidden: "true",
								text: "/",
								children: [],
							},
							{tag: "span", className: "select-none", ariaHidden: null, text: "model", children: []},
						],
					},
				],
			},
			chipLength: "6",
			textareaTransparent: ["text-transparent", "caret-primary"],
			overlayAriaHidden: "true",
			rest: '<span data-skill-chip-rest="" class="text-primary"> </span>',
		});
	});

	it("paints the text typed after the chip in primary ink", () => {
		const textarea = setup();
		accept(textarea, "/mo");

		fireEvent.change(textarea, {target: {value: "/model opus"}});

		expect({
			chip: screen.getByTestId("composer-skill-chip").textContent,
			rest: document.querySelector("[data-skill-chip-rest]")?.textContent,
		}).toStrictEqual({chip: "/model", rest: " opus"});
	});

	it("drops the chip once the prompt no longer starts with the command, and it doesn't come back", () => {
		const textarea = setup();
		accept(textarea, "/mo");

		fireEvent.change(textarea, {target: {value: "hello"}});
		const replaced = screen.queryByTestId("composer-skill-chip");
		fireEvent.change(textarea, {target: {value: "/model "}});

		expect({
			replaced,
			retyped: screen.queryByTestId("composer-skill-chip"),
			chipLength: textarea.getAttribute("data-chip-length"),
			textareaClasses: textarea.className.split(" ").filter((token) => /^(text-transparent|caret-)/.test(token)),
		}).toStrictEqual({replaced: null, retyped: null, chipLength: null, textareaClasses: []});
	});

	it("renders no chip for a command typed by hand", () => {
		const textarea = setup();

		fireEvent.change(textarea, {target: {value: "/model "}});

		expect(screen.queryByTestId("composer-skill-chip")).toBeNull();
	});

	it("doesn't restore the chip from the saved draft", () => {
		const first = setup();
		accept(first, "/mo");
		cleanup();

		const textarea = setup();

		expect({value: textarea.value, chip: screen.queryByTestId("composer-skill-chip")}).toStrictEqual({
			value: "/model ",
			chip: null,
		});
	});
});
