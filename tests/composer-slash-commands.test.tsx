// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {SlashCommandMenu} from "../src/components/slash-command-menu";
import {ToastProvider} from "../src/components/toast";
import type {LiveLaunchControls} from "../src/hooks/use-live-launch-options";
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

	it("virtualizes 30+ rows, mounting a window and scrolling the highlighted row into view", () => {
		const many: SlashCommand[] = Array.from({length: 200}, (_, i) => ({
			name: `cmd${String(i).padStart(3, "0")}`,
			description: `Command ${i}`,
			source: "personal-skill",
		}));
		const {textarea} = setup(undefined, many);
		fireEvent.change(textarea, {target: {value: "/"}});
		const scroller = screen.getByRole("menu", {name: "Slash commands"});
		const initial = screen.getAllByRole("menuitem").map((row) => row.textContent);

		for (let i = 0; i < 150; i++) fireEvent.keyDown(textarea, {key: "ArrowDown"});
		const after = screen.getAllByRole("menuitem");
		const active = scroller.querySelector("[data-highlighted]");

		expect({
			initialCount: initial.length,
			initialFirst: initial[0],
			afterWindowed: after.length <= 40,
			active: active?.textContent,
			activeIsDescendant: textarea.getAttribute("aria-activedescendant") === active?.id,
			// Row 150 is 24px tall at 4px gutter + 3600px; "auto" alignment with upstream's 28px scroll padding puts its bottom 28px above a 384px viewport.
			scrollTop: scroller.scrollTop,
		}).toStrictEqual({
			// 16 rows fill the 384px viewport, plus upstream's overscan of 8.
			initialCount: 24,
			initialFirst: "cmd000",
			afterWindowed: true,
			active: "cmd150",
			activeIsDescendant: true,
			scrollTop: 4 + 3600 + 24 - 384 + 28,
		});
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

	describe("section headers and separators", () => {
		const HEADER = "Some commands didn’t load. Type / again to retry.";
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
					className: "px-2 py-1 text-[12px]/[15px] font-medium text-ink-muted",
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
				{className: "mx-2 my-1 h-px bg-border", role: null, text: ""},
				"effort",
			]);
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
			shell: "card-outline-layer flex w-fit min-w-[min(480px,100%)] max-w-full flex-col overflow-clip rounded-r7 select-text",
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

	it("still sends other slash commands as typed", () => {
		const {textarea, onSend} = hostSetup();

		send(textarea, "/effort foo");

		expect({sends: onSend.mock.calls, text: textarea.value}).toStrictEqual({
			sends: [["/effort foo", {}]],
			text: "",
		});
	});
});
