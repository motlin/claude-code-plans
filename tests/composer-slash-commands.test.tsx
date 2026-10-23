// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {customizeMcpServersQueryOptions} from "../src/lib/api/customize";
import type {ComposerState} from "../src/lib/composer-state";
import type {SlashCommand} from "../src/lib/slash-commands";

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

function setup(onSend = vi.fn<(prompt: string) => void>(), commands = COMMANDS) {
	render(<Composer variant="session" draftKey="session-alice" onSend={onSend} slashCommands={commands} />);
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
	it("opens the built-in list with the first row highlighted when the text starts with /", () => {
		const {textarea} = setup();
		const closed = screen.queryByRole("menu", {name: "Slash commands"});

		fireEvent.change(textarea, {target: {value: "/"}});

		expect({closed, rows: rows()}).toStrictEqual({
			closed: null,
			rows: [
				{name: "model", highlighted: true},
				{name: "plan", highlighted: false},
			],
		});
	});

	it("filters over name and description with bold match spans and tags custom commands", () => {
		const {textarea} = setup();

		fireEvent.change(textarea, {target: {value: "/st"}});
		const menu = screen.getByRole("menu", {name: "Slash commands"});
		const bold = [...menu.querySelectorAll(".font-semibold")].map((el) => el.textContent);

		expect({rows: rows(), bold}).toStrictEqual({
			rows: [{name: "standupCustom command", highlighted: true}],
			bold: ["st"],
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
			sRows: ["standupCustom command", "config(settings)", "usage(stats)", "model", "plan"],
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

	it("moves the highlight with arrow keys, clamping at both ends", () => {
		const {textarea} = setup();
		fireEvent.change(textarea, {target: {value: "/"}});

		fireEvent.keyDown(textarea, {key: "ArrowUp"});
		const top = rows();
		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		const down = rows();
		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		const bottom = rows();
		fireEvent.keyDown(textarea, {key: "ArrowUp"});

		expect({top, down, bottom, up: rows()}).toStrictEqual({
			top: [
				{name: "model", highlighted: true},
				{name: "plan", highlighted: false},
			],
			down: [
				{name: "model", highlighted: false},
				{name: "plan", highlighted: true},
			],
			bottom: [
				{name: "model", highlighted: false},
				{name: "plan", highlighted: true},
			],
			up: [
				{name: "model", highlighted: true},
				{name: "plan", highlighted: false},
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
			coarse: tokens.filter((token) => token.startsWith("pointer-coarse:")),
		}).toStrictEqual({floored: true, coarse: []});
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
			floored: overlay.includes("text-entry-floored") && overlay.includes("text-[14px]/[20px]"),
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

	it("uses upstream's compact popup, scroller and row metrics", () => {
		const {textarea} = setup();
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
			scroller: ["min-h-0", "overflow-x-hidden", "overflow-y-auto", "p-1", "rounded-[inherit]"],
			rows: Array.from({length: 2}, () => [
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

	describe("Add > Slash commands", () => {
		const CHIN: ComposerState = {
			mode: {id: "default", label: "Manual"},
			model: "Opus 5.5",
			modelId: "claude-opus-5-5",
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
				],
			});
		});
	});
});
