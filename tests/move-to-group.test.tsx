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
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {SessionActionsMenu} from "../src/components/session-actions-menu";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import type {SessionListItem} from "../src/lib/api/sessions";
import {readSessionGroupState} from "../src/lib/session-group-store";
import {DEFAULT_SESSION_LIST_PREFS, type SessionListPrefs} from "../src/lib/session-groups";
import {getSessionMenuItems, type SessionMenuCapability, type SessionMenuSession} from "../src/lib/session-menu-items";
import {installLocalStorage} from "./fake-storage";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const PREFS_KEY = "ccp-session-list-prefs";
const GROUPS_KEY = "ccp-session-groups";
const GROUPS = [
	{id: "cg-blog", name: "Blog"},
	{id: "cg-gtd", name: "GTD"},
];

const CAPABILITIES: ReadonlySet<SessionMenuCapability> = new Set<SessionMenuCapability>([
	"rename",
	"archive",
	"customGroups",
]);

function menuSession(overrides: Partial<SessionMenuSession> = {}): SessionMenuSession {
	return {
		title: "Fix the flaky test",
		pinned: false,
		readState: "read",
		archived: false,
		prUrl: null,
		hasLivePane: false,
		forkDisabledReason: null,
		cwd: null,
		bridgeSessionId: null,
		...overrides,
	};
}

describe("getSessionMenuItems Move to group", () => {
	it("puts Move to group between the actions and Archive on rows", () => {
		expect(
			getSessionMenuItems(menuSession({customGroup: {groups: GROUPS, current: null}}), CAPABILITIES, {
				surface: "row",
			}),
		).toEqual([
			{kind: "item", id: "rename", label: "Rename", accelerator: "r"},
			{kind: "separator"},
			{
				kind: "item",
				id: "move-to-group",
				label: "Move to group",
				submenu: [
					{
						kind: "item",
						id: "move-to-custom-group",
						label: "Blog",
						groupId: "cg-blog",
						checked: false,
						accelerator: "1",
					},
					{
						kind: "item",
						id: "move-to-custom-group",
						label: "GTD",
						groupId: "cg-gtd",
						checked: false,
						accelerator: "2",
					},
					{kind: "separator"},
					{kind: "item", id: "new-group", label: "New group…", accelerator: "3"},
				],
			},
			{kind: "separator"},
			{kind: "item", id: "archive", label: "Archive", accelerator: "a"},
		]);
	});

	it("checks the current group and offers Ungrouped only for a grouped row", () => {
		const [, , moveToGroup] = getSessionMenuItems(
			menuSession({customGroup: {groups: GROUPS, current: "cg-gtd"}}),
			CAPABILITIES,
			{surface: "row"},
		);

		expect(moveToGroup).toEqual({
			kind: "item",
			id: "move-to-group",
			label: "Move to group",
			submenu: [
				{
					kind: "item",
					id: "move-to-custom-group",
					label: "Blog",
					groupId: "cg-blog",
					checked: false,
					accelerator: "1",
				},
				{
					kind: "item",
					id: "move-to-custom-group",
					label: "GTD",
					groupId: "cg-gtd",
					checked: true,
					accelerator: "2",
				},
				{kind: "separator"},
				{kind: "item", id: "ungroup", label: "Ungrouped", checked: false, accelerator: "3"},
				{kind: "item", id: "new-group", label: "New group…", accelerator: "4"},
			],
		});
	});

	it("offers only New group… when there are no groups", () => {
		const [, , moveToGroup] = getSessionMenuItems(
			menuSession({customGroup: {groups: [], current: null}}),
			CAPABILITIES,
			{surface: "row"},
		);

		expect(moveToGroup).toEqual({
			kind: "item",
			id: "move-to-group",
			label: "Move to group",
			submenu: [{kind: "item", id: "new-group", label: "New group…", accelerator: "1"}],
		});
	});

	it("numbers only the first nine entries", () => {
		const groups = Array.from({length: 10}, (_, index) => ({
			id: `cg-${index}`,
			name: `Group ${index}`,
		}));
		const [, , moveToGroup] = getSessionMenuItems(
			menuSession({customGroup: {groups, current: null}}),
			CAPABILITIES,
			{surface: "row"},
		);

		expect(
			moveToGroup?.kind === "item"
				? moveToGroup.submenu?.map((entry) => (entry.kind === "item" ? entry.accelerator : "---"))
				: undefined,
		).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", undefined, "---", undefined]);
	});

	it("leaves Move to group off the header menu", () => {
		expect(
			getSessionMenuItems(menuSession({customGroup: {groups: GROUPS, current: null}}), CAPABILITIES, {
				surface: "header",
			}).map((entry) => (entry.kind === "separator" ? "---" : entry.id)),
		).toEqual(["rename", "---", "archive"]);
	});
});

function listItem(): SessionListItem {
	return {
		id: SESSION_ID,
		title: "Fix the flaky test",
		mtime: "2026-09-28T10:00:00.000Z",
		created: "2026-09-28T09:00:00.000Z",
		project: "-projects-alpha",
		projectName: "alpha",
		messageCount: 4,
		archived: false,
		state: "ended",
		bucket: "done",
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
	};
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function storeGroups(assignments: Record<string, string> = {}) {
	localStorage.setItem(GROUPS_KEY, JSON.stringify({groups: GROUPS, assignments, order: {}}));
}

function storePrefs(prefs: Partial<SessionListPrefs>) {
	localStorage.setItem(PREFS_KEY, JSON.stringify({...DEFAULT_SESSION_LIST_PREFS, ...prefs}));
}

function storedPrefs(): unknown {
	const raw = localStorage.getItem(PREFS_KEY);
	return raw === null ? null : JSON.parse(raw);
}

async function renderRow() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	const session = listItem();
	const rootRoute = createRootRoute({
		component: () => (
			<SettingsProvider>
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<SessionActionsMenu session={session}>
							<a href={`/session/${session.id}`}>Row title</a>
						</SessionActionsMenu>
						<Outlet />
					</ToastProvider>
				</QueryClientProvider>
			</SettingsProvider>
		),
	});
	const homeRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([homeRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await waitFor(() => expect(screen.getByText("Row title")).toBeTruthy());
}

async function openMoveToGroup(): Promise<HTMLElement> {
	fireEvent.contextMenu(screen.getByText("Row title"), {clientX: 40, clientY: 50});
	await flush();
	const trigger = screen.getByRole("menuitem", {name: /^Move to group/});
	expect(trigger.getAttribute("data-testid")).toBe("move-to-group-trigger");
	act(() => trigger.focus());
	fireEvent.keyDown(trigger, {key: "ArrowRight"});
	await flush();
	const menus = screen.getAllByRole("menu");
	expect(menus).toHaveLength(2);
	return menus[1]!;
}

function submenuOutline(menu: HTMLElement): string[] {
	return [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="separator"]')].map((node) => {
		if (node.getAttribute("role") === "separator") return "---";
		const checked = node.getAttribute("aria-checked");
		const state = checked === null ? "" : ` (${checked})`;
		return `${node.textContent ?? ""} [${node.getAttribute("aria-keyshortcuts") ?? ""}]${state}`;
	});
}

async function openNewGroupDialog(): Promise<HTMLElement> {
	const submenu = await openMoveToGroup();
	const newGroup = [...submenu.querySelectorAll('[role="menuitem"]')].find(
		(node) => node.getAttribute("data-testid") === "new-custom-group",
	);
	expect(newGroup).toBeDefined();
	fireEvent.click(newGroup!);
	await flush();
	return await waitFor(() => screen.getByRole("dialog"));
}

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	cleanup();
});

describe("SessionActionsMenu Move to group", () => {
	it("lists the groups as radios for an ungrouped row", async () => {
		storeGroups();
		await renderRow();

		expect(submenuOutline(await openMoveToGroup())).toEqual([
			"Blog1 [1] (false)",
			"GTD2 [2] (false)",
			"---",
			"New group…3 [3]",
		]);
	});

	it("checks the current group and offers Ungrouped for a grouped row", async () => {
		storeGroups({[SESSION_ID]: "cg-blog"});
		await renderRow();

		expect(submenuOutline(await openMoveToGroup())).toEqual([
			"Blog1 [1] (true)",
			"GTD2 [2] (false)",
			"---",
			"Ungrouped3 [3] (false)",
			"New group…4 [4]",
		]);
	});

	it("moves the row into a group with its digit and closes the menu", async () => {
		storeGroups();
		await renderRow();
		const submenu = await openMoveToGroup();

		fireEvent.keyDown(submenu, {key: "2"});
		await flush();

		expect(readSessionGroupState().assignments).toEqual({[SESSION_ID]: "cg-gtd"});
		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("returns a grouped row to Ungrouped", async () => {
		storeGroups({[SESSION_ID]: "cg-blog"});
		await renderRow();
		const submenu = await openMoveToGroup();

		fireEvent.keyDown(submenu, {key: "3"});
		await flush();

		expect(readSessionGroupState().assignments).toEqual({});
	});
});

describe("New group dialog", () => {
	it("creates a group, moves the row into it and switches Group by to custom", async () => {
		storeGroups();
		await renderRow();
		const dialog = await openNewGroupDialog();

		expect(dialog.querySelector("h2")?.textContent).toBe("New group");
		expect(dialog.textContent).toContain("The list will switch to Custom groups to show it.");
		const input = screen.getByRole("textbox", {name: "Group name"});
		expect(input.getAttribute("placeholder")).toBe("Group name");
		await waitFor(() => expect(document.activeElement).toBe(input));
		const create = screen.getByRole("button", {name: "Create and group by custom"});
		expect(create.hasAttribute("disabled")).toBe(true);

		fireEvent.change(input, {target: {value: "   "}});
		expect(create.hasAttribute("disabled")).toBe(true);
		fireEvent.change(input, {target: {value: "  Upstream sync  "}});
		expect(create.hasAttribute("disabled")).toBe(false);
		fireEvent.click(create);
		await flush();

		const state = readSessionGroupState();
		const created = state.groups.at(-1);
		expect(state.groups.map((group) => group.name)).toEqual(["Blog", "GTD", "Upstream sync"]);
		expect(state.assignments).toEqual({[SESSION_ID]: created?.id});
		expect(storedPrefs()).toEqual({...DEFAULT_SESSION_LIST_PREFS, groupBy: "custom"});
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("reads Create group without the switch note when already grouped by custom", async () => {
		storeGroups();
		storePrefs({groupBy: "custom", sortBy: "name"});
		await renderRow();
		const dialog = await openNewGroupDialog();

		expect(dialog.textContent).not.toContain("The list will switch");
		fireEvent.change(screen.getByRole("textbox", {name: "Group name"}), {
			target: {value: "Blog 2"},
		});
		fireEvent.submit(screen.getByRole("textbox", {name: "Group name"}));
		await flush();

		expect(readSessionGroupState().groups.map((group) => group.name)).toEqual(["Blog", "GTD", "Blog 2"]);
		expect(storedPrefs()).toEqual({
			...DEFAULT_SESSION_LIST_PREFS,
			groupBy: "custom",
			sortBy: "name",
		});
		expect(screen.queryByRole("button", {name: "Create and group by custom"})).toBeNull();
	});

	it("cancels with Escape without creating a group", async () => {
		storeGroups();
		await renderRow();
		await openNewGroupDialog();

		fireEvent.change(screen.getByRole("textbox", {name: "Group name"}), {
			target: {value: "Never"},
		});
		fireEvent.keyDown(screen.getByRole("textbox", {name: "Group name"}), {key: "Escape"});
		await flush();

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(readSessionGroupState().groups.map((group) => group.name)).toEqual(["Blog", "GTD"]);
		expect(storedPrefs()).toBeNull();
	});
});
