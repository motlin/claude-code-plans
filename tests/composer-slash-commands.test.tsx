// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {Composer, type ComposerRewindState} from "../src/components/composer";
import {SlashCommandMenu} from "../src/components/slash-command-menu";
import {ToastProvider} from "../src/components/toast";
import type {LiveLaunchControls} from "../src/hooks/use-live-launch-options";
import {customizeMcpServersQueryOptions} from "../src/lib/api/customize";
import type {ComposerState} from "../src/lib/composer-state";
import type {SlashCommand} from "../src/lib/slash-commands";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {CompactScope} from "./fizzy-lake-off";

// The deferred chunks these tests render, loaded up front as the page warms them before first use.
beforeAll(async () => {
	await preloadComposerSurfaces();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
});

const COMMANDS: SlashCommand[] = [
	{
		name: "model",
		description: "Set the model for this session",
		source: "builtin",
		argumentHint: "[model]",
	},
	{name: "plan", description: "Switch to plan mode", source: "builtin"},
	{name: "standup", description: "Write my standup", source: "personal-command"},
];

const ALIASED_COMMANDS: SlashCommand[] = [
	...COMMANDS,
	{
		name: "config",
		description: "Open Claude Code settings",
		source: "personal-skill",
		aliases: ["settings"],
	},
	{
		name: "usage",
		description: "Show plan usage",
		source: "personal-skill",
		aliases: ["stats", "cost"],
	},
];

/* `compact` renders inside upstream's pre-rollout compact main column; by default fizzy-lake panels makes it comfortable. */
function setup(onSend = vi.fn<(prompt: string) => void>(), commands = COMMANDS, {compact = false} = {}) {
	render(
		<Composer variant="session" draftKey="session-alice" onSend={onSend} slashCommands={commands} />,
		compact ? {wrapper: CompactScope} : {},
	);
	const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
	return {textarea, onSend};
}

function rows(): {name: string; highlighted: boolean}[] {
	return screen.getAllByRole("menuitem").map((row) => ({
		name: row.textContent,
		highlighted: row.hasAttribute("data-highlighted"),
	}));
}

describe("Composer slash commands", () => {
	it("opens every command with the first row highlighted when the text starts with /", () => {
		const {textarea} = setup();
		const closed = screen.queryByRole("menu", {name: "Slash commands"});

		fireEvent.change(textarea, {target: {value: "/"}});

		expect({closed, rows: rows()}).toStrictEqual({
			closed: null,
			rows: [
				{name: "model", highlighted: true},
				{name: "plan", highlighted: false},
				{name: "standup", highlighted: false},
			],
		});
	});

	it("scrolls the rows in upstream's Menu scroller (bY), scroll-fade-y included", () => {
		const {textarea} = setup();

		fireEvent.change(textarea, {target: {value: "/"}});

		expect(screen.getByRole("menu", {name: "Slash commands"}).className).toStrictEqual(
			"relative min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-y rounded-[inherit] p-1.5",
		);
	});

	it("filters over name and description with bold match spans", () => {
		const {textarea} = setup();

		fireEvent.change(textarea, {target: {value: "/st"}});
		const menu = screen.getByRole("menu", {name: "Slash commands"});
		const bold = [...menu.querySelectorAll(".font-semibold")].map((el) => el.textContent);

		expect({rows: rows(), bold}).toStrictEqual({
			rows: [{name: "standup", highlighted: true}],
			bold: ["st"],
		});
	});

	it("tags only a custom command that collides with a built-in, as a second muted Custom command row", () => {
		const builtinReview: SlashCommand = {name: "review", description: "Review a pull request", source: "builtin"};
		const customReview: SlashCommand = {
			name: "review",
			description: "My own review flow",
			source: "personal-command",
			shadowsHost: true,
		};
		const tabColor: SlashCommand = {name: "tab-color", description: "Color the tab", source: "personal-command"};
		const {textarea, onSend} = setup(undefined, [builtinReview, customReview, tabColor]);

		fireEvent.change(textarea, {target: {value: "/"}});
		const menuRows = rows();
		const subtitles = screen
			.getAllByRole("menuitem")
			.map((row) => row.querySelector(".ms-auto")?.outerHTML ?? null);
		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		const tooltip = screen.getByRole("tooltip").textContent;
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({menuRows, subtitles, tooltip, prompt: textarea.value, sent: onSend.mock.calls}).toStrictEqual({
			menuRows: [
				{name: "review", highlighted: true},
				{name: "reviewCustom command", highlighted: false},
				{name: "tab-color", highlighted: false},
			],
			subtitles: [
				null,
				'<span class="ms-auto shrink-0 ps-2 text-caption text-ink-muted">Custom command</span>',
				null,
			],
			tooltip: "My own review flow",
			prompt: "/review ",
			sent: [],
		});
	});

	it("suffixes the first alias that starts with the query in muted ink, bolding the match", () => {
		const {textarea} = setup(undefined, ALIASED_COMMANDS);

		fireEvent.change(textarea, {target: {value: "/settings"}});
		const config = screen.getAllByRole("menuitem")[0];
		const settingsSuffix = config?.lastElementChild?.outerHTML;
		fireEvent.change(textarea, {target: {value: "/s"}});
		const sRows = rows().map((row) => row.name);
		fireEvent.change(textarea, {target: {value: "/co"}});
		const coRows = rows().map((row) => row.name);

		expect({settingsSuffix, sRows, coRows}).toStrictEqual({
			settingsSuffix:
				'<span class="min-w-0 truncate text-ink-muted">(<span class="font-semibold text-primary">settings</span>)</span>',
			sRows: ["standup", "config(settings)", "usage(stats)", "model", "plan"],
			coRows: ["config", "usage(cost)"],
		});
	});

	it("shows the highlighted row's description as a tooltip with its matches in bold", () => {
		const {textarea} = setup();

		fireEvent.change(textarea, {target: {value: "/mode"}});
		const tooltip = screen.getByRole("tooltip");

		expect({
			rows: rows(),
			tooltip: tooltip.textContent,
			bold: [...tooltip.querySelectorAll(".font-semibold")].map((el) => el.textContent),
		}).toStrictEqual({
			rows: [
				{name: "model", highlighted: true},
				{name: "plan", highlighted: false},
			],
			tooltip: "Set the model for this session",
			bold: ["mode"],
		});
	});

	it("anchors upstream's 13/18 tooltip box 8px past the highlighted row, clamped to the viewport", () => {
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
			const items = [...document.querySelectorAll("[role=menuitem]")];
			const index = items.indexOf(this);
			const rect =
				index === -1
					? {left: 100, top: 300, width: 240, height: 56}
					: {left: 104, top: 304 + index * 24, width: 232, height: 24};
			return {
				...rect,
				x: rect.left,
				y: rect.top,
				right: rect.left + rect.width,
				bottom: rect.top + rect.height,
				toJSON: () => rect,
			};
		});
		const {textarea} = setup();

		fireEvent.change(textarea, {target: {value: "/"}});
		const first = screen.getByRole("tooltip");
		const firstPlacement = {left: first.style.left, top: first.style.top};
		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		const tooltip = screen.getByRole("tooltip");
		const clamp = tooltip.querySelector<HTMLElement>(".line-clamp-\\[10\\]");

		expect({
			firstPlacement,
			placement: {left: tooltip.style.left, top: tooltip.style.top},
			classes: [
				"text-[13px]/[18px]",
				"py-[3px]",
				"min-h-6",
				"rounded-r5",
				"text-balance",
				"shadow-[0_1px_2px_rgb(11_11_11/0.06)]",
				"z-[130]",
				"transition-[opacity,scale]",
				"duration-150",
				"motion-reduce:transition-none",
			].filter((cls) => !tooltip.classList.contains(cls)),
			wrapper: clamp?.parentElement?.className,
			maxWidth: clamp?.style.maxWidth,
			text: tooltip.textContent,
		}).toStrictEqual({
			firstPlacement: {left: "244px", top: "4px"},
			placement: {left: "244px", top: "28px"},
			classes: [],
			wrapper: "min-w-0 break-words",
			// jsdom normalizes `max(9rem, calc(100vw - 344px - 1rem))` into this sum.
			maxWidth: "max(9rem, -344px + 1rem + 100vw)",
			text: "Switch to plan mode",
		});
	});

	it("shows a plugin skill as its bare label, a plugin subtitle while querying, and a plugin detail line", () => {
		const commands: SlashCommand[] = [
			{name: "model", description: "Set the model for this session", source: "builtin"},
			{
				name: "build:dev-server",
				description: "Start a dev server",
				source: "plugin-skill",
				pluginName: "build",
			},
			{name: "build:bare", description: "", source: "plugin-skill", pluginName: "build"},
		];
		const {textarea} = setup(undefined, commands);

		fireEvent.change(textarea, {target: {value: "/build:dev"}});
		const row = screen.getByRole("menuitem");
		const subtitle = row.querySelector(".text-caption");
		const tooltip = screen.getByRole("tooltip").textContent;
		const detailElement = screen.getByRole("tooltip").querySelector("[data-slash-tooltip-detail]");
		const detail = {text: detailElement?.textContent, className: detailElement?.className};
		fireEvent.change(textarea, {target: {value: "/bare"}});
		const bareTooltip = screen.getByRole("tooltip");
		const bare = {
			tooltip: bareTooltip.textContent,
			detail: bareTooltip.querySelector("[data-slash-tooltip-detail]"),
		};
		fireEvent.change(textarea, {target: {value: "/"}});

		expect({
			label: row.firstElementChild?.textContent,
			subtitle: {text: subtitle?.textContent, className: subtitle?.className},
			tooltip,
			detail,
			bare,
			emptyQueryRows: rows(),
		}).toStrictEqual({
			label: "dev-server",
			subtitle: {text: "build", className: "ms-auto shrink-0 ps-2 text-caption text-ink-muted"},
			tooltip: "Start a dev serverbuild plugin",
			detail: {
				text: "build plugin",
				className: "block break-words text-[11px]/[14px] text-[var(--tooltip-description-ink)]",
			},
			bare: {tooltip: "build plugin", detail: null},
			emptyQueryRows: [
				{name: "model", highlighted: true},
				{name: "dev-server", highlighted: false},
				{name: "bare", highlighted: false},
			],
		});
	});

	it("moves the highlight with arrow keys, clamping at both ends", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "/"}});

		fireEvent.keyDown(textarea, {key: "ArrowUp"});
		const top = rows();
		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		const down = rows();
		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		const bottom = rows();
		fireEvent.keyDown(textarea, {key: "ArrowUp"});

		expect({top, down, bottom, up: rows()}).toStrictEqual({
			top: [
				{name: "model", highlighted: true},
				{name: "plan", highlighted: false},
				{name: "standup", highlighted: false},
			],
			down: [
				{name: "model", highlighted: false},
				{name: "plan", highlighted: true},
				{name: "standup", highlighted: false},
			],
			bottom: [
				{name: "model", highlighted: false},
				{name: "plan", highlighted: false},
				{name: "standup", highlighted: true},
			],
			up: [
				{name: "model", highlighted: false},
				{name: "plan", highlighted: true},
				{name: "standup", highlighted: false},
			],
		});
	});

	it("accepts with Enter, inserting the name and showing the argument hint without sending", () => {
		const {textarea, onSend} = setup();
		fireEvent.change(textarea, {target: {value: "/mo"}});

		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			value: textarea.value,
			menu: screen.queryByRole("menu", {name: "Slash commands"}),
			hint: screen.getByTestId("slash-argument-hint").textContent,
			sent: onSend.mock.calls,
		}).toStrictEqual({value: "/model ", menu: null, hint: "[model]", sent: []});
	});

	it("floors the argument-hint overlay like the textarea it lines up with on coarse pointers", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "/mo"}});
		fireEvent.keyDown(textarea, {key: "Enter"});

		const tokens = screen.getByTestId("slash-argument-hint").parentElement?.className.split(" ") ?? [];
		expect({
			floored: tokens.includes("text-entry-floored"),
			coarse: tokens.filter((token) => token.startsWith("pointer-coarse:text-")),
		}).toStrictEqual({floored: true, coarse: []});
	});

	it("sizes the prompt and its overlay from Transcript text size's --prompt-text-size / --prompt-line-height", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "/mo"}});
		fireEvent.keyDown(textarea, {key: "Enter"});
		const sizeTokens = (className: string) =>
			className
				.split(" ")
				.filter((token) => /^(text-\[|leading-|\[--upstream-(text|leading)-body)/.test(token))
				.toSorted();
		const expected = [
			"[--upstream-leading-body:var(--prompt-line-height,20px)]",
			"[--upstream-text-body:var(--prompt-text-size,14px)]",
			"leading-[var(--prompt-line-height,20px)]",
			"text-[length:var(--prompt-text-size,14px)]",
		];

		expect({
			textarea: sizeTokens(textarea.className),
			overlay: sizeTokens(screen.getByTestId("slash-argument-hint").parentElement?.className ?? ""),
		}).toStrictEqual({textarea: expected, overlay: expected});
	});

	it("shows upstream's 'Type to filter' ghost 2px after a bare / and hides it once filtering or dismissed", () => {
		const {textarea} = setup();
		const ghost = (): {text: string; ariaHidden: string | null; className: string} | null => {
			const element = screen.queryByTestId("slash-filter-placeholder");
			return element === null
				? null
				: {
						text: element.textContent,
						ariaHidden: element.parentElement?.getAttribute("aria-hidden") ?? null,
						className: element.className,
					};
		};

		fireEvent.change(textarea, {target: {value: "/"}});
		const bare = ghost();
		const overlay = screen.getByTestId("slash-filter-placeholder").parentElement?.className.split(" ") ?? [];
		fireEvent.change(textarea, {target: {value: "/m"}});
		const filtering = ghost();
		fireEvent.change(textarea, {target: {value: "hello /"}});
		const midLine = ghost();
		fireEvent.change(textarea, {target: {value: "/"}});
		fireEvent.keyDown(textarea, {key: "Escape"});
		const dismissed = ghost();

		expect({
			bare,
			floored:
				overlay.includes("text-entry-floored") &&
				overlay.includes("text-[length:var(--prompt-text-size,14px)]"),
			filtering,
			midLine,
			dismissed,
		}).toStrictEqual({
			bare: {
				text: "Type to filter",
				ariaHidden: "true",
				className: "ml-0.5 text-ink-muted/75 select-none",
			},
			floored: true,
			filtering: null,
			midLine: null,
			dismissed: null,
		});
	});

	it("accepts the highlighted row with Tab and hides the hint once arguments are typed", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "/"}});
		fireEvent.keyDown(textarea, {key: "ArrowDown"});

		fireEvent.keyDown(textarea, {key: "Tab"});
		const accepted = textarea.value;
		fireEvent.change(textarea, {target: {value: "/model opus"}});

		expect({accepted, hint: screen.queryByTestId("slash-argument-hint")}).toStrictEqual({
			accepted: "/plan ",
			hint: null,
		});
	});

	it("accepts a row on click", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "/"}});

		const menu = screen.getByRole("menu", {name: "Slash commands"});
		fireEvent.mouseDown(within(menu).getByRole("menuitem", {name: /plan/}));

		expect(textarea.value).toBe("/plan ");
	});

	it("stays dismissed after Escape while typing, until the prompt is cleared and / retyped", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "/"}});

		fireEvent.keyDown(textarea, {key: "Escape"});
		const afterEscape = screen.queryByRole("menu", {name: "Slash commands"});
		fireEvent.change(textarea, {target: {value: "/m"}});
		const afterTyping = screen.queryByRole("menu", {name: "Slash commands"});
		fireEvent.change(textarea, {target: {value: ""}});
		fireEvent.change(textarea, {target: {value: "/"}});

		expect({afterEscape, afterTyping, reopened: rows()}).toStrictEqual({
			afterEscape: null,
			afterTyping: null,
			reopened: [
				{name: "model", highlighted: true},
				{name: "plan", highlighted: false},
				{name: "standup", highlighted: false},
			],
		});
	});

	it("closes on Escape, Enter then sends, and the next prompt reopens it", () => {
		const {textarea, onSend} = setup();
		fireEvent.change(textarea, {target: {value: "/mo"}});

		fireEvent.keyDown(textarea, {key: "Escape"});
		const afterEscape = screen.queryByRole("menu", {name: "Slash commands"});
		fireEvent.keyDown(textarea, {key: "Enter"});
		const sent = [...onSend.mock.calls];
		fireEvent.change(textarea, {target: {value: "/pl"}});

		expect({
			afterEscape,
			sent,
			reopened: rows(),
		}).toStrictEqual({
			afterEscape: null,
			sent: [["/mo", {}]],
			reopened: [{name: "plan", highlighted: true}],
		});
	});

	it("opens a mid-line slash unselected, with no tooltip or active descendant, until ↓ highlights row 0", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "hello /mo"}});
		const unselected = {
			rows: rows(),
			tooltip: screen.queryByRole("tooltip"),
			activeDescendant: textarea.getAttribute("aria-activedescendant"),
		};

		fireEvent.keyDown(textarea, {key: "ArrowDown"});

		expect({unselected, down: rows(), tooltip: screen.getByRole("tooltip").textContent}).toStrictEqual({
			unselected: {
				rows: [
					{name: "model", highlighted: false},
					{name: "plan", highlighted: false},
				],
				tooltip: null,
				activeDescendant: null,
			},
			down: [
				{name: "model", highlighted: true},
				{name: "plan", highlighted: false},
			],
			tooltip: "Set the model for this session",
		});
	});

	it("moves ↑ from an unselected mid-line menu to the last row", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "hello /mo"}});

		fireEvent.keyDown(textarea, {key: "ArrowUp"});

		expect(rows()).toStrictEqual([
			{name: "model", highlighted: false},
			{name: "plan", highlighted: true},
		]);
	});

	it("closes an unselected mid-line menu on Enter and sends the prompt", () => {
		const {textarea, onSend} = setup();
		fireEvent.change(textarea, {target: {value: "hello /mo"}});

		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			sent: onSend.mock.calls,
			menu: screen.queryByRole("menu", {name: "Slash commands"}),
		}).toStrictEqual({sent: [["hello /mo", {}]], menu: null});
	});

	it("accepting a mid-line row replaces only the /query token", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "hello /mo"}});

		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			value: textarea.value,
			caret: textarea.selectionStart,
			menu: screen.queryByRole("menu", {name: "Slash commands"}),
		}).toStrictEqual({value: "hello /model ", caret: 13, menu: null});
	});

	it("shows no menu for an empty mid-line query", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "hello /"}});

		expect(screen.queryByRole("menu", {name: "Slash commands"})).toBeNull();
	});

	const MANY: SlashCommand[] = Array.from({length: 200}, (_, i) => ({
		name: `cmd${String(i).padStart(3, "0")}`,
		description: `Command ${i}`,
		source: "personal-skill",
	}));

	function virtualizedAfter(compact: boolean) {
		const {textarea} = setup(undefined, MANY, {compact});
		fireEvent.change(textarea, {target: {value: "/"}});
		const scroller = screen.getByRole("menu", {name: "Slash commands"});
		const initial = screen.getAllByRole("menuitem").map((row) => row.textContent);

		for (let i = 0; i < 40; i++) fireEvent.keyDown(textarea, {key: "ArrowDown"});
		const after = screen.getAllByRole("menuitem");
		const active = scroller.querySelector("[data-highlighted]");
		return {
			initialCount: initial.length,
			initialFirst: initial[0],
			afterWindowed: after.length <= 40,
			active: active?.textContent,
			activeIsDescendant: textarea.getAttribute("aria-activedescendant") === active?.id,
			topSpacer: (scroller.firstElementChild as HTMLElement | null)?.style.height,
			firstMounted: after[0]?.textContent,
			scrollTop: scroller.scrollTop,
		};
	}

	it("virtualizes 30+ compact rows, mounting a window and scrolling the highlighted row into view", () => {
		expect(virtualizedAfter(true)).toStrictEqual({
			// 16 rows fill the 384px viewport, plus upstream's overscan of 8.
			initialCount: 24,
			initialFirst: "cmd000",
			afterWindowed: true,
			active: "cmd040",
			activeIsDescendant: true,
			topSpacer: `${18 * 24}px`,
			firstMounted: "cmd018",
			// Row 40 is 24px tall at 4px gutter + 960px; "auto" alignment with upstream's 28px scroll padding puts its bottom 28px above a 384px viewport.
			scrollTop: 4 + 960 + 24 - 384 + 28,
		});
	});

	it("virtualizes comfortable rows at 28px under a 6px gutter", () => {
		expect(virtualizedAfter(false)).toStrictEqual({
			// 14 rows reach the 384px viewport below the 6px gutter, plus upstream's overscan of 8.
			initialCount: 22,
			initialFirst: "cmd000",
			afterWindowed: true,
			active: "cmd040",
			activeIsDescendant: true,
			topSpacer: `${20 * 28}px`,
			firstMounted: "cmd020",
			scrollTop: 6 + 40 * 28 + 28 - 384 + 28,
		});
	});

	it("uses upstream's compact popup, scroller and row metrics inside a compact scope", () => {
		const {textarea} = setup(undefined, COMMANDS, {compact: true});
		fireEvent.change(textarea, {target: {value: "/"}});
		const scroller = screen.getByRole("menu", {name: "Slash commands"});
		const tokens = (element: Element | null | undefined) => element?.className.split(" ").toSorted() ?? [];

		expect({
			popup: tokens(scroller.parentElement),
			scroller: tokens(scroller),
			rows: screen.getAllByRole("menuitem").map((row) => tokens(row)),
		}).toStrictEqual({
			popup: [
				"absolute",
				"bg-[var(--menu-bg)]",
				"bottom-full",
				"flex",
				"flex-col",
				"left-0",
				"max-h-96",
				"max-w-[min(32rem,calc(100vw-16px))]",
				"mb-2",
				"min-w-60",
				"rounded-r7",
				"select-none",
				"shadow-[var(--menu-shadow)]",
				"text-primary",
				"w-max",
				"z-[130]",
			],
			scroller: [
				"min-h-0",
				"overflow-x-hidden",
				"overflow-y-auto",
				"p-1",
				"relative",
				"rounded-[inherit]",
				"scroll-fade-y",
			],
			rows: Array.from({length: 3}, () => [
				"cursor-pointer",
				"data-[highlighted]:bg-fill-ghost-hover",
				"flex",
				"gap-1.5",
				"h-6",
				"items-center",
				"outline-none",
				"px-2",
				"py-[2.5px]",
				"rounded-r5",
				"text-[13px]/[19px]",
				"w-full",
			]),
		});
	});

	it("follows the scope density: comfortable popup, scroller and rows by default under fizzy-lake panels", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "/"}});
		const scroller = screen.getByRole("menu", {name: "Slash commands"});
		const tokens = (element: Element | null | undefined) => element?.className.split(" ").toSorted() ?? [];

		expect({
			popup: tokens(scroller.parentElement).filter((cls) => cls.startsWith("rounded")),
			scroller: tokens(scroller),
			rows: screen.getAllByRole("menuitem").map((row) => tokens(row)),
		}).toStrictEqual({
			popup: ["rounded-menu-comfortable"],
			scroller: [
				"min-h-0",
				"overflow-x-hidden",
				"overflow-y-auto",
				"p-1.5",
				"relative",
				"rounded-[inherit]",
				"scroll-fade-y",
			],
			rows: Array.from({length: 3}, () => [
				"cursor-pointer",
				"data-[highlighted]:bg-fill-ghost-hover",
				"flex",
				"gap-2",
				"h-7",
				"items-center",
				"outline-none",
				"px-2.5",
				"py-1",
				"rounded-r6",
				"text-[14px]/[20px]",
				"w-full",
			]),
		});
	});

	it("draws compact section headers, separators and the loading row inside a compact scope", () => {
		render(
			<SlashCommandMenu
				id="menu"
				items={[{type: "section-header", label: "Header"}, {type: "separator"}, {type: "loading"}]}
				query=""
				highlighted={-1}
				onHighlight={vi.fn<(index: number) => void>()}
				onAccept={vi.fn<(command: SlashCommand) => void>()}
			/>,
			{wrapper: CompactScope},
		);

		expect(
			[...screen.getByRole("menu", {name: "Slash commands"}).children].map((child) => child.className),
		).toStrictEqual([
			"px-2 py-1 text-[12px]/[15px] font-medium text-ink-muted whitespace-pre-line",
			// Upstream's separator dropped its compact:mx-2 variant on 2026-11-01: 10px at every density.
			"mx-2.5 my-1 h-px bg-border",
			"",
		]);
		expect(screen.getByTestId("slash-loading-row").querySelector('[aria-hidden="true"] > div')?.className).toBe(
			"flex h-6 items-center gap-1.5 px-2",
		);
	});

	function headedVirtualScrollTop(label: string): number {
		const many: SlashCommand[] = Array.from({length: 40}, (_, i) => ({
			name: `cmd${String(i).padStart(3, "0")}`,
			description: `Command ${i}`,
			source: "personal-skill",
		}));
		render(
			<SlashCommandMenu
				id="menu"
				items={[
					{type: "section-header", label},
					...many.map((command) => ({type: "command" as const, command})),
				]}
				query=""
				highlighted={40}
				onHighlight={vi.fn<(index: number) => void>()}
				onAccept={vi.fn<(command: SlashCommand) => void>()}
			/>,
			{wrapper: CompactScope},
		);
		const top = screen.getByRole("menu", {name: "Slash commands"}).scrollTop;
		cleanup();
		return top;
	}

	it("reserves 8px plus one 15px line per header line in the virtualized offsets", () => {
		expect({
			twoLine: headedVirtualScrollTop("Some commands didn’t load.\nType / again to retry."),
			oneLine: headedVirtualScrollTop("More commands available once the session is running"),
		}).toStrictEqual({
			// Item 40 (cmd039) ends at the 4px gutter + header + 40 rows of 24px, 28px above the 384px viewport bottom.
			twoLine: 4 + 38 + 40 * 24 - 384 + 28,
			oneLine: 4 + 23 + 40 * 24 - 384 + 28,
		});
	});

	describe("section headers and separators", () => {
		const HEADER = "Some commands didn’t load.\nType / again to retry.";
		const HEADED: SlashCommand[] = [
			{name: "model", description: "Set the model for this session", source: "builtin"},
			{name: "effort", description: "Set the effort level for this session", source: "builtin"},
		];

		function setupHeaded() {
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={vi.fn<(prompt: string) => void>()}
					slashCommands={HEADED}
					slashMenuHeader={HEADER}
				/>,
			);
			return screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		}

		function activeRow(textarea: HTMLTextAreaElement): string | null | undefined {
			const id = textarea.getAttribute("aria-activedescendant");
			return id === null ? null : document.getElementById(id)?.textContent;
		}

		it("draws upstream's section header first as a plain, unfocusable div that the keyboard skips", () => {
			const textarea = setupHeaded();
			fireEvent.change(textarea, {target: {value: "/"}});
			const header = screen.getByRole("menu", {name: "Slash commands"}).firstElementChild;
			const opened = {rows: rows(), active: activeRow(textarea)};
			fireEvent.keyDown(textarea, {key: "ArrowDown"});
			const down = {rows: rows(), active: activeRow(textarea)};
			fireEvent.keyDown(textarea, {key: "ArrowUp"});
			fireEvent.keyDown(textarea, {key: "ArrowUp"});
			const up = {rows: rows(), active: activeRow(textarea)};

			expect({
				header: {
					tag: header?.tagName,
					className: header?.className,
					role: header?.getAttribute("role"),
					tabIndex: header?.getAttribute("tabindex"),
					text: header?.textContent,
				},
				opened,
				down,
				up,
			}).toStrictEqual({
				header: {
					tag: "DIV",
					className: "px-2.5 py-1 text-[13px]/[17px] font-medium text-ink-muted whitespace-pre-line",
					role: null,
					tabIndex: null,
					text: HEADER,
				},
				opened: {
					rows: [
						{name: "model", highlighted: true},
						{name: "effort", highlighted: false},
					],
					active: "model",
				},
				down: {
					rows: [
						{name: "model", highlighted: false},
						{name: "effort", highlighted: true},
					],
					active: "effort",
				},
				up: {
					rows: [
						{name: "model", highlighted: true},
						{name: "effort", highlighted: false},
					],
					active: "model",
				},
			});
		});

		it("drops the section header once a query is typed, as upstream ranks only command rows", () => {
			const textarea = setupHeaded();
			fireEvent.change(textarea, {target: {value: "/"}});
			const menu = () => screen.queryByRole("menu", {name: "Slash commands"});
			const headers = () => menu()?.querySelectorAll(":scope > div:not([role])").length;
			const bare = {headers: headers(), rows: rows()};
			fireEvent.change(textarea, {target: {value: "/mo"}});
			const typed = {headers: headers(), rows: rows()};
			fireEvent.keyDown(textarea, {key: "ArrowDown"});
			const down = activeRow(textarea);
			fireEvent.change(textarea, {target: {value: "/zzzz"}});

			expect({bare, typed, down, noMatch: menu()}).toStrictEqual({
				bare: {
					headers: 1,
					rows: [
						{name: "model", highlighted: true},
						{name: "effort", highlighted: false},
					],
				},
				typed: {headers: 0, rows: [{name: "model", highlighted: true}]},
				down: "model",
				noMatch: null,
			});
		});

		it("never lands an unselected mid-line menu on the header", () => {
			const textarea = setupHeaded();
			fireEvent.change(textarea, {target: {value: "hi /set"}});
			const unselected = activeRow(textarea);
			fireEvent.keyDown(textarea, {key: "ArrowDown"});
			const down = activeRow(textarea);
			fireEvent.change(textarea, {target: {value: "hi /se"}});
			fireEvent.keyDown(textarea, {key: "ArrowUp"});

			expect({unselected, down, up: activeRow(textarea)}).toStrictEqual({
				unselected: null,
				down: "model",
				up: "effort",
			});
		});

		it("draws a separator item as upstream's 1px hairline between rows", () => {
			render(
				<SlashCommandMenu
					id="menu"
					items={[
						{type: "command", command: HEADED[0]!},
						{type: "separator"},
						{type: "command", command: HEADED[1]!},
					]}
					query=""
					highlighted={0}
					onHighlight={vi.fn<(index: number) => void>()}
					onAccept={vi.fn<(command: SlashCommand) => void>()}
				/>,
			);
			const children = [...screen.getByRole("menu", {name: "Slash commands"}).children].map((child) => ({
				className: child.className,
				role: child.getAttribute("role"),
				text: child.textContent,
			}));

			expect(children.map((child) => (child.role === "menuitem" ? child.text : child))).toStrictEqual([
				"model",
				{className: "mx-2.5 my-1 h-px bg-border", role: null, text: ""},
				"effort",
			]);
		});
	});

	describe("Add > Slash commands", () => {
		const CHIN: ComposerState = {
			mode: {id: "default", label: "Manual"},
			model: "Opus 5.5",
			modelId: "claude-opus-5-5",
			settingsModelId: "claude-opus-5-5",
			fastMode: false,
			fastModeBlocked: null,
			effort: {id: "high", label: "High"},
			usage: null,
		};

		function setupWithChin() {
			const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
			queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, []);
			render(
				<QueryClientProvider client={queryClient}>
					<Composer
						variant="session"
						draftKey="session-alice"
						onSend={() => {}}
						slashCommands={COMMANDS}
						chin={CHIN}
					/>
				</QueryClientProvider>,
			);
			return screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		}

		async function pickSlashCommands() {
			fireEvent.click(screen.getByRole("button", {name: "Add"}));
			const menu = await screen.findByRole("menu");
			fireEvent.click(within(menu).getByRole("menuitem", {name: "Slash commands"}));
			await waitFor(() => {
				expect(screen.queryByRole("menuitem", {name: "Slash commands"})).toBeNull();
			});
		}

		it("prepends / to existing text and leaves the caret right after it", async () => {
			const textarea = setupWithChin();
			fireEvent.change(textarea, {target: {value: "hello world"}});
			textarea.setSelectionRange(11, 11);

			await pickSlashCommands();

			expect({
				value: textarea.value,
				selection: [textarea.selectionStart, textarea.selectionEnd],
				focused: document.activeElement === textarea,
			}).toStrictEqual({value: "/hello world", selection: [1, 1], focused: true});
		});

		it("inserts / into an empty prompt and opens the slash menu", async () => {
			const textarea = setupWithChin();

			await pickSlashCommands();

			expect({
				value: textarea.value,
				selection: [textarea.selectionStart, textarea.selectionEnd],
				rows: rows(),
			}).toStrictEqual({
				value: "/",
				selection: [1, 1],
				rows: [
					{name: "model", highlighted: true},
					{name: "plan", highlighted: false},
					{name: "standup", highlighted: false},
				],
			});
		});
	});
});

describe("Composer host commands", () => {
	const CHIN: ComposerState = {
		mode: {id: "default", label: "Manual"},
		model: "Opus 5.5",
		modelId: "claude-opus-5-5",
		settingsModelId: "claude-opus-5-5",
		fastMode: false,
		fastModeBlocked: null,
		effort: {id: "high", label: "High"},
		usage: null,
	};

	function hostSetup(extra: {chin?: ComposerState | undefined; live?: LiveLaunchControls} = {chin: CHIN}) {
		const onSend = vi.fn<(prompt: string) => void>();
		render(
			<ToastProvider>
				<Composer variant="session" draftKey="session-alice" onSend={onSend} {...extra} />
			</ToastProvider>,
		);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		return {textarea, onSend};
	}

	function send(textarea: HTMLTextAreaElement, text: string) {
		fireEvent.change(textarea, {target: {value: text}});
		fireEvent.keyDown(textarea, {key: "Enter"});
	}

	const toastText = () => document.querySelector("[data-toast-message]")?.textContent;
	const modelTrigger = () => document.querySelector("[data-cds=ModelSelector]");

	it("opens the Model menu for a bare /model and empties the composer", async () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/model");
		await screen.findByRole("menu");

		expect({
			sends: onSend.mock.calls,
			text: textarea.value,
			expanded: modelTrigger()?.getAttribute("aria-expanded"),
			menus: screen.getAllByRole("menu").length,
		}).toStrictEqual({sends: [], text: "", expanded: "true", menus: 1});
	});

	it("opens the Model menu on its Effort submenu for a bare /effort", async () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/effort");
		await waitFor(() => {
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});

		expect({
			sends: onSend.mock.calls,
			text: textarea.value,
			expanded: modelTrigger()?.getAttribute("aria-expanded"),
		}).toStrictEqual({sends: [], text: "", expanded: "true"});
	});

	it("opens the Mode menu for /permissions and /allowed-tools", async () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/allowed-tools");
		await screen.findByRole("menu");

		expect({
			sends: onSend.mock.calls,
			text: textarea.value,
			expanded: document.querySelector("[data-chin-mode]")?.getAttribute("aria-expanded"),
		}).toStrictEqual({sends: [], text: "", expanded: "true"});
	});

	it("applies /effort low to the chin without sending", () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/effort low");

		expect({
			sends: onSend.mock.calls,
			text: textarea.value,
			label: modelTrigger()?.getAttribute("aria-label"),
		}).toStrictEqual({sends: [], text: "", label: "Model: Opus 5.5 Low"});
	});

	it("applies /model fable to the chin without sending", () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/model fable");

		expect({
			sends: onSend.mock.calls,
			text: textarea.value,
			label: modelTrigger()?.getAttribute("aria-label"),
		}).toStrictEqual({sends: [], text: "", label: "Model: Fable 5.1 High"});
	});

	it("applies /model default to the chin as the CLI's default model without sending", () => {
		const {textarea, onSend} = hostSetup({chin: {...CHIN, model: "Fable 5.1", modelId: "claude-fable-5-1"}});

		send(textarea, "/model default");

		expect({
			sends: onSend.mock.calls,
			text: textarea.value,
			label: modelTrigger()?.getAttribute("aria-label"),
		}).toStrictEqual({sends: [], text: "", label: "Model: Opus 5.5 High"});
	});

	const HAIKU_CHIN: ComposerState = {...CHIN, model: "Haiku 4.5", modelId: "claude-haiku-4-5-20251001"};

	it("sends /effort to the CLI when the chin model has no effort levels", () => {
		const {textarea, onSend} = hostSetup({chin: HAIKU_CHIN});

		send(textarea, "/effort");

		expect({sends: onSend.mock.calls, menus: screen.queryAllByRole("menu").length}).toStrictEqual({
			sends: [["/effort", {}]],
			menus: 0,
		});
	});

	it("hides the Effort submenu when the chin model has no effort levels", async () => {
		const {textarea} = hostSetup({chin: HAIKU_CHIN});

		send(textarea, "/model");
		const menu = await screen.findByRole("menu");

		expect({
			expanded: modelTrigger()?.getAttribute("aria-expanded"),
			effort: within(menu).queryByRole("menuitem", {name: /^Effort/}),
		}).toStrictEqual({expanded: "true", effort: null});
	});

	it("asks Change effort? for /effort low on a live pane, like a menu pick", async () => {
		const apply = vi.fn<LiveLaunchControls["apply"]>(async () => {});
		const {textarea, onSend} = hostSetup({chin: CHIN, live: {options: {}, apply}});

		send(textarea, "/effort low");
		const confirm = await screen.findByRole("alertdialog");

		expect({
			sends: onSend.mock.calls,
			applied: apply.mock.calls,
			text: textarea.value,
			title: within(confirm).getByRole("heading").textContent,
		}).toStrictEqual({sends: [], applied: [], text: "", title: "Change effort?"});
	});

	it("toasts an unknown /model word and keeps the text", async () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/model gpt5");

		await waitFor(() => {
			expect(toastText()).toBe("“gpt5” isn’t an available model.");
		});
		expect({sends: onSend.mock.calls, text: textarea.value}).toStrictEqual({sends: [], text: "/model gpt5"});
	});

	const bandCard = () => document.querySelector("[data-composer-command-error]");
	const bandAlert = () => bandCard()?.querySelector("[role=alert]")?.textContent;
	const ARGS_BODY =
		"/permissions doesn’t take arguments here. Remove the text after the command, then send it again.";

	it("shows the literal error card for /permissions plan and keeps the text", () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/permissions plan");
		const card = bandCard();
		const shell = card?.firstElementChild;

		expect({
			sends: onSend.mock.calls,
			text: textarea.value,
			slot: card?.className,
			shell: shell?.className,
			alert: bandAlert(),
			headline: shell?.children[1]?.querySelector(".grow")?.textContent,
			hint: shell?.children[2]?.textContent,
			dismiss: card?.querySelector("button")?.getAttribute("aria-label"),
			focused: document.activeElement === textarea,
		}).toStrictEqual({
			sends: [],
			text: "/permissions plan",
			slot: "mb-1.5",
			shell: "card-outline-layer flex w-fit min-w-[min(480px,100%)] max-w-full flex-col overflow-clip rounded-card select-text",
			alert: `Couldn’t complete that ${ARGS_BODY}`,
			headline: "Couldn’t complete that",
			hint: ARGS_BODY,
			dismiss: "Dismiss",
			focused: true,
		});
	});

	it("shows the extra-lines body for a multi-line /permissions", () => {
		const {textarea} = hostSetup();

		send(textarea, "/permissions\nmore");

		expect(bandCard()?.firstElementChild?.children[2]?.textContent).toBe(
			"/permissions only works on a single line. Remove the extra lines, then send it again.",
		);
	});

	it("keeps the literal error card while typing", () => {
		const {textarea} = hostSetup();

		send(textarea, "/permissions plan");
		fireEvent.change(textarea, {target: {value: "/permissions"}});

		expect({text: textarea.value, alert: bandAlert()}).toStrictEqual({
			text: "/permissions",
			alert: `Couldn’t complete that ${ARGS_BODY}`,
		});
	});

	it("closes the literal error card on Dismiss and keeps the text", () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/permissions plan");
		const dismiss = bandCard()?.querySelector("button");
		if (!dismiss) throw new Error("no Dismiss button");
		fireEvent.click(dismiss);

		expect({card: bandCard(), text: textarea.value, sends: onSend.mock.calls}).toStrictEqual({
			card: null,
			text: "/permissions plan",
			sends: [],
		});
	});

	it("clears the literal error card on the next submit", () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/permissions plan");
		send(textarea, "hello");

		expect({card: bandCard(), sends: onSend.mock.calls}).toStrictEqual({
			card: null,
			sends: [["hello", {}]],
		});
	});

	it("replaces the literal error card when the next submit is refused too", () => {
		const {textarea} = hostSetup();

		send(textarea, "/permissions plan");
		send(textarea, "/allowed-tools\nx");

		expect({
			cards: document.querySelectorAll("[data-composer-command-error]").length,
			alert: bandAlert(),
		}).toStrictEqual({
			cards: 1,
			alert: "Couldn’t complete that /allowed-tools only works on a single line. Remove the extra lines, then send it again.",
		});
	});

	it("toasts /model when the composer has no chin and keeps the text", async () => {
		const {textarea, onSend} = hostSetup({chin: undefined});

		send(textarea, "/model");

		await waitFor(() => {
			expect(toastText()).toBe("Model can’t be changed for this session right now.");
		});
		expect({sends: onSend.mock.calls, text: textarea.value}).toStrictEqual({sends: [], text: "/model"});
	});

	it("toggles fast mode for a bare /fast without sending", () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/fast");

		expect({
			sends: onSend.mock.calls,
			text: textarea.value,
			label: modelTrigger()?.getAttribute("aria-label"),
		}).toStrictEqual({sends: [], text: "", label: "Model: Opus 5.5 Fast High"});
	});

	it("applies /fast on to a live pane", () => {
		const apply = vi.fn<LiveLaunchControls["apply"]>(async () => {});
		const {textarea, onSend} = hostSetup({chin: CHIN, live: {options: {}, apply}});

		send(textarea, "/fast on");

		expect({sends: onSend.mock.calls, applied: apply.mock.calls, text: textarea.value}).toStrictEqual({
			sends: [],
			applied: [[{fastMode: true}]],
			text: "",
		});
	});

	it.each([
		[false, "/fast off", "Fast mode is already off."],
		[true, "/fast on", "Fast mode is already on."],
	])("with fast %s, %j toasts %j without sending", async (fastMode, text, message) => {
		const {textarea, onSend} = hostSetup({chin: {...CHIN, fastMode}});

		send(textarea, text);

		await waitFor(() => {
			expect(toastText()).toBe(message);
		});
		expect({
			sends: onSend.mock.calls,
			text: textarea.value,
			label: modelTrigger()?.getAttribute("aria-label"),
		}).toStrictEqual({sends: [], text: "", label: fastMode ? "Model: Opus 5.5 Fast High" : "Model: Opus 5.5 High"});
	});

	it.each([
		["an unknown argument", CHIN, "/fast turbo"],
		["a model without fast mode", {...CHIN, model: "Sonnet 5", modelId: "claude-sonnet-5"}, "/fast"],
		["no chin", undefined, "/fast on"],
		[
			"a session the CLI blocks from fast mode",
			{...CHIN, fastModeBlocked: {line: "Not available with this provider"}},
			"/fast on",
		],
	])("sends /fast as typed with %s", (_, chin, text) => {
		const {textarea, onSend} = hostSetup({chin});

		send(textarea, text);

		expect({sends: onSend.mock.calls, text: textarea.value}).toStrictEqual({sends: [[text, {}]], text: ""});
	});

	it("still sends other slash commands as typed", () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/effort foo");

		expect({sends: onSend.mock.calls, text: textarea.value}).toStrictEqual({
			sends: [["/effort foo", {}]],
			text: "",
		});
	});

	function rewindSetup(state: ComposerRewindState = "ready") {
		const onSend = vi.fn<(prompt: string) => void>();
		const onRewind = vi.fn<() => void>();
		render(
			<ToastProvider>
				<Composer variant="session" draftKey="session-alice" onSend={onSend} rewind={{state, open: onRewind}} />
			</ToastProvider>,
		);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		return {textarea, onSend, onRewind};
	}

	const toastIcon = () => document.querySelector("[data-toast-icon]")?.getAttribute("data-toast-icon");

	it("opens the Rewind picker for /rewind and clears the composer instead of sending", () => {
		const {textarea, onSend, onRewind} = rewindSetup();

		send(textarea, "/rewind");

		expect({sends: onSend.mock.calls, rewinds: onRewind.mock.calls.length, text: textarea.value}).toStrictEqual({
			sends: [],
			rewinds: 1,
			text: "",
		});
	});

	it("ignores /rewind while the session is busy, keeping it in the composer, as upstream's gate", () => {
		const {textarea, onSend, onRewind} = rewindSetup("busy");

		send(textarea, "/rewind");

		expect({
			sends: onSend.mock.calls,
			rewinds: onRewind.mock.calls.length,
			text: textarea.value,
			toast: toastText(),
		}).toStrictEqual({sends: [], rewinds: 0, text: "/rewind", toast: undefined});
	});

	it("warns that the computer is offline for /rewind without a writable live pane", () => {
		const {textarea, onSend, onRewind} = rewindSetup("offline");

		send(textarea, "/rewind");

		expect({
			sends: onSend.mock.calls,
			rewinds: onRewind.mock.calls.length,
			text: textarea.value,
			toast: toastText(),
			icon: toastIcon(),
		}).toStrictEqual({
			sends: [],
			rewinds: 0,
			text: "/rewind",
			toast: "Rewind is unavailable while the computer running this session is offline.",
			icon: "warning",
		});
	});

	it("errors that rewind isn't available for /rewind on a session that can't rewind", () => {
		const {textarea, onSend, onRewind} = rewindSetup("unsupported");

		send(textarea, "/rewind");

		expect({
			sends: onSend.mock.calls,
			rewinds: onRewind.mock.calls.length,
			text: textarea.value,
			toast: toastText(),
			icon: toastIcon(),
		}).toStrictEqual({
			sends: [],
			rewinds: 0,
			text: "/rewind",
			toast: "Rewind isn’t available for this session.",
			icon: "danger",
		});
	});

	it.each(["ready", "busy", "offline", "unsupported"] as const)(
		"refuses /rewind with arguments with upstream's noArgs band (%s)",
		(state) => {
			const {textarea, onSend, onRewind} = rewindSetup(state);

			send(textarea, "/rewind 3");

			expect({
				sends: onSend.mock.calls,
				rewinds: onRewind.mock.calls.length,
				text: textarea.value,
				toast: toastText(),
				hint: bandCard()?.firstElementChild?.children[2]?.textContent,
			}).toStrictEqual({
				sends: [],
				rewinds: 0,
				text: "/rewind 3",
				toast: undefined,
				hint: "/rewind doesn’t take arguments here. Remove the text after the command, then send it again.",
			});
		},
	);

	it("sends /rewind to the CLI as typed from a composer with no rewind wiring", () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/rewind");

		expect(onSend.mock.calls).toStrictEqual([["/rewind", {}]]);
	});
});
