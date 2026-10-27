// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsDialog} from "../src/components/settings/settings-dialog";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToolbarSearch} from "../src/components/toolbar-search";
import {ThemeProvider} from "../src/components/theme-provider";
import {SettingsTabSchema} from "../src/lib/settings-hash";
import {SETTINGS_INDEX} from "../src/lib/settings-search";
import {installLocalStorage} from "./fake-storage";

const APPLICATION_SETTINGS = {
	terminalWritesEnabled: false,
	terminalHost: "auto",
	shellPaneEnabled: false,
	visibleNavSections: [],
	ignoredDirs: ["node_modules"],
};

function stubBrowser() {
	installLocalStorage();
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	}));
	vi.stubGlobal("fetch", async (input: string) =>
		input.endsWith("/api/application-settings")
			? Promise.resolve(
					new Response(JSON.stringify(APPLICATION_SETTINGS), {
						headers: {"Content-Type": "application/json"},
					}),
				)
			: new Promise(() => {}),
	);
}

function buildRouter(initialEntry: string) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ThemeProvider>
					<SettingsProvider>
						<Outlet />
						<ToolbarSearch label="Search page" placeholder="Search" search="" onSearch={() => {}} />
						<SettingsDialog />
					</SettingsProvider>
				</ThemeProvider>
			</QueryClientProvider>
		),
	});
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <div>Page</div>,
	});
	return createRouter({
		routeTree: rootRoute.addChildren([indexRoute]),
		history: createMemoryHistory({initialEntries: [initialEntry]}),
	});
}

async function renderAt(initialEntry: string) {
	const router = buildRouter(initialEntry);
	await router.load();
	render(<RouterProvider router={router} />);
	return router;
}

/** Every titled row rendered in the open tab, as [slug, title]. */
function renderedRows(dialog: HTMLElement): Array<[string, string]> {
	return [...dialog.querySelectorAll<HTMLElement>("[data-settings-row][aria-labelledby]")].map((row) => {
		const titleId = row.getAttribute("aria-labelledby") ?? "";
		return [row.dataset["settingsRow"] ?? "", row.querySelector(`[id="${titleId}"]`)?.textContent ?? ""];
	});
}

/** Each upstream-flashed row's slug and whether its title carries the wavy underline. */
function flashingRows(): {row: string; title: boolean}[] {
	return [...document.querySelectorAll<HTMLElement>(".feature-anchor-row-fill")].map((row) => ({
		row: row.dataset["settingsRow"] ?? "",
		title: row.querySelector(".settings-row-title")?.classList.contains("feature-anchor-highlight") ?? false,
	}));
}

describe("settings search", () => {
	let scrolled: string[];
	let highlightScrolls: Array<{row: string; options: unknown}>;

	beforeEach(() => {
		stubBrowser();
		scrolled = [];
		highlightScrolls = [];
		Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown) {
			if (this.hasAttribute("data-highlighted")) {
				highlightScrolls.push({row: this.getAttribute("aria-label") ?? `hit: ${this.textContent}`, options});
				return;
			}
			scrolled.push(this.getAttribute("data-settings-row") ?? this.tagName);
		};
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		Reflect.deleteProperty(Element.prototype, "scrollIntoView");
	});

	it.each(SettingsTabSchema.options)("indexes exactly the rows the %s tab renders", async (tab) => {
		await renderAt(`/#settings/${tab}`);
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const expected = SETTINGS_INDEX.filter((entry) => entry.tab === tab).map((entry): [string, string] => [
			entry.rowSlug,
			entry.title,
		]);

		await waitFor(() => {
			expect(renderedRows(dialog)).toStrictEqual(expected);
		});
	});

	it.each(SettingsTabSchema.options)("ids every %s row as setting-<tab>-<slug>", async (tab) => {
		await renderAt(`/#settings/${tab}`);
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const expected = SETTINGS_INDEX.filter((entry) => entry.tab === tab).map((entry) => ({
			id: `setting-${tab}-${entry.rowSlug}`,
			item: "",
		}));

		await waitFor(() => {
			expect(
				[...dialog.querySelectorAll<HTMLElement>("[data-settings-row][aria-labelledby]")].map((row) => ({
					id: row.id,
					item: row.getAttribute("data-settings-item"),
				})),
			).toStrictEqual(expected);
		});
	});

	it("deep links scroll at once, flash the row from 300ms for 1.95s, and collapse the hash", async () => {
		const router = buildRouter("/#settings/claude-code/code-font");
		await router.load();
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
		act(() => {
			render(<RouterProvider router={router} />);
		});

		expect({hash: router.state.location.hash, flashing: flashingRows(), scrolled}).toStrictEqual({
			hash: "settings/claude-code",
			flashing: [],
			scrolled: ["code-font"],
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(299);
		});
		expect(flashingRows()).toStrictEqual([]);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(flashingRows()).toStrictEqual([{row: "code-font", title: true}]);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1949);
		});
		expect(flashingRows()).toStrictEqual([{row: "code-font", title: true}]);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect({flashing: flashingRows(), scrolled}).toStrictEqual({flashing: [], scrolled: ["code-font"]});
	});

	/** Each popover row's accessible name, or for hits (no aria-label) their visible text. */
	function popoverRows(popover: HTMLElement): string[] {
		return within(popover)
			.getAllByRole("button")
			.map((button) => button.getAttribute("aria-label") ?? `hit: ${button.textContent}`);
	}

	it("shows section hits with child rows and deep links to the selected child", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});

		fireEvent.change(screen.getByRole("combobox", {name: "Search settings"}), {
			target: {value: "view"},
		});

		const popover = await screen.findByRole("dialog", {name: "Search results"});
		expect(popoverRows(popover)).toStrictEqual([
			"hit: Claude CodeDefault transcript view",
			"hit: Sessions",
			"Default view in Sessions",
			"Offer to review uncommitted changes in Sessions",
			"hit: AI features",
			"Working-copy review in AI features",
			"Review behavior in AI features",
		]);
		expect([...popover.querySelectorAll(".text-upstream-accent")].map((match) => match.textContent)).toStrictEqual([
			"view",
			"view",
			"view",
			"view",
			"view",
		]);

		fireEvent.click(within(popover).getByRole("button", {name: "Default view in Sessions"}));

		await waitFor(() => {
			expect(router.state.location.hash).toBe("settings/sessions");
		});
		expect(scrolled).toStrictEqual(["default-view"]);
		await waitFor(() => {
			expect(flashingRows()).toStrictEqual([{row: "default-view", title: true}]);
		});
		expect(screen.queryByRole("dialog", {name: "Search results"})).toBeNull();
	});

	it("renders a section hit as the tab icon, the highlighted name and an optional via line", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});

		fireEvent.change(screen.getByRole("combobox", {name: "Search settings"}), {
			target: {value: "theme"},
		});

		const popover = await screen.findByRole("dialog", {name: "Search results"});
		const [hit] = within(popover).getAllByRole("button");
		const lines = hit.firstElementChild?.children ?? [];
		expect({
			rows: popoverRows(popover),
			icon: lines[0]?.firstElementChild?.tagName.toLowerCase(),
			iconClass: lines[0]?.firstElementChild?.getAttribute("class"),
			name: lines[0]?.textContent,
			via: shape(lines[1]),
		}).toStrictEqual({
			rows: ["hit: GeneralTheme"],
			icon: "svg",
			iconClass: `lucide lucide-settings ${ICON}`,
			name: "General",
			via: {
				tag: "span",
				className: "truncate ps-[32px] text-footnote text-[var(--settings-muted)]",
				children: [accent("Theme")],
			},
		});
	});

	/** An element's tag, classes and children (text for leaves), for anatomy comparisons. */
	type Shape = {tag: string; className: string; children: Array<Shape | string>};
	function shape(element: Element): Shape {
		return {
			tag: element.tagName.toLowerCase(),
			className: element.getAttribute("class") ?? "",
			children: [...element.childNodes].flatMap((node): Array<Shape | string> => {
				if (node instanceof Element) return [node.tagName.toLowerCase() === "svg" ? "svg" : shape(node)];
				return node.textContent === "" ? [] : [node.textContent ?? ""];
			}),
		};
	}

	const ROW =
		"flex w-full items-center gap-2 rounded-r6 h-auto !px-1 py-1.5 text-start text-body font-normal text-primary select-none outline-none data-[highlighted]:bg-fill-ghost-hover";
	const ICON = "size-5 shrink-0 p-0.5 text-secondary";
	const TRUNCATE = "min-w-0 flex-1 truncate";
	const INDENTED = "flex min-w-0 flex-1 items-center gap-3 ps-[32px]";
	const accent = (text: string): Shape => ({tag: "span", className: "text-upstream-accent", children: [text]});

	it("renders upstream's comfortable hit, child and more anatomy in a text-body popup", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});

		fireEvent.change(screen.getByRole("combobox", {name: "Search settings"}), {target: {value: "ho"}});

		const popover = await screen.findByRole("dialog", {name: "Search results"});
		const [status, scroller] = [...popover.children];
		expect({
			popup: popover.className,
			status: shape(status),
			statusRole: status.getAttribute("role"),
			scroller: scroller.className,
			rows: within(popover)
				.getAllByRole("button")
				.slice(0, 5)
				.map((button) => ({label: button.getAttribute("aria-label"), ...shape(button)})),
		}).toStrictEqual({
			popup: "w-[280px] rounded-card bg-[var(--menu-bg)] text-body font-normal text-primary shadow-[var(--menu-shadow)] outline-none",
			status: {tag: "p", className: "sr-only", children: []},
			statusRole: "status",
			scroller: "max-h-[min(320px,var(--available-height))] overflow-y-auto p-1",
			rows: [
				{
					label: null,
					tag: "button",
					className: ROW,
					children: [
						{
							tag: "span",
							className: "flex min-w-0 flex-1 flex-col",
							children: [
								{
									tag: "span",
									className: "flex items-center gap-3",
									children: ["svg", {tag: "span", className: TRUNCATE, children: ["Transcript"]}],
								},
							],
						},
					],
				},
				...(
					[
						["Hook warnings", [accent("Ho"), "ok warnings"]],
						["Hook errors", [accent("Ho"), "ok errors"]],
						["Passed hooks", ["Passed ", accent("ho"), "oks"]],
					] satisfies Array<[string, Array<Shape | string>]>
				).map(([title, text]) => ({
					label: `${title} in Transcript`,
					tag: "button",
					className: ROW,
					children: [
						{
							tag: "span",
							className: INDENTED,
							children: [{tag: "span", className: TRUNCATE, children: text}],
						},
					],
				})),
				{
					label: "2 more matches in Transcript",
					tag: "button",
					className: ROW,
					children: [
						{
							tag: "span",
							className: INDENTED,
							children: [
								{
									tag: "span",
									className: `${TRUNCATE} text-[var(--settings-muted)]`,
									children: ["+2 more"],
								},
							],
						},
					],
				},
			],
		});
	});

	const HO_COLLAPSED = [
		"hit: Transcript",
		"Hook warnings in Transcript",
		"Hook errors in Transcript",
		"Passed hooks in Transcript",
		"2 more matches in Transcript",
		"hit: ApplicationTerminal host",
		"hit: Sessions",
		"Show AI titles in Sessions",
		"Show working-copy changes strip in Sessions",
	];
	const HO_EXPANDED = [
		"hit: Transcript",
		"Hook warnings in Transcript",
		"Hook errors in Transcript",
		"Passed hooks in Transcript",
		"Show compact summaries inline in Transcript",
		"Show transcript-only system records in Transcript",
		"hit: ApplicationTerminal host",
		"hit: Sessions",
		"Show AI titles in Sessions",
		"Show working-copy changes strip in Sessions",
	];

	/** The popover rows, the sr-only status text, and whether the field kept focus. */
	function moreState(): {rows: string[]; status: string; inputFocused: boolean} {
		const popover = screen.getByRole("dialog", {name: "Search results"});
		return {
			rows: popoverRows(popover),
			status: within(popover).getByRole("status").textContent,
			inputFocused: document.activeElement === screen.getByRole("combobox", {name: "Search settings"}),
		};
	}

	it.each<[string, (input: HTMLElement) => void]>([
		[
			"click",
			() => {
				fireEvent.click(screen.getByRole("button", {name: "2 more matches in Transcript"}));
			},
		],
		[
			"Enter",
			(input) => {
				for (let i = 0; i < 4; i++) fireEvent.keyDown(input, {key: "ArrowDown"});
				fireEvent.keyDown(input, {key: "Enter"});
			},
		],
	])("%s on +N more expands the section in place and announces it", async (_how, expand) => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole("combobox", {name: "Search settings"});
		input.focus();

		fireEvent.change(input, {target: {value: "ho"}});
		await screen.findByRole("dialog", {name: "Search results"});
		const before = moreState();
		expand(input);

		expect({before, after: moreState(), hash: router.state.location.hash}).toStrictEqual({
			before: {rows: HO_COLLAPSED, status: "", inputFocused: true},
			after: {
				rows: HO_EXPANDED,
				status: "Showing 2 more matches in Transcript",
				inputFocused: true,
			},
			hash: "settings/general",
		});
	});

	it("collapses +N more when the normalised query changes, not on a whitespace-only edit", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole("combobox", {name: "Search settings"});
		input.focus();

		fireEvent.change(input, {target: {value: "ho"}});
		fireEvent.click(await screen.findByRole("button", {name: "2 more matches in Transcript"}));
		fireEvent.change(input, {target: {value: "ho "}});
		const sameQuery = moreState();
		fireEvent.change(input, {target: {value: "h"}});
		fireEvent.change(input, {target: {value: "ho"}});

		expect({sameQuery: sameQuery.rows, changed: moreState()}).toStrictEqual({
			sameQuery: HO_EXPANDED,
			changed: {rows: HO_COLLAPSED, status: "", inputFocused: true},
		});
	});

	it.each<[string, string, string]>([
		// Section-name-only and keyword-only hits get rows of their own and switch the tab only.
		["general", "hit: General", "settings/general"],
		["tmux", "hit: Applicationtmux", "settings/application"],
	])("gives %j a hit row that opens its tab", async (query, row, hash) => {
		const router = await renderAt("/#settings/claude-code");
		await screen.findByRole("dialog", {name: "Settings"});

		fireEvent.change(screen.getByRole("combobox", {name: "Search settings"}), {target: {value: query}});

		const popover = await screen.findByRole("dialog", {name: "Search results"});
		expect(popoverRows(popover)).toStrictEqual([row]);
		fireEvent.click(within(popover).getByRole("button"));

		await waitFor(() => {
			expect(router.state.location.hash).toBe(hash);
		});
		expect({scrolled, flashing: flashingRows()}).toStrictEqual({scrolled: [], flashing: []});
	});

	it("Enter picks the first row, even a keyword-only hit", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole("combobox", {name: "Search settings"});

		fireEvent.change(input, {target: {value: "herdr"}});
		fireEvent.keyDown(input, {key: "Enter"});

		await waitFor(() => {
			expect(router.state.location.hash).toBe("settings/application");
		});
	});

	/** The popover rows, with the highlighted one marked. */
	function highlightedRows(): string[] {
		const popover = screen.getByRole("dialog", {name: "Search results"});
		return within(popover)
			.getAllByRole("button")
			.map((button) => {
				const name = button.getAttribute("aria-label") ?? `hit: ${button.textContent}`;
				return button.getAttribute("data-highlighted") === "" ? `> ${name}` : name;
			});
	}

	const FONT_ROWS = [
		"hit: Claude Code",
		"Code font in Claude Code",
		"Interface font in Claude Code",
		"hit: GeneralTranscript text size",
	];
	const marked = (index: number) => FONT_ROWS.map((row, i) => (i === index ? `> ${row}` : row));

	it("highlights the first row, and the arrows move the highlight with wrap-around", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole("combobox", {name: "Search settings"});

		fireEvent.change(input, {target: {value: "font"}});
		await screen.findByRole("dialog", {name: "Search results"});
		const seen = [highlightedRows()];
		for (const key of ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"]) {
			fireEvent.keyDown(input, {key});
			seen.push(highlightedRows());
		}

		expect(seen).toStrictEqual([marked(0), marked(1), marked(2), marked(3), marked(0), marked(3), marked(2)]);
		expect(highlightScrolls.at(-1)).toStrictEqual({
			row: "Interface font in Claude Code",
			options: {block: "nearest"},
		});
	});

	it("resets the highlight to the first row whenever the query changes", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole("combobox", {name: "Search settings"});

		fireEvent.change(input, {target: {value: "font"}});
		fireEvent.keyDown(input, {key: "ArrowDown"});
		fireEvent.keyDown(input, {key: "ArrowDown"});
		fireEvent.change(input, {target: {value: "font "}});

		expect(highlightedRows()).toStrictEqual(marked(0));
	});

	it("ignores keys while an IME is composing", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole("combobox", {name: "Search settings"});

		fireEvent.change(input, {target: {value: "font"}});
		fireEvent.keyDown(input, {key: "ArrowDown", isComposing: true});

		expect(highlightedRows()).toStrictEqual(marked(0));
	});

	it("Enter picks the highlighted row and ignores key repeat", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole("combobox", {name: "Search settings"});

		fireEvent.change(input, {target: {value: "font"}});
		fireEvent.keyDown(input, {key: "ArrowUp"});
		fireEvent.keyDown(input, {key: "Enter", repeat: true});
		expect({hash: router.state.location.hash, rows: highlightedRows()}).toStrictEqual({
			hash: "settings/general",
			rows: marked(3),
		});

		fireEvent.keyDown(input, {key: "ArrowUp"});
		fireEvent.keyDown(input, {key: "Enter"});

		await waitFor(() => {
			expect(router.state.location.hash).toBe("settings/claude-code");
		});
		expect(scrolled).toStrictEqual(["interface-font"]);
	});

	it("moves the single highlight with the pointer and keeps focus in the input on mousedown", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole("combobox", {name: "Search settings"});
		input.focus();

		fireEvent.change(input, {target: {value: "font"}});
		const popover = await screen.findByRole("dialog", {name: "Search results"});
		const second = within(popover).getByRole("button", {name: "Code font in Claude Code"});
		fireEvent.mouseMove(second);
		const rows = highlightedRows();
		const notPrevented = fireEvent.mouseDown(second);

		expect({rows, notPrevented, focused: document.activeElement === input}).toStrictEqual({
			rows: marked(1),
			notPrevented: false,
			focused: true,
		});
	});

	/** The search field's value, whether it holds focus, and which dialogs are open. */
	function searchState(input: HTMLInputElement) {
		return {
			value: input.value,
			focused: document.activeElement === input,
			results: screen.queryByRole("dialog", {name: "Search results"}) !== null,
			settings: screen.queryByRole("dialog", {name: "Settings"}) !== null,
		};
	}

	it("Escape clears the query and blurs the field without closing Settings; a second Escape closes it", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole<HTMLInputElement>("combobox", {name: "Search settings"});
		input.focus();
		fireEvent.change(input, {target: {value: "font"}});
		await screen.findByRole("dialog", {name: "Search results"});

		const notPrevented = fireEvent.keyDown(input, {key: "Escape", code: "Escape"});
		const afterFirst = {...searchState(input), notPrevented, hash: router.state.location.hash};

		fireEvent.keyDown(document.activeElement ?? document.body, {key: "Escape", code: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Settings"})).toBeNull();
		});

		expect(afterFirst).toStrictEqual({
			value: "",
			focused: false,
			results: false,
			settings: true,
			notPrevented: false,
			hash: "settings/general",
		});
	});

	it("Tab clears the query", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole<HTMLInputElement>("combobox", {name: "Search settings"});
		input.focus();
		fireEvent.change(input, {target: {value: "font"}});
		await screen.findByRole("dialog", {name: "Search results"});

		fireEvent.keyDown(input, {key: "Tab", code: "Tab"});

		expect(searchState(input)).toStrictEqual({value: "", focused: true, results: false, settings: true});
	});

	it("an outside press closes and clears the results; a press in the field keeps them open", async () => {
		await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole<HTMLInputElement>("combobox", {name: "Search settings"});
		input.focus();
		fireEvent.change(input, {target: {value: "font"}});
		await screen.findByRole("dialog", {name: "Search results"});

		fireEvent.pointerDown(input);
		fireEvent.mouseDown(input);
		const afterInside = searchState(input);

		const heading = within(dialog).getAllByRole("heading")[0] ?? dialog;
		fireEvent.pointerDown(heading);
		fireEvent.mouseDown(heading);
		fireEvent.click(heading);
		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Search results"})).toBeNull();
		});

		expect({afterInside, afterOutside: searchState(input)}).toStrictEqual({
			afterInside: {value: "font", focused: true, results: true, settings: true},
			afterOutside: {value: "", focused: false, results: false, settings: true},
		});
	});

	it("selecting a result clears the query and blurs the field", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole<HTMLInputElement>("combobox", {name: "Search settings"});
		input.focus();
		fireEvent.change(input, {target: {value: "font"}});
		await screen.findByRole("dialog", {name: "Search results"});

		fireEvent.keyDown(input, {key: "Enter"});
		await waitFor(() => {
			expect(router.state.location.hash).toBe("settings/claude-code");
		});

		expect(searchState(input)).toStrictEqual({value: "", focused: false, results: false, settings: true});
	});

	const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)";

	/** Fill the field, then blur it so focus is back on the body. */
	async function blurredQuery(value: string) {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const input = screen.getByRole<HTMLInputElement>("combobox", {name: "Search settings"});
		fireEvent.change(input, {target: {value}});
		input.blur();
		return input;
	}

	function findState(input: HTMLInputElement, notPrevented: boolean) {
		return {
			notPrevented,
			focused: document.activeElement === input,
			selection: [input.selectionStart, input.selectionEnd],
			pageSearchExpanded: screen.queryByRole("button", {name: "Search page", hidden: true}) === null,
		};
	}

	it("Ctrl+F from the body focuses and selects the field, and the page's ⌘F search stays closed", async () => {
		const input = await blurredQuery("font");
		input.setSelectionRange(4, 4);

		const notPrevented = fireEvent.keyDown(document.body, {key: "f", code: "KeyF", ctrlKey: true});

		expect(findState(input, notPrevented)).toStrictEqual({
			notPrevented: false,
			focused: true,
			selection: [0, 4],
			pageSearchExpanded: false,
		});
	});

	it("⌘F focuses and selects the field on mac", async () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		const input = await blurredQuery("font");
		input.setSelectionRange(4, 4);

		const notPrevented = fireEvent.keyDown(document.body, {key: "f", code: "KeyF", metaKey: true});

		expect(findState(input, notPrevented)).toStrictEqual({
			notPrevented: false,
			focused: true,
			selection: [0, 4],
			pageSearchExpanded: false,
		});
	});

	it.each([
		{name: "⌘ and Ctrl together", modifiers: {metaKey: true, ctrlKey: true}},
		{name: "Ctrl+Alt", modifiers: {ctrlKey: true, altKey: true}},
		{name: "Ctrl+Shift", modifiers: {ctrlKey: true, shiftKey: true}},
	])("leaves $name+F to the browser", async ({modifiers}) => {
		const input = await blurredQuery("font");
		input.setSelectionRange(4, 4);

		const notPrevented = fireEvent.keyDown(document.body, {key: "f", code: "KeyF", ...modifiers});

		expect(findState(input, notPrevented)).toStrictEqual({
			notPrevented: true,
			focused: false,
			selection: [4, 4],
			pageSearchExpanded: false,
		});
	});

	it("leaves Ctrl+F to the browser inside a nested dialog", async () => {
		const input = await blurredQuery("font");
		input.setSelectionRange(4, 4);
		const nested = document.createElement("div");
		nested.setAttribute("role", "alertdialog");
		const confirm = document.createElement("button");
		nested.append(confirm);
		document.body.append(nested);
		confirm.focus();

		const notPrevented = fireEvent.keyDown(confirm, {key: "f", code: "KeyF", ctrlKey: true});
		nested.remove();

		expect(findState(input, notPrevented)).toStrictEqual({
			notPrevented: true,
			focused: false,
			selection: [4, 4],
			pageSearchExpanded: false,
		});
	});

	it("releases Ctrl+F once Settings closes, so the page's search claims it again", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		await act(async () => {
			await router.navigate({to: "/", hash: ""});
		});
		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Settings"})).toBeNull();
		});

		const notPrevented = fireEvent.keyDown(document.body, {key: "f", code: "KeyF", ctrlKey: true});

		expect({notPrevented, pageSearch: screen.queryByRole("searchbox") !== null}).toStrictEqual({
			notPrevented: false,
			pageSearch: true,
		});
	});
});
