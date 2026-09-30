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
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsDialog} from "../src/components/settings/settings-dialog";
import {SettingsProvider} from "../src/components/settings-provider";
import {ThemeProvider} from "../src/components/theme-provider";
import {SettingsTabSchema} from "../src/lib/settings-hash";
import {SETTINGS_INDEX} from "../src/lib/settings-search";
import {installLocalStorage} from "./fake-storage";

const APPLICATION_SETTINGS = {
	herdrWritesEnabled: false,
	shellPaneEnabled: false,
	visibleNavSections: [],
	ignoredDirs: ["node_modules"],
};

function stubBrowser() {
	installLocalStorage();
	vi.stubGlobal(
		"matchMedia",
		(query: string): MediaQueryList =>
			({
				matches: false,
				media: query,
				onchange: null,
				addEventListener: () => {},
				removeEventListener: () => {},
				addListener: () => {},
				removeListener: () => {},
				dispatchEvent: () => false,
			}) satisfies MediaQueryList,
	);
	vi.stubGlobal("fetch", (input: string) =>
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

function flashingRows(): string[] {
	return [...document.querySelectorAll<HTMLElement>("[data-settings-flash]")].map(
		(row) => row.dataset["settingsRow"] ?? "",
	);
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

		await waitFor(() => expect(renderedRows(dialog)).toStrictEqual(expected));
	});

	it("deep links scroll to and flash the row for 1.5s, then collapse the hash", async () => {
		const router = await renderAt("/#settings/claude-code/code-font");
		await screen.findByRole("dialog", {name: "Settings"});

		await waitFor(() => expect(router.state.location.hash).toBe("settings/claude-code"));
		expect(flashingRows()).toStrictEqual(["code-font"]);
		expect(scrolled).toStrictEqual(["code-font"]);

		await waitFor(() => expect(flashingRows()).toStrictEqual([]), {timeout: 2500});
	});

	it("shows grouped results and deep links to the selected row", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});

		fireEvent.change(screen.getByRole("combobox", {name: "Search settings"}), {
			target: {value: "view"},
		});

		const popover = await screen.findByRole("dialog", {name: "Search results"});
		// Upstream anatomy: each result is a button with the section on line 1 and the row title
		// on line 2, and results from the same section sit together.
		expect(
			within(popover)
				.getAllByRole("button")
				.map((button) => [
					button.querySelector("[data-settings-result-section]")?.textContent,
					button.querySelector("[data-settings-result-title]")?.textContent,
				]),
		).toStrictEqual([
			["Claude Code", "Default transcript view"],
			["Sessions", "Default view"],
			["AI features", "Working-copy review"],
			["AI features", "Review behavior"],
		]);
		expect([...popover.querySelectorAll(".text-accent-100")].map((match) => match.textContent)).toStrictEqual([
			"view",
			"view",
			"view",
			"view",
		]);

		fireEvent.click(within(popover).getByRole("button", {name: "Sessions Default view"}));

		await waitFor(() => expect(router.state.location.hash).toBe("settings/sessions"));
		expect(flashingRows()).toStrictEqual(["default-view"]);
		expect(scrolled).toStrictEqual(["default-view"]);
		expect(screen.queryByRole("dialog", {name: "Search results"})).toBeNull();
	});
});
