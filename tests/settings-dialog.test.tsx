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
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsDialog} from "../src/components/settings/settings-dialog";
import {SettingsProvider} from "../src/components/settings-provider";
import {ThemeProvider} from "../src/components/theme-provider";
import {redirectToSettingsDialog} from "../src/routes/settings";
import {installLocalStorage} from "./fake-storage";

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
		component: () => (
			<div>
				<button type="button">Page trigger</button>
				<textarea aria-label="Page composer" />
			</div>
		),
	});
	const settingsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/settings",
		beforeLoad: redirectToSettingsDialog,
	});
	return createRouter({
		routeTree: rootRoute.addChildren([indexRoute, settingsRoute]),
		history: createMemoryHistory({initialEntries: [initialEntry]}),
	});
}

async function renderAt(initialEntry: string) {
	const router = buildRouter(initialEntry);
	await router.load();
	render(<RouterProvider router={router} />);
	return router;
}

function location(router: ReturnType<typeof buildRouter>) {
	return {pathname: router.state.location.pathname, hash: router.state.location.hash};
}

function currentTabs(): string[] {
	const nav = screen.getByRole("navigation", {name: "Settings"});
	return [...nav.querySelectorAll('[aria-current="page"]')].map((tab) => tab.textContent ?? "");
}

describe("SettingsDialog", () => {
	beforeEach(() => {
		stubBrowser();
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("stays closed without a settings hash", async () => {
		await renderAt("/");
		await screen.findByRole("button", {name: "Page trigger"});

		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("opens on the hash's tab with that tab marked current", async () => {
		await renderAt("/#settings/sessions");

		await screen.findByRole("dialog", {name: "Settings"});
		// Upstream drops the per-tab h2: the content starts with the section headings.
		expect({
			current: currentTabs(),
			tabHeading: screen.queryByRole("heading", {level: 2, name: "Sessions"}),
		}).toStrictEqual({current: ["Sessions"], tabHeading: null});
	});

	it("gives every nav item an icon before its label", async () => {
		await renderAt("/#settings/general");

		await screen.findByRole("dialog", {name: "Settings"});
		const nav = screen.getByRole("navigation", {name: "Settings"});
		expect(
			[...nav.querySelectorAll("button")].map((button) => button.firstElementChild?.tagName.toLowerCase()),
		).toStrictEqual(Array.from({length: 9}, () => "svg"));
	});

	it("renders no visible Settings caption above the tab list, naming the nav by aria-label", async () => {
		await renderAt("/#settings/general");

		await screen.findByRole("dialog", {name: "Settings"});
		const nav = screen.getByRole("navigation", {name: "Settings"});
		expect({
			ariaLabel: nav.getAttribute("aria-label"),
			captions: [...nav.querySelectorAll("*")].filter((element) => element.textContent === "Settings").length,
		}).toStrictEqual({ariaLabel: "Settings", captions: 0});
	});

	it("lists the local settings tabs in order", async () => {
		await renderAt("/#settings/general");

		await screen.findByRole("dialog", {name: "Settings"});
		const nav = screen.getByRole("navigation", {name: "Settings"});
		expect([...nav.querySelectorAll("button")].map((button) => button.textContent ?? "")).toStrictEqual([
			"General",
			"Usage",
			"Claude Code",
			"Transcript",
			"Sessions",
			"Application",
			"AI features",
			"Claude Config",
			"Setup",
		]);
	});

	it("clears the hash on Escape", async () => {
		const router = await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});

		fireEvent.keyDown(dialog, {key: "Escape", code: "Escape"});

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(location(router)).toStrictEqual({pathname: "/", hash: ""});
	});

	it("clears the hash on × and restores focus to the element focused before opening", async () => {
		const router = await renderAt("/");
		const trigger = await screen.findByRole("button", {name: "Page trigger"});
		trigger.focus();

		await act(() => router.navigate({to: "/", hash: "settings/general"}));
		await screen.findByRole("dialog", {name: "Settings"});
		fireEvent.click(screen.getByRole("button", {name: "Close"}));

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(location(router)).toStrictEqual({pathname: "/", hash: ""});
	});

	it("switching tabs updates the hash and aria-current", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});

		fireEvent.click(screen.getByRole("button", {name: "Transcript"}));

		await waitFor(() => expect(currentTabs()).toStrictEqual(["Transcript"]));
		expect(location(router)).toStrictEqual({pathname: "/", hash: "settings/transcript"});
	});

	it("opens General with ⇧⌘, while a textarea has focus", async () => {
		const router = await renderAt("/");
		const composer = await screen.findByRole("textbox", {name: "Page composer"});
		composer.focus();

		// jsdom's user agent is not a Mac, so the non-mac Ctrl+Shift+, binding applies.
		fireEvent.keyDown(composer, {key: "<", code: "Comma", ctrlKey: true, shiftKey: true});

		await screen.findByRole("dialog", {name: "Settings"});
		expect({location: location(router), current: currentTabs()}).toStrictEqual({
			location: {pathname: "/", hash: "settings/general"},
			current: ["General"],
		});
	});
});

describe("/settings route", () => {
	beforeEach(() => {
		stubBrowser();
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("redirects to the home page with the General settings hash", async () => {
		const router = await renderAt("/settings");

		await screen.findByRole("dialog", {name: "Settings"});
		expect(location(router)).toStrictEqual({pathname: "/", hash: "settings/general"});
	});
});

describe("SettingsDialog local tabs", () => {
	beforeEach(() => {
		stubBrowser();
		vi.stubGlobal("fetch", () => new Promise(() => {}));
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	/** Each h3 section in the open tab mapped to its row titles, in DOM order. */
	function tabOutline(dialog: HTMLElement): Array<[string, string[]]> {
		return [...dialog.querySelectorAll("section")].map((section) => [
			section.querySelector("h3")?.textContent ?? "",
			[...section.querySelectorAll<HTMLElement>("[data-settings-row]")].map((row) => {
				const titleId = row.getAttribute("aria-labelledby") ?? "";
				return row.querySelector(`[id="${titleId}"]`)?.textContent ?? "";
			}),
		]);
	}

	it.each<[string, Array<[string, string[]]>]>([
		[
			"transcript",
			[
				["Session Display", ["Thinking", "Tools", "Tool duration", "Debug"]],
				["Hooks", ["Passed hooks", "Hook warnings", "Hook errors"]],
				[
					"System Content",
					["System banners", "Show compact summaries inline", "Show transcript-only system records"],
				],
				["Link categories", []],
			],
		],
		[
			"sessions",
			[
				["Active sessions", ["Active session order", "Sessions page grouping", "Active timeout (seconds)"]],
				["Sub-agents", ["Default view"]],
			],
		],
		["application", [["Application", []]]],
		[
			"ai-features",
			[
				[
					"AI Features",
					[
						"Summary button",
						"Working-copy review",
						"Review behavior",
						"Session context brief",
						"Read-only MCP server",
					],
				],
			],
		],
		["claude-config", [["Claude Config", ["Claude Code settings files"]]]],
	])("renders the moved sections on the %s tab", async (tab, outline) => {
		await renderAt(`/#settings/${tab}`);
		const dialog = await screen.findByRole("dialog", {name: "Settings"});

		expect(tabOutline(dialog)).toStrictEqual(outline);
	});

	it("links the Claude Config tab to the settings editor", async () => {
		await renderAt("/#settings/claude-config");
		await screen.findByRole("dialog", {name: "Settings"});

		expect(screen.getByRole("link", {name: "Open editor"}).getAttribute("href")).toBe("/settings/edit");
	});

	it("embeds the hook setup on the Setup tab", async () => {
		await renderAt("/#settings/setup");
		await screen.findByRole("dialog", {name: "Settings"});

		expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toStrictEqual([
			"Hook Configuration",
		]);
	});
});
