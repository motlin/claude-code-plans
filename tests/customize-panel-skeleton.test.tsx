// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {CustomizeListRowsSkeleton, CustomizePanelSkeleton} from "../src/components/customize/customize-panel-skeleton";
import {SkillsSection} from "../src/components/customize/section-views";
import {SettingsDialog} from "../src/components/settings/settings-dialog";
import {SettingsProvider} from "../src/components/settings-provider";
import {ThemeProvider} from "../src/components/theme-provider";
import {ToastProvider} from "../src/components/toast";
import {installLocalStorage} from "./fake-storage";

// The Customize panel module never finishes loading, so the dialog stays on its Suspense fallback.
vi.mock("../src/components/settings/customize-dialog-panel-loader", () => ({
	preloadCustomizeDialogPanel: async () => new Promise(() => {}),
	loadedCustomizeDialogPanel: () => undefined,
}));

const SKELETON_CLASS =
	"relative max-w-full overflow-hidden bg-[var(--skeleton-base)] after:absolute after:inset-0 after:animate-[shimmer_2s_linear_infinite] after:bg-[linear-gradient(90deg,transparent,var(--skeleton-sheen),transparent)] motion-reduce:after:hidden";

function bar(width: string): string {
	return `${SKELETON_CLASS} h-[1em] rounded ${width}`;
}

const ROW_CLASS = "flex items-center gap-3 -mx-2 self-stretch px-2 py-2";

/** Each skeleton row as its classes, then every skeleton bar inside it. */
function rowOutline(container: HTMLElement): string[][] {
	return [...container.querySelectorAll<HTMLElement>(`[data-testid="list-rows-skeleton-row"]`)].map((row) => [
		row.className,
		...[...row.querySelectorAll<HTMLElement>('[data-cds="Skeleton"]')].map((skeleton) => skeleton.className),
		...[...row.querySelectorAll<HTMLElement>(".size-8")].map((spacer) => `spacer ${spacer.className}`),
	]);
}

const EXPECTED_ROWS = [
	["w-28", "w-3/5"],
	["w-36", "w-2/3"],
	["w-24", "w-1/2"],
	["w-32", "w-3/5"],
	["w-40", "w-2/3"],
	["w-28", "w-1/2"],
].map(([title = "", subtitle = ""]) => [
	ROW_CLASS,
	`${SKELETON_CLASS} size-9 shrink-0 rounded-card`,
	bar(title),
	bar(subtitle),
	bar("w-10"),
	"spacer size-8",
]);

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
	vi.stubGlobal("fetch", async () => new Promise(() => {}));
}

function renderWithProviders(children: () => React.ReactNode, initialEntry = "/") {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ThemeProvider>
					<SettingsProvider>
						<ToastProvider>{children()}</ToastProvider>
					</SettingsProvider>
				</ThemeProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: [initialEntry]}),
	});
	render(<RouterProvider router={router} />);
	return router;
}

describe("Customize panel skeleton", () => {
	beforeEach(() => {
		stubBrowser();
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("renders upstream's heading bar and six default-density rows", () => {
		const {container} = render(<CustomizeListRowsSkeleton />);

		const heading = container.querySelector<HTMLElement>('[data-testid="list-rows-skeleton-heading"]');
		expect({
			heading: heading?.className,
			bar: heading?.querySelector<HTMLElement>('[data-cds="Skeleton"]')?.className,
			ariaHidden: heading?.getAttribute("aria-hidden"),
			rows: rowOutline(container),
		}).toStrictEqual({
			heading: "flex min-h-7 items-center",
			bar: bar("w-32"),
			ariaHidden: "true",
			rows: EXPECTED_ROWS,
		});
	});

	it("gives every skeleton a shimmering bar with an sr-only Loading status", () => {
		const {container} = render(<CustomizeListRowsSkeleton />);

		const skeletons = [...container.querySelectorAll<HTMLElement>('[data-cds="Skeleton"]')];
		expect({
			count: skeletons.length,
			shapes: [...new Set(skeletons.map((skeleton) => skeleton.outerHTML.replace(/class="[^"]*"/, "")))],
		}).toStrictEqual({
			count: 25,
			shapes: ['<div data-cds="Skeleton" role="status" ><span class="sr-only">Loading</span></div>'],
		});
	});

	it("wraps the panel skeleton in a busy region with a Loading status and the section title", () => {
		const {container} = render(<CustomizePanelSkeleton title="Skills" />);

		const busy = container.firstElementChild as HTMLElement;
		const panel = screen.getByTestId("customize-panel-skeleton");
		expect({
			busy: [busy.getAttribute("aria-busy"), busy.dataset["testid"], busy.className],
			panel: panel.className,
			status: [...panel.children].find((child) => child.tagName === "SPAN")?.outerHTML,
			title: panel.querySelector("header h2")?.outerHTML,
			rows: rowOutline(container).length,
		}).toStrictEqual({
			busy: ["true", "settings-content-skeleton", "relative flex min-h-0 flex-1 flex-col"],
			panel: "flex h-full min-h-0 flex-1 flex-col pt-1",
			status: '<span role="status" class="sr-only">Loading</span>',
			title: '<h2 class="min-w-0 truncate text-[20px]/[25px] font-[580] text-primary">Skills</h2>',
			rows: 6,
		});
	});

	it("shows the panel skeleton while the lazy Customize module loads", async () => {
		renderWithProviders(() => <SettingsDialog />, "/#customize/plugins/yours");

		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const busy = dialog.querySelector<HTMLElement>('[data-testid="settings-content-skeleton"]');
		expect({
			busy: busy?.getAttribute("aria-busy"),
			title: busy?.querySelector("header h2")?.textContent,
			rows: busy === null ? 0 : rowOutline(busy).length,
		}).toStrictEqual({busy: "true", title: "Plugins", rows: 6});
	});

	it("shows the skeleton rows instead of Loading text while the skills query is pending", async () => {
		renderWithProviders(() => <SkillsSection search={{}} />);

		const busy = await screen.findByTestId("customize-section-skeleton");
		expect({
			busy: busy.getAttribute("aria-busy"),
			status: busy.querySelector(":scope > [role=status]")?.outerHTML,
			rows: rowOutline(busy),
			loadingText: screen.queryByText("Loading skills…"),
		}).toStrictEqual({
			busy: "true",
			status: '<span role="status" class="sr-only">Loading</span>',
			rows: EXPECTED_ROWS,
			loadingText: null,
		});
	});

	it("keeps the previous panel dimmed instead of flashing the skeleton while switching to an unloaded section", async () => {
		renderWithProviders(() => <SettingsDialog />, "/#settings/general");

		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const generalSection = dialog.querySelector("section[data-settings-section-titled]");
		fireEvent.click(screen.getByRole("button", {name: "Skills"}));
		await waitFor(() => {
			expect(screen.getByRole("button", {name: "Skills"}).getAttribute("aria-current")).toBe("page");
		});

		const scroll = generalSection?.closest<HTMLElement>(".overflow-y-auto");
		expect({
			stillShown: generalSection?.isConnected,
			busy: scroll?.getAttribute("aria-busy"),
			className: scroll?.className,
			skeleton: dialog.querySelector('[data-testid="settings-content-skeleton"]'),
		}).toStrictEqual({
			stillShown: true,
			busy: "true",
			className:
				"flex-1 space-y-6 overflow-y-auto px-6 pt-2 pb-4 [scrollbar-gutter:stable] opacity-60 transition-opacity",
			skeleton: null,
		});
	});
});
