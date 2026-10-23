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
import {cleanup, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {SettingsProvider} from "../src/components/settings-provider";
import {DEFAULTS} from "../src/components/settings-context";
import {Sidebar} from "../src/components/sidebar/Sidebar";
import {useCommandPalette} from "../src/hooks/use-command-palette";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {localAccountQueryOptions} from "../src/lib/api/local-account";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {activeSessionsQueryOptions} from "../src/lib/api/sessions";
import {installLocalStorage} from "./fake-storage";
import {NAV_SECTIONS} from "../src/lib/nav-sections";
import {ToastProvider} from "../src/components/toast";

function PaletteProbe() {
	const palette = useCommandPalette();
	return (
		<div data-testid="palette-probe">
			{palette.open ? "open" : "closed"}:{palette.entrypoint}
		</div>
	);
}

function seedQueryClient(name: string | null): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(approvalsQueryOptions().queryKey, {approvals: []});
	queryClient.setQueryData(notificationsQueryOptions().queryKey, {notifications: []});
	queryClient.setQueryData(activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey, []);
	queryClient.setQueryData(applicationSettingsQueryOptions.queryKey, {
		terminalWritesEnabled: false,
		terminalHost: "auto",
		shellPaneEnabled: true,
		visibleNavSections: NAV_SECTIONS.filter((section) => section !== "herdr"),
		ignoredDirs: ["node_modules"],
	});
	if (name !== null) {
		queryClient.setQueryData(localAccountQueryOptions.queryKey, {
			name,
			firstName: name,
			initial: name.charAt(0).toUpperCase(),
			planLabel: "Max",
			planDetail: "Max (20x)",
		});
	}
	return queryClient;
}

async function renderSidebar(name: string | null = "craig") {
	const queryClient = seedQueryClient(name);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SettingsProvider>
						<Sidebar collapsed={false} />
						<PaletteProbe />
						<Outlet />
					</SettingsProvider>
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const searchRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/search",
		component: () => <div data-testid="search-page" />,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([searchRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return router;
}

afterEach(cleanup);

beforeEach(() => {
	installLocalStorage();
});

describe("sidebar footer", () => {
	it("renders only the full-width account menu button, with no Search icon", async () => {
		await renderSidebar();

		const footer = await waitFor(() => screen.getByTestId("sidebar-footer"));
		const account = within(footer).getByTestId("user-menu-button");
		const label = within(footer).getByText("craig").parentElement?.className.split(" ") ?? [];

		expect({
			accountText: account.textContent,
			accountPopup: account.getAttribute("aria-haspopup"),
			accountFullWidth: account.classList.contains("w-full"),
			buttonCount: within(footer).getAllByRole("button").length,
			search: within(footer).queryByRole("button", {name: "Search"}),
			labelType: label.filter((token) => token.startsWith("text-[") || token.startsWith("leading-")),
		}).toStrictEqual({
			accountText: "Ccraig·Max",
			accountPopup: "menu",
			accountFullWidth: true,
			buttonCount: 1,
			search: null,
			labelType: ["text-[14px]", "leading-[21px]"],
		});
	});

	it("labels the account button Local until the account loads", async () => {
		await renderSidebar(null);

		const account = await waitFor(() => screen.getByTestId("user-menu-button"));

		expect(account.textContent).toBe("LLocal");
	});

	it("has no inline search input and no feedback button", async () => {
		await renderSidebar();
		await waitFor(() => screen.getByTestId("sidebar-footer"));

		expect({
			textboxes: screen.queryAllByRole("textbox").length,
			feedback: screen.queryAllByRole("button", {name: /feedback/i}).length,
		}).toStrictEqual({textboxes: 0, feedback: 0});
	});
});
