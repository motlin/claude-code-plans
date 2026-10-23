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

	it("shows no argument hint for a command typed by hand", () => {
		const textarea = setup();

		fireEvent.change(textarea, {target: {value: "/model "}});

		expect(screen.queryByTestId("slash-argument-hint")).toBeNull();
	});

	it("paints the hint at 50% of the inherited ink, hidden from assistive tech", () => {
		const textarea = setup();
		accept(textarea, "/mo");

		expect(screen.getByTestId("slash-argument-hint").outerHTML).toBe(
			'<span data-testid="slash-argument-hint" data-skill-arg-hint="true" aria-hidden="true" style="opacity: 0.5;">[model]</span>',
		);
	});

	it("places the hint after all trailing whitespace on the chip's line", () => {
		const textarea = setup();
		accept(textarea, "/mo");
		const before = (): string => {
			const overlay = screen.getByTestId("composer-skill-chip").parentElement;
			const hint = screen.getByTestId("slash-argument-hint");
			// The chip's invisible width probe isn't painted text.
			const children = [...(overlay?.childNodes ?? [])].filter(
				(node) => !(node instanceof HTMLElement && node.hasAttribute("data-skill-chip-measure")),
			);
			return children
				.slice(0, children.indexOf(hint))
				.map((node) => node.textContent)
				.join("");
		};

		fireEvent.change(textarea, {target: {value: "/model   "}});
		const spaces = before();
		fireEvent.change(textarea, {target: {value: "/model \n"}});
		const newline = {
			before: before(),
			after: screen.getByTestId("slash-argument-hint").nextSibling?.textContent,
		};

		expect({spaces, newline}).toStrictEqual({
			spaces: "/model   ",
			newline: {before: "/model ", after: "\n"},
		});
	});
	it("announces the hint through an always-mounted live twin linked only while the hint shows", () => {
		const textarea = setup();
		const twin = (): unknown => {
			const describedBy = textarea.getAttribute("aria-describedby");
			const span = document.querySelector('[data-skill-arg-hint-sr="skill-arg-hint"]');
			return {
				describedBy: describedBy === null ? null : describedBy === span?.id ? "twin" : describedBy,
				idPrefix: span?.id.startsWith("skill-arg-hint-sr-"),
				role: span?.getAttribute("role"),
				live: span?.getAttribute("aria-live"),
				style: span?.getAttribute("style"),
				text: span?.textContent,
			};
		};
		// Upstream's `clip:rect(0 0 0 0)`, as jsdom serializes it.
		const style =
			"position: absolute; top: 0px; left: 0px; width: 1px; height: 1px; overflow: hidden; clip: rect(0px); clip-path: inset(50%); white-space: nowrap;";

		const before = twin();
		accept(textarea, "/mo");
		const accepted = twin();
		fireEvent.change(textarea, {target: {value: "/model opus"}});
		const typed = twin();
		fireEvent.change(textarea, {target: {value: "/model "}});
		const restored = twin();

		const shown = {describedBy: "twin", idPrefix: true, role: "status", live: "polite", style, text: "[model]"};
		const hidden = {...shown, describedBy: null, text: ""};
		expect({before, accepted, typed, restored}).toStrictEqual({
			before: hidden,
			accepted: shown,
			typed: hidden,
			restored: shown,
		});
	});
});
