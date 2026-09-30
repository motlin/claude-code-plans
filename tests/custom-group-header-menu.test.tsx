// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {GroupSection, type SidebarSessionRow, toGroupRow} from "../src/components/sidebar/session-group-section";
import {ToastProvider} from "../src/components/toast";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import type {SessionListItem} from "../src/lib/api/sessions";
import {readSessionGroupState} from "../src/lib/session-group-store";
import type {SessionGroup} from "../src/lib/session-groups";
import {installLocalStorage} from "./fake-storage";

const GROUPS_KEY = "ccp-session-groups";
const GROUPS = [
	{id: "cg-blog", name: "Blog"},
	{id: "cg-gtd", name: "GTD"},
	{id: "cg-alpha", name: "Alpha"},
];

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function listItem(id: string, overrides: Partial<SessionListItem> = {}): SessionListItem {
	return {
		id,
		title: `Session ${id}`,
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
		...overrides,
	};
}

function storeGroups(assignments: Record<string, string> = {}) {
	localStorage.setItem(GROUPS_KEY, JSON.stringify({groups: GROUPS, assignments, order: {}}));
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function renderGroup(groupId: string, rows: SidebarSessionRow[] = []) {
	const name = GROUPS.find((entry) => entry.id === groupId)?.name ?? groupId;
	const group: SessionGroup<SidebarSessionRow> = {
		key: `custom-${groupId}`,
		label: name,
		rows,
		hiddenCount: 0,
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
					<GroupSection group={group} expanded activeItemId={null} filterSlot={null} onShowMore={() => {}} />
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

async function openHeaderMenu(name: string): Promise<HTMLElement> {
	fireEvent.click(screen.getByRole("button", {name: `More options for ${name}`}));
	await flush();
	return await waitFor(() => screen.getByRole("menu"));
}

function menuOutline(menu: HTMLElement): string[] {
	return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((node) =>
		node.getAttribute("role") === "separator" ? "---" : (node.textContent ?? ""),
	);
}

function menuItem(menu: HTMLElement, label: string): HTMLElement {
	const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
		(node) => node.textContent === label,
	);
	if (item === undefined) throw new Error(`No menu item ${label}`);
	return item;
}

async function choose(name: string, label: string) {
	const menu = await openHeaderMenu(name);
	fireEvent.click(menuItem(menu, label));
	await flush();
}

function groupNames(): string[] {
	return readSessionGroupState().groups.map((group) => group.name);
}

beforeEach(() => {
	installLocalStorage();
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("custom group header menu items", () => {
	it("offers every section move for a middle group", async () => {
		storeGroups();
		await renderGroup("cg-gtd");

		expect(menuOutline(await openHeaderMenu("GTD"))).toEqual([
			"Rename group",
			"Icon and color",
			"New group…",
			"---",
			"Move up",
			"Move down",
			"Sort A to Z",
			"---",
			"Delete group",
		]);
	});

	it("hides Move up on the first group", async () => {
		storeGroups();
		await renderGroup("cg-blog");

		expect(menuOutline(await openHeaderMenu("Blog"))).toEqual([
			"Rename group",
			"Icon and color",
			"New group…",
			"---",
			"Move down",
			"Sort A to Z",
			"---",
			"Delete group",
		]);
	});

	it("hides Move down on the last group", async () => {
		storeGroups();
		await renderGroup("cg-alpha");

		expect(menuOutline(await openHeaderMenu("Alpha"))).toEqual([
			"Rename group",
			"Icon and color",
			"New group…",
			"---",
			"Move up",
			"Sort A to Z",
			"---",
			"Delete group",
		]);
	});

	it("drops the section-order block for a lone group", async () => {
		localStorage.setItem(
			GROUPS_KEY,
			JSON.stringify({groups: [{id: "cg-blog", name: "Blog"}], assignments: {}, order: {}}),
		);
		await renderGroup("cg-blog");

		expect(menuOutline(await openHeaderMenu("Blog"))).toEqual([
			"Rename group",
			"Icon and color",
			"New group…",
			"---",
			"Delete group",
		]);
	});

	it("opens the same menu on right-click of the label", async () => {
		storeGroups();
		await renderGroup("cg-gtd");

		fireEvent.contextMenu(screen.getByRole("button", {name: "GTD"}), {
			clientX: 20,
			clientY: 20,
		});
		await flush();

		expect(menuOutline(await waitFor(() => screen.getByRole("menu")))).toEqual([
			"Rename group",
			"Icon and color",
			"New group…",
			"---",
			"Move up",
			"Move down",
			"Sort A to Z",
			"---",
			"Delete group",
		]);
	});

	it("offers Archive all with the count of active rows", async () => {
		storeGroups({s1: "cg-gtd", s2: "cg-gtd", s3: "cg-gtd"});
		await renderGroup("cg-gtd", [
			toGroupRow(listItem("s1")),
			toGroupRow(listItem("s2")),
			toGroupRow(listItem("s3", {archived: true})),
		]);

		expect(menuOutline(await openHeaderMenu("GTD"))).toEqual([
			"Rename group",
			"Icon and color",
			"New group…",
			"---",
			"Move up",
			"Move down",
			"Sort A to Z",
			"---",
			"Archive all (2)",
			"---",
			"Delete group",
		]);
	});
});

describe("custom group section order", () => {
	it("moves a group up", async () => {
		storeGroups();
		await renderGroup("cg-gtd");
		await choose("GTD", "Move up");

		expect(groupNames()).toEqual(["GTD", "Blog", "Alpha"]);
	});

	it("moves a group down", async () => {
		storeGroups();
		await renderGroup("cg-gtd");
		await choose("GTD", "Move down");

		expect(groupNames()).toEqual(["Blog", "Alpha", "GTD"]);
	});

	it("sorts every group A to Z", async () => {
		storeGroups();
		await renderGroup("cg-gtd");
		await choose("GTD", "Sort A to Z");

		expect(groupNames()).toEqual(["Alpha", "Blog", "GTD"]);
	});
});

describe("Rename group", () => {
	async function startRename(): Promise<HTMLInputElement> {
		storeGroups();
		await renderGroup("cg-gtd");
		await choose("GTD", "Rename group");
		const input = await waitFor(() => screen.getByRole("textbox", {name: "Rename group"}));
		return input as HTMLInputElement;
	}

	it("opens an inline input holding the name, selected", async () => {
		const input = await startRename();

		expect(input.value).toBe("GTD");
		expect(document.activeElement).toBe(input);
		expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
	});

	it("saves on Enter", async () => {
		const input = await startRename();
		fireEvent.change(input, {target: {value: "  Getting things done  "}});
		fireEvent.keyDown(input, {key: "Enter"});
		await flush();

		expect(groupNames()).toEqual(["Blog", "Getting things done", "Alpha"]);
		expect(screen.queryByRole("textbox", {name: "Rename group"})).toBeNull();
	});

	it("cancels on Escape", async () => {
		const input = await startRename();
		fireEvent.change(input, {target: {value: "Never"}});
		fireEvent.keyDown(input, {key: "Escape"});
		await flush();

		expect(groupNames()).toEqual(["Blog", "GTD", "Alpha"]);
		expect(screen.queryByRole("textbox", {name: "Rename group"})).toBeNull();
		expect(screen.getByRole("button", {name: "GTD"})).toBeTruthy();
	});

	it("saves on blur", async () => {
		const input = await startRename();
		fireEvent.change(input, {target: {value: "Chores"}});
		fireEvent.blur(input);
		await flush();

		expect(groupNames()).toEqual(["Blog", "Chores", "Alpha"]);
		expect(screen.queryByRole("textbox", {name: "Rename group"})).toBeNull();
	});

	it("keeps the old name when the new one is blank", async () => {
		const input = await startRename();
		fireEvent.change(input, {target: {value: "   "}});
		fireEvent.keyDown(input, {key: "Enter"});
		await flush();

		expect(groupNames()).toEqual(["Blog", "GTD", "Alpha"]);
	});
});

describe("New group…", () => {
	it("creates a group after the others", async () => {
		storeGroups();
		await renderGroup("cg-gtd");
		await choose("GTD", "New group…");
		const input = await waitFor(() => screen.getByRole("textbox", {name: "Group name"}));

		expect(screen.getByRole("dialog").textContent).not.toContain("The list will switch");
		fireEvent.change(input, {target: {value: "Blog 2"}});
		fireEvent.click(screen.getByRole("button", {name: "Create group"}));
		await flush();

		expect(groupNames()).toEqual(["Blog", "GTD", "Alpha", "Blog 2"]);
	});
});

describe("Delete group", () => {
	async function openDelete(assignments: Record<string, string>): Promise<HTMLElement> {
		storeGroups(assignments);
		await renderGroup("cg-gtd");
		await choose("GTD", "Delete group");
		return await waitFor(() => screen.getByRole("alertdialog"));
	}

	function dialogText(dialog: HTMLElement): {title: string; body: string; buttons: string[]} {
		return {
			title: dialog.querySelector("h2")?.textContent ?? "",
			body: dialog.querySelector("p")?.textContent ?? "",
			buttons: [...dialog.querySelectorAll("button")].map((button) => button.textContent ?? ""),
		};
	}

	it("says nothing is in an empty group", async () => {
		expect(dialogText(await openDelete({}))).toEqual({
			title: "Delete group?",
			body: "“GTD” will be removed. Nothing is in it.",
			buttons: ["Cancel", "Delete"],
		});
	});

	it("counts one item in the singular", async () => {
		expect(dialogText(await openDelete({s1: "cg-gtd", s2: "cg-blog"}))).toEqual({
			title: "Delete group?",
			body: "“GTD” will be removed. The 1 item in it will no longer be grouped.",
			buttons: ["Cancel", "Delete"],
		});
	});

	it("counts several items in the plural", async () => {
		expect(dialogText(await openDelete({s1: "cg-gtd", s2: "cg-gtd", s3: "cg-gtd"}))).toEqual({
			title: "Delete group?",
			body: "“GTD” will be removed. The 3 items in it will no longer be grouped.",
			buttons: ["Cancel", "Delete"],
		});
	});

	it("deletes the group and ungroups its sessions on Delete", async () => {
		await openDelete({s1: "cg-gtd", s2: "cg-blog"});
		fireEvent.click(screen.getByRole("button", {name: "Delete"}));
		await flush();

		expect(readSessionGroupState()).toEqual({
			groups: [
				{id: "cg-blog", name: "Blog"},
				{id: "cg-alpha", name: "Alpha"},
			],
			assignments: {s2: "cg-blog"},
			order: {},
		});
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	});

	it("keeps the group on Cancel", async () => {
		await openDelete({s1: "cg-gtd"});
		fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
		await flush();

		expect(groupNames()).toEqual(["Blog", "GTD", "Alpha"]);
		expect(readSessionGroupState().assignments).toEqual({s1: "cg-gtd"});
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	});
});

describe("Archive all", () => {
	it("confirms, archives every active row and toasts the count", async () => {
		fetchMock.mockImplementation(async () => Response.json({archived: true}));
		storeGroups({s1: "cg-gtd", s2: "cg-gtd"});
		await renderGroup("cg-gtd", [toGroupRow(listItem("s1")), toGroupRow(listItem("s2"))]);
		await choose("GTD", "Archive all (2)");
		const dialog = await waitFor(() => screen.getByRole("alertdialog"));

		expect(dialog.querySelector("h2")?.textContent).toBe("Archive all sessions in “GTD”?");
		fireEvent.click(screen.getByRole("button", {name: "Archive"}));
		await flush();
		await flush();

		expect(
			fetchMock.mock.calls.map(([input, init]) => ({
				url: input instanceof Request ? input.url : input.toString(),
				method: init?.method,
			})),
		).toEqual([
			{url: expect.stringMatching(/\/api\/sessions\/s1\/archived$/), method: "PUT"},
			{url: expect.stringMatching(/\/api\/sessions\/s2\/archived$/), method: "PUT"},
		]);
		await waitFor(() => expect(screen.getByText("Archived 2 sessions")).toBeTruthy());
	});
});
