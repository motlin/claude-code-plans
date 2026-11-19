// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import
{
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {readFileSync} from "node:fs";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
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

function PaletteProbe()
{
	const palette = useCommandPalette();
	return (
		<div data-testid="palette-probe">
			{palette.open ? "open" : "closed"}:{palette.entrypoint}
		</div>
	);
}

function seedQueryClient(name: string | null): QueryClient
{
	const queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
					staleTime: Infinity,
					gcTime: Infinity,
					refetchOnMount: false,
				},
			},
		},
	);
	queryClient.setQueryData(
		approvalsQueryOptions().queryKey,
		{
			approvals: [],
		},
	);
	queryClient.setQueryData(
		notificationsQueryOptions().queryKey,
		{
			notifications: [],
		},
	);
	queryClient.setQueryData(activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey, []);
	queryClient.setQueryData(
		applicationSettingsQueryOptions.queryKey,
		{
			terminalWritesEnabled: false,
			terminalHost: "auto",
			shellPaneEnabled: true,
			visibleNavSections: NAV_SECTIONS.filter((section) => section !== "herdr"),
			ignoredDirs: ["node_modules"],
		},
	);
	if (name !== null)
	{
		queryClient.setQueryData(
			localAccountQueryOptions.queryKey,
			{
				name,
				firstName: name,
				initial: name.charAt(0).toUpperCase(),
				planLabel: "Max",
				planDetail: "Max (20x)",
			},
		);
	}
	return queryClient;
}

async function renderSidebar(name: string | null = "craig")
{
	const queryClient = seedQueryClient(name);
	const rootRoute = createRootRoute(
		{
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
		},
	);
	const searchRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "/search",
			component: () => <div data-testid="search-page" />,
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute.addChildren([searchRoute]),
			history: createMemoryHistory(
				{
					initialEntries: ["/"],
				},
			),
		},
	);
	await router.load();
	render(<RouterProvider router={router} />);
	return router;
}

afterEach(cleanup);

beforeEach(() =>
{
	installLocalStorage();
});

describe("sidebar footer", () =>
{
	it("lays out upstream's df-footer-row: a content-width account button and the Code settings gear in the aux", async () =>
	{
		await renderSidebar();

		const footer = await waitFor(() => screen.getByTestId("sidebar-footer"));
		const row = footer.firstElementChild;
		const account = within(footer).getByTestId("user-menu-button");
		const words = within(footer).getByText("craig").parentElement;
		const name = within(footer).getByText("craig");
		const dot = within(footer).getByText("·");
		const plan = within(footer).getByText("Max");
		const caret = account.querySelector("[data-cds=Icon]");
		const gear = within(footer).getByRole(
			"button",
			{
				name: "Code settings",
			},
		);
		const classes = (element: Element | null | undefined) => element?.getAttribute("class")?.split(" ") ?? [];

		expect(
			{
				accountText: account.textContent,
				accountPopup: account.getAttribute("aria-haspopup"),
				tray: classes(footer).includes("df-bottom-tray"),
				row: ["df-footer-row", "gap-[var(--df-footer-gap)]"].every((token) => classes(row).includes(token)),
				account: ["df-user-menu-btn", "h-7", "max-w-full", "justify-start"].every((token) =>
					classes(account).includes(token),
				),
				accountFullWidth: classes(account).includes("w-full"),
				words: classes(words).filter(
					(token) => token.startsWith("df-") || token.startsWith("text-[") || token.startsWith("leading-"),
				),
				name: classes(name).filter((token) => token.startsWith("df-") || token === "truncate"),
				dot: classes(dot).filter((token) => token.startsWith("df-") || token.startsWith("text-[")),
				plan: classes(plan).filter((token) => token.startsWith("df-") || token.startsWith("text-[")),
				caret: classes(caret).includes("df-user-menu-caret"),
				caretWrapper: classes(caret?.parentElement),
				buttonCount: within(footer).getAllByRole("button").length,
				gearInAux: gear.closest(".df-footer-aux") !== null,
				gear: ["df-chrome-btn", "size-7", "rounded-r6"].every((token) => classes(gear).includes(token)),
				search: within(footer).queryByRole(
					"button",
					{
						name: "Search",
					},
				),
			},
		).toStrictEqual(
			{
				accountText: "Ccraig·Max",
				accountPopup: "menu",
				tray: true,
				row: true,
				account: true,
				accountFullWidth: false,
				words: ["df-user-menu-words", "df-footer-suffix", "text-[length:var(--sb-row-font)]", "leading-5"],
				name: ["df-footer-name"],
				dot: ["df-footer-suffix-text", "text-[length:calc(var(--sb-row-font)-2px)]/5"],
				plan: ["df-footer-suffix-text", "text-[length:calc(var(--sb-row-font)-2px)]/5"],
				caret: true,
				caretWrapper: ["-me-1", "inline-flex"],
				buttonCount: 2,
				gearInAux: true,
				gear: true,
				search: null,
			},
		);
	});

	it("opens Settings at the Code tab from the gear", async () =>
	{
		const router = await renderSidebar();

		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: "Code settings",
				},
			),
		);

		await waitFor(() =>
		{
			expect(router.state.location.hash).toBe("settings/claude-code");
		});
	});

	it("shows a Code settings tooltip with no shortcut when the gear is focused", async () =>
	{
		await renderSidebar();

		const gear = await screen.findByRole(
			"button",
			{
				name: "Code settings",
			},
		);
		act(() =>
		{
			gear.focus();
		});

		expect((await screen.findByRole("tooltip")).textContent).toBe("Code settings");
	});

	it("draws the tray hairline and fades cut footer words as upstream", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8").replaceAll(/\s+/g, " ");

		expect(
			[
				'.df-bottom-tray::before { content: ""; position: absolute; inset-inline: 0; top: -0.5px; z-index: 1; border-top: 0.5px solid var(--color-border); }',
				".df-footer-suffix { padding-right: 2px; mask-image: linear-gradient(90deg, #000 calc(100% - 12px), transparent); }",
				"--df-footer-gap: 6px;",
			].filter((rule) => !styles.includes(rule)),
		).toStrictEqual([]);
	});

	it("labels the account button Local until the account loads", async () =>
	{
		await renderSidebar(null);

		const account = await waitFor(() => screen.getByTestId("user-menu-button"));

		expect(account.textContent).toBe("LLocal");
	});

	it("has no inline search input and no feedback button", async () =>
	{
		await renderSidebar();
		await waitFor(() => screen.getByTestId("sidebar-footer"));

		expect(
			{
				textboxes: screen.queryAllByRole("textbox").length,
				feedback: screen.queryAllByRole(
					"button",
					{
						name: /feedback/i,
					},
				).length,
			},
		).toStrictEqual(
			{
				textboxes: 0,
				feedback: 0,
			},
		);
	});
});
