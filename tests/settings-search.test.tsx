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

	beforeEach(() => {
		stubBrowser();
		scrolled = [];
		Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
			scrolled.push(this.getAttribute("data-settings-row") ?? this.tagName);
		};
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
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
		expect([...popover.querySelectorAll(".text-accent-100")].map((match) => match.textContent)).toStrictEqual([
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
			name: lines[0]?.textContent,
			via: lines[1]?.textContent,
			matches: [...popover.querySelectorAll(".text-accent-100")].map((match) => match.textContent),
		}).toStrictEqual({rows: ["hit: GeneralTheme"], icon: "svg", name: "General", via: "Theme", matches: ["Theme"]});
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
});
