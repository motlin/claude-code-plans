// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {GroupSection, type SidebarSessionRow} from "../src/components/sidebar/session-group-section";
import {ToastProvider} from "../src/components/toast";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {readProjectAppearance} from "../src/lib/project-appearance-store";
import {readSessionGroupState} from "../src/lib/session-group-store";
import type {SessionGroup} from "../src/lib/session-groups";
import {installLocalStorage} from "./fake-storage";

const GROUPS_KEY = "ccp-session-groups";
const PROJECT_APPEARANCE_KEY = "ccp-project-appearance";

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function renderSection(key: string, label: string) {
	const group: SessionGroup<SidebarSessionRow> = {
		key,
		label,
		rows: [],
		hiddenCount: 0,
		canShowLess: false,
		nested: new Map(),
	};
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<GroupSection
						group={group}
						expanded
						activeItemId={null}
						filterSlot={null}
						onShowMore={() => {}}
						onShowLess={() => {}}
					/>
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await flush();
}

/** The header's appearance mark, as `icon/color` (`-` when unset), or null without one. */
function headerMark(): string | null {
	const mark = document.querySelector("[data-sidebar-group-label] [data-group-appearance]");
	if (mark === null) return null;
	return `${mark.getAttribute("data-group-icon") ?? "-"}/${mark.getAttribute("data-group-color") ?? "-"}`;
}

async function openAppearanceSubmenu(label: string): Promise<HTMLElement> {
	fireEvent.click(screen.getByRole("button", {name: `More options for ${label}`}));
	await flush();
	const trigger = await waitFor(() => screen.getByRole("menuitem", {name: "Icon and color"}));
	act(() => trigger.focus());
	fireEvent.keyDown(trigger, {key: "ArrowRight"});
	await flush();
	const menus = screen.getAllByRole("menu");
	expect(menus).toHaveLength(2);
	return menus[1]!;
}

function submenuOutline(menu: HTMLElement): string[] {
	return [...menu.querySelectorAll('[role="menuitemradio"], [role="separator"]')].map((node) =>
		node.getAttribute("role") === "separator"
			? "---"
			: `${node.textContent ?? ""} (${node.getAttribute("aria-checked") ?? ""})`,
	);
}

function radio(menu: HTMLElement, label: string): HTMLElement {
	const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
		(node) => node.textContent === label,
	);
	if (item === undefined) throw new Error(`No radio ${label}`);
	return item;
}

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	cleanup();
});

describe("section header appearance", () => {
	it("renders a custom group's icon and color on its header", async () => {
		localStorage.setItem(
			GROUPS_KEY,
			JSON.stringify({
				groups: [{id: "cg-blog", name: "Blog", icon: "rocket", color: "blue"}],
				assignments: {},
				order: {},
			}),
		);
		await renderSection("custom-cg-blog", "Blog");

		expect(headerMark()).toBe("rocket/blue");
	});

	it("renders a color-only custom group as a colored dot", async () => {
		localStorage.setItem(
			GROUPS_KEY,
			JSON.stringify({
				groups: [{id: "cg-blog", name: "Blog", color: "pink"}],
				assignments: {},
				order: {},
			}),
		);
		await renderSection("custom-cg-blog", "Blog");

		expect(headerMark()).toBe("-/pink");
	});

	it("renders no mark for a group without an appearance", async () => {
		localStorage.setItem(
			GROUPS_KEY,
			JSON.stringify({groups: [{id: "cg-blog", name: "Blog"}], assignments: {}, order: {}}),
		);
		await renderSection("custom-cg-blog", "Blog");

		expect(headerMark()).toBeNull();
	});

	it("renders a project section's appearance from the projects map", async () => {
		localStorage.setItem(PROJECT_APPEARANCE_KEY, JSON.stringify({"project-alpha": {icon: "code", color: "green"}}));
		await renderSection("project-alpha", "alpha");

		expect(headerMark()).toBe("code/green");
	});

	it("gives date sections no appearance menu", async () => {
		await renderSection("date-today", "Today");

		expect(screen.queryByRole("button", {name: "More options for Today"})).toBeNull();
	});
});

describe("appearance picker", () => {
	it("lists icons and colors with the current choices checked", async () => {
		localStorage.setItem(
			GROUPS_KEY,
			JSON.stringify({
				groups: [{id: "cg-blog", name: "Blog", icon: "star"}],
				assignments: {},
				order: {},
			}),
		);
		await renderSection("custom-cg-blog", "Blog");

		expect(submenuOutline(await openAppearanceSubmenu("Blog"))).toEqual([
			"None (false)",
			"Folder (false)",
			"Star (true)",
			"Heart (false)",
			"Flag (false)",
			"Bookmark (false)",
			"Bolt (false)",
			"Code (false)",
			"Bug (false)",
			"Rocket (false)",
			"Book (false)",
			"Briefcase (false)",
			"Home (false)",
			"---",
			"Default (true)",
			"Gray (false)",
			"Red (false)",
			"Orange (false)",
			"Yellow (false)",
			"Green (false)",
			"Teal (false)",
			"Blue (false)",
			"Purple (false)",
			"Pink (false)",
		]);
	});

	it("sets and clears a custom group's icon and color", async () => {
		localStorage.setItem(
			GROUPS_KEY,
			JSON.stringify({groups: [{id: "cg-blog", name: "Blog"}], assignments: {}, order: {}}),
		);
		await renderSection("custom-cg-blog", "Blog");

		const submenu = await openAppearanceSubmenu("Blog");
		fireEvent.click(radio(submenu, "Rocket"));
		await flush();
		fireEvent.click(radio(submenu, "Purple"));
		await flush();
		const set = {stored: readSessionGroupState().groups, mark: headerMark()};
		fireEvent.click(radio(submenu, "None"));
		await flush();

		expect({set, cleared: readSessionGroupState().groups, mark: headerMark()}).toStrictEqual({
			set: {
				stored: [{id: "cg-blog", name: "Blog", icon: "rocket", color: "purple"}],
				mark: "rocket/purple",
			},
			cleared: [{id: "cg-blog", name: "Blog", color: "purple"}],
			mark: "-/purple",
		});
	});

	it("sets a project section's appearance in the projects map", async () => {
		await renderSection("project-alpha", "alpha");

		const submenu = await openAppearanceSubmenu("alpha");
		fireEvent.click(radio(submenu, "Bug"));
		await flush();

		expect({stored: readProjectAppearance(), mark: headerMark()}).toStrictEqual({
			stored: {"project-alpha": {icon: "bug"}},
			mark: "bug/-",
		});
	});
});
