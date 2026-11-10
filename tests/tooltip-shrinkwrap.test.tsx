// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactElement} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {MarkdownArticle} from "../src/components/markdown-article";
import {SlashCommandMenu} from "../src/components/slash-command-menu";
import {Tooltip} from "../src/components/ui/tooltip";
import type {FileRef} from "../src/lib/file-refs";
import type {SlashCommand} from "../src/lib/slash-commands";

/** What the mocked engine writes (null: the popup is already tight), and the order fits and placements ran in. */
const engine = vi.hoisted(() => ({
	width: 200 as number | null,
	events: [] as string[],
	options: [] as unknown[],
}));

vi.mock("../src/lib/shrinkwrap", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/lib/shrinkwrap")>();
	return {
		...actual,
		attachShrinkwrap: (el: HTMLElement, options: unknown) => {
			engine.events.push("fit");
			engine.options.push(options);
			const own = el.style.maxWidth;
			if (engine.width !== null) el.style.maxWidth = `${engine.width}px`;
			return () => {
				el.style.maxWidth = own;
			};
		},
	};
});

vi.mock("../src/components/ui/tooltip-placement", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/components/ui/tooltip-placement")>();
	return {
		...actual,
		placeTooltip: (...args: Parameters<typeof actual.placeTooltip>) => {
			engine.events.push("place");
			return actual.placeTooltip(...args);
		},
	};
});

beforeEach(() => {
	engine.width = 200;
	engine.events = [];
	engine.options = [];
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function hoverOpen(): HTMLElement {
	fireEvent.pointerEnter(screen.getByRole("button"), {pointerType: "mouse"});
	act(() => {
		vi.advanceTimersByTime(300);
	});
	return screen.getByRole("tooltip");
}

function tipWidth(tooltip: ReactElement): string {
	vi.useFakeTimers();
	render(tooltip);
	const width = hoverOpen().style.maxWidth;
	cleanup();
	return width;
}

describe("<Tooltip> shrinkwrap (upstream Ac: an({immediate: true}) on the popup)", () => {
	it("fits every variant's popup immediately", () => {
		const button = <button type="button">Go</button>;
		expect({
			plain: tipWidth(<Tooltip content="Copy">{button}</Tooltip>),
			reason: tipWidth(
				<Tooltip content="Not available here" variant="reason">
					{button}
				</Tooltip>,
			),
			multiline: tipWidth(
				<Tooltip content={"one\ntwo"} multiline>
					{button}
				</Tooltip>,
			),
			description: tipWidth(
				<Tooltip content="Hide sidebar" description="Drag to resize">
					{button}
				</Tooltip>,
			),
			stackedDetail: tipWidth(
				<Tooltip content="Next step" detail="Asked a question" stacked>
					{button}
				</Tooltip>,
			),
			secondary: tipWidth(
				<Tooltip content="Send" shortcut="⏎" secondary={{content: "Queue for later", shortcut: "⌘⏎"}}>
					{button}
				</Tooltip>,
			),
			options: engine.options,
		}).toStrictEqual({
			plain: "200px",
			reason: "200px",
			multiline: "200px",
			description: "200px",
			stackedDetail: "200px",
			secondary: "200px",
			options: Array.from({length: 6}, () => ({immediate: true, remember: true})),
		});
	});

	it("places the popup after it is fitted", () => {
		vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(120);
		vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
		vi.useFakeTimers();
		render(
			<Tooltip content="Copy">
				<button type="button">Go</button>
			</Tooltip>,
		);
		hoverOpen();
		expect(engine.events.slice(0, 2)).toStrictEqual(["fit", "place"]);
	});

	it("writes no inline max-width when the popup is already tight", () => {
		engine.width = null;
		vi.useFakeTimers();
		render(
			<Tooltip content="Copy">
				<button type="button">Go</button>
			</Tooltip>,
		);
		expect(hoverOpen().getAttribute("style")).toBeNull();
	});

	it("refits on every open", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="Copy">
				<button type="button">Go</button>
			</Tooltip>,
		);
		hoverOpen();
		fireEvent.pointerLeave(screen.getByRole("button").parentElement!);
		const closed = screen.queryByRole("tooltip");
		hoverOpen();
		expect({closed, fits: engine.events.filter((event) => event === "fit").length}).toStrictEqual({
			closed: null,
			fits: 2,
		});
	});
});

describe("hand-rolled tooltip popups shrinkwrap", () => {
	it("fits the slash menu's active row tooltip", () => {
		engine.width = 150;
		const command: SlashCommand = {name: "plan", description: "Switch to plan mode", source: "builtin"};
		render(
			<SlashCommandMenu
				id="menu"
				items={[{type: "command", command}]}
				query=""
				highlighted={0}
				onHighlight={vi.fn<(index: number) => void>()}
				onAccept={vi.fn<(command: SlashCommand) => void>()}
			/>,
		);
		expect({width: screen.getByRole("tooltip").style.maxWidth, options: engine.options}).toStrictEqual({
			width: "150px",
			options: [{immediate: true, remember: true}],
		});
	});

	it("fits the markdown article's disabled-reason tooltip", () => {
		engine.width = 150;
		const {container} = render(
			<MarkdownArticle
				html='<p><span tabindex="0" data-cds-disabled-reason-wrapper=""><code>/tmp/x</code><span hidden="" data-cds-disabled-reason="">Outside this session’s folders</span></span></p>'
				onFileRef={vi.fn<(ref: FileRef) => void>()}
			/>,
		);
		act(() => {
			container.querySelector<HTMLElement>("[data-cds-disabled-reason-wrapper]")!.focus();
		});
		const tooltip = screen.getByRole("tooltip");
		expect({text: tooltip.textContent, width: tooltip.style.maxWidth}).toStrictEqual({
			text: "Outside this session’s folders",
			width: "150px",
		});
	});
});
