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
import {AccountMenu} from "../src/components/sidebar/account-menu";
import {localAccountQueryOptions} from "../src/lib/api/local-account";
import type {LocalAccount} from "../src/lib/local-account";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const ACCOUNT: LocalAccount = {
	name: "Craig",
	firstName: "Craig",
	initial: "C",
	email: "craig@example.com",
	planLabel: "Max",
	planDetail: "Max (20x)",
};

async function renderAccountMenu(account: LocalAccount = ACCOUNT) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(localAccountQueryOptions.queryKey, account);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<AccountMenu />
				<Outlet />
			</QueryClientProvider>
		),
	});
	const pageRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "$",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([pageRoute]),
		history: createMemoryHistory({initialEntries: ["/plans"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return router;
}

async function openMenu(): Promise<HTMLElement> {
	fireEvent.click(await screen.findByTestId("user-menu-button"));
	return screen.findByRole("menu");
}

async function openLearnMore(menu: HTMLElement): Promise<HTMLElement> {
	const trigger = within(menu).getByRole("menuitem", {name: "Learn more"});
	act(() => trigger.focus());
	fireEvent.keyDown(trigger, {key: "ArrowRight"});
	await waitFor(() => expect(screen.getAllByRole("menu")).toHaveLength(2));
	const submenu = screen.getAllByRole("menu").find((candidate) => candidate !== menu);
	if (submenu === undefined) throw new Error("no Learn more submenu");
	return submenu;
}

function menuEntries(menu: HTMLElement) {
	return Array.from(menu.querySelectorAll('[role="menuitem"], [role="separator"]'))
		.filter((el) => el.closest('[role="menu"]') === menu)
		.map((el) =>
			el.getAttribute("role") === "separator"
				? "---"
				: (el.querySelector(".truncate")?.textContent ?? el.textContent),
		);
}

beforeEach(() => {
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("footer account button", () => {
	it("shows the avatar initial, name, plan suffix and opens a menu", async () => {
		await renderAccountMenu();
		const button = await screen.findByTestId("user-menu-button");

		expect({
			tag: button.tagName,
			text: button.textContent,
			hasPopup: button.getAttribute("aria-haspopup"),
		}).toStrictEqual({tag: "BUTTON", text: "CCraig·Max", hasPopup: "menu"});
	});

	it("omits the plan suffix when the account has no plan", async () => {
		await renderAccountMenu({name: "craig", firstName: "craig", initial: "C"});
		const button = await screen.findByTestId("user-menu-button");

		expect(button.textContent).toBe("Ccraig");
	});
});

describe("account menu", () => {
	it("lists the email header and the local items in upstream order", async () => {
		await renderAccountMenu();
		const menu = await openMenu();

		expect({
			header: within(menu).getByTestId("user-menu-header").textContent,
			entries: menuEntries(menu),
		}).toStrictEqual({
			header: "craig@example.com",
			entries: ["Settings", "Usage", "Get help", "---", "Claude Config", "Setup", "---", "Learn more"],
		});
	});

	it("opens Get help on support.claude.com in a new tab", async () => {
		await renderAccountMenu();
		const item = within(await openMenu()).getByRole("menuitem", {name: "Get help"});

		expect({
			tag: item.tagName,
			href: item.getAttribute("href"),
			target: item.getAttribute("target"),
			rel: item.getAttribute("rel"),
		}).toStrictEqual({tag: "A", href: "https://support.claude.com", target: "_blank", rel: "noreferrer"});
	});

	it("opens above the button", async () => {
		await renderAccountMenu();
		const menu = await openMenu();

		expect(menu.getAttribute("data-side")).toBe("top");
	});

	it("marks Settings with the Shift+Meta+, shortcut", async () => {
		await renderAccountMenu();
		const menu = await openMenu();

		expect(
			within(menu)
				.getAllByRole("menuitem")
				.map((item) => [item.getAttribute("data-testid"), item.getAttribute("aria-keyshortcuts")]),
		).toStrictEqual([
			["user-menu-settings", "Shift+Meta+,"],
			["user-menu-usage", null],
			["user-menu-get-help", null],
			["user-menu-claude-config", null],
			["user-menu-setup", null],
			["user-menu-learn-more", null],
		]);
	});

	it("opens Settings at General over the current page", async () => {
		const router = await renderAccountMenu();
		const menu = await openMenu();
		fireEvent.click(within(menu).getByRole("menuitem", {name: /Settings/}));

		await waitFor(() =>
			expect({
				pathname: router.state.location.pathname,
				hash: router.state.location.hash,
			}).toStrictEqual({pathname: "/plans", hash: "settings/general"}),
		);
	});

	it("navigates Usage to #settings/usage", async () => {
		const router = await renderAccountMenu();
		const menu = await openMenu();
		fireEvent.click(within(menu).getByRole("menuitem", {name: "Usage"}));

		await waitFor(() =>
			expect({
				pathname: router.state.location.pathname,
				hash: router.state.location.hash,
			}).toStrictEqual({pathname: "/plans", hash: "settings/usage"}),
		);
	});

	it("navigates Claude Config and Setup to their pages", async () => {
		const router = await renderAccountMenu();
		fireEvent.click(within(await openMenu()).getByRole("menuitem", {name: "Claude Config"}));
		await waitFor(() => expect(router.state.location.pathname).toBe("/settings/edit"));

		fireEvent.click(within(await openMenu()).getByRole("menuitem", {name: "Setup"}));
		await waitFor(() => expect(router.state.location.pathname).toBe("/setup"));
	});

	it("has no cloud-only items", async () => {
		await renderAccountMenu();
		const menu = await openMenu();
		const submenu = await openLearnMore(menu);
		const names = [...menuEntries(menu), ...menuEntries(submenu)];

		expect(
			names.filter((name) => /log ?out|language|view all plans|get apps|privacy choices/i.test(name ?? "")),
		).toStrictEqual([]);
	});
});

describe("Learn more submenu", () => {
	it("lists upstream's links, then the Claude Code links, a separator and Keyboard shortcuts", async () => {
		await renderAccountMenu();
		const submenu = await openLearnMore(await openMenu());

		expect({
			entries: menuEntries(submenu),
			links: within(submenu)
				.getAllByRole("menuitem")
				.filter((item) => item.tagName === "A")
				.map((item) => [item.getAttribute("href"), item.getAttribute("target")]),
			shortcut: within(submenu)
				.getByRole("menuitem", {name: /Keyboard shortcuts/})
				.getAttribute("aria-keyshortcuts"),
		}).toStrictEqual({
			entries: [
				"Claude Platform",
				"About Anthropic",
				"---",
				"Claude Academy",
				"Usage policy",
				"Privacy policy",
				"Terms of service",
				"Claude Code docs",
				"Changelog",
				"Report an issue",
				"---",
				"Keyboard shortcuts",
			],
			links: [
				["https://platform.claude.com", "_blank"],
				["https://www.anthropic.com/", "_blank"],
				["https://claude.ai/learning", "_blank"],
				["https://www.anthropic.com/legal/aup", "_blank"],
				["https://www.anthropic.com/legal/privacy", "_blank"],
				["https://www.anthropic.com/legal/consumer-terms", "_blank"],
				["https://code.claude.com/docs", "_blank"],
				["https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md", "_blank"],
				["https://github.com/anthropics/claude-code/issues", "_blank"],
			],
			shortcut: "Meta+/",
		});
	});
});
