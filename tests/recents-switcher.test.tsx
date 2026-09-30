// @vitest-environment jsdom

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

import {KeyboardShortcutsDialog, setKeyboardShortcutsOpen} from "../src/components/keyboard-shortcuts-dialog";
import {RecentsSwitcher} from "../src/components/recents-switcher";
import {saveRecents, type RecentEntry} from "../src/lib/recents-history";
import {initialIndex, isSwitchTrigger, platformFromUserAgent, step} from "../src/lib/recents-switcher-keys";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
const CHROMEOS_UA = "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36";

const ENTRIES: RecentEntry[] = [
	{key: "session:alpha", kind: "session", href: "/session/alpha", title: "Alpha session"},
	{key: "plan:big-plan", kind: "plan", href: "/plan/big-plan", title: "Big plan"},
	{key: "memory:proj/notes", kind: "memory", href: "/memory/proj/notes"},
];

function keyEvent(init: Partial<KeyboardEvent>) {
	return {
		key: "q",
		code: "KeyQ",
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		shiftKey: false,
		...init,
	};
}

describe("platformFromUserAgent", () => {
	it("classifies mac, windows, linux and ChromeOS", () => {
		expect([MAC_UA, WINDOWS_UA, LINUX_UA, CHROMEOS_UA].map((ua) => platformFromUserAgent(ua))).toStrictEqual([
			"mac",
			"windows",
			"linux",
			"chromeos",
		]);
	});
});

describe("isSwitchTrigger", () => {
	it("accepts ⌃Q and ⌃⇧Q on mac and linux", () => {
		expect([
			isSwitchTrigger(keyEvent({ctrlKey: true}), "mac"),
			isSwitchTrigger(keyEvent({ctrlKey: true, shiftKey: true, key: "Q"}), "mac"),
			isSwitchTrigger(keyEvent({ctrlKey: true}), "linux"),
			isSwitchTrigger(keyEvent({ctrlKey: true, shiftKey: true, key: "Q"}), "linux"),
		]).toStrictEqual([true, true, true, true]);
	});

	it("rejects extra Alt or Meta, a bare Q and other letters", () => {
		expect([
			isSwitchTrigger(keyEvent({ctrlKey: true, altKey: true}), "mac"),
			isSwitchTrigger(keyEvent({ctrlKey: true, metaKey: true}), "mac"),
			isSwitchTrigger(keyEvent({}), "mac"),
			isSwitchTrigger(keyEvent({ctrlKey: true, key: "w", code: "KeyW"}), "mac"),
		]).toStrictEqual([false, false, false, false]);
	});

	it("matches the physical Q key on non-Latin layouts", () => {
		expect(isSwitchTrigger(keyEvent({ctrlKey: true, key: "й"}), "linux")).toBe(true);
	});

	it("uses Alt+Q on windows and never takes ⇧ there", () => {
		expect([
			isSwitchTrigger(keyEvent({altKey: true}), "windows"),
			isSwitchTrigger(keyEvent({ctrlKey: true}), "windows"),
			isSwitchTrigger(keyEvent({altKey: true, shiftKey: true}), "windows"),
		]).toStrictEqual([true, false, false]);
	});

	it("disables ⇧ on ChromeOS, where Ctrl+Shift+Q signs out", () => {
		expect([
			isSwitchTrigger(keyEvent({ctrlKey: true}), "chromeos"),
			isSwitchTrigger(keyEvent({ctrlKey: true, shiftKey: true}), "chromeos"),
		]).toStrictEqual([true, false]);
	});
});

describe("initialIndex and step", () => {
	it("starts on the previous page when the current page leads the list", () => {
		expect([
			initialIndex(ENTRIES, "session:alpha", 1),
			initialIndex(ENTRIES, "session:alpha", -1),
			initialIndex(ENTRIES, "project:elsewhere", 1),
			initialIndex(ENTRIES, null, -1),
			initialIndex(ENTRIES.slice(0, 1), "session:alpha", 1),
		]).toStrictEqual([1, 2, 0, 2, 0]);
	});

	it("wraps in both directions", () => {
		expect([step(1, 1, 3), step(2, 1, 3), step(0, -1, 3), step(1, -1, 3)]).toStrictEqual([2, 0, 2, 0]);
	});
});

function renderApp(initialPath = "/session/alpha") {
	const rootRoute = createRootRoute({
		component: () => (
			<>
				<RecentsSwitcher />
				<KeyboardShortcutsDialog />
				<Outlet />
			</>
		),
	});
	const pageRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "$",
		component: () => <div>page</div>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([pageRoute]),
		history: createMemoryHistory({initialEntries: [initialPath]}),
	});
	render(<RouterProvider router={router} />);
	return router;
}

function pressQ(init: KeyboardEventInit = {ctrlKey: true}, target: Element = document.body) {
	fireEvent.keyDown(target, {key: "q", code: "KeyQ", ...init});
}

function releaseControl() {
	fireEvent.keyUp(document.body, {key: "Control", code: "ControlLeft"});
}

function selectedRow(): {active: string | null; title: string | null} {
	const listbox = screen.getByRole("listbox", {name: "Recents"});
	const selected = within(listbox)
		.getAllByRole("option")
		.find((option) => option.getAttribute("aria-selected") === "true");
	return {
		active: listbox.getAttribute("aria-activedescendant"),
		title: selected?.textContent ?? null,
	};
}

describe("RecentsSwitcher", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
		saveRecents(ENTRIES);
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		Element.prototype.scrollIntoView = () => {};
	});

	afterEach(() => {
		act(() => setKeyboardShortcutsOpen(false));
		cleanup();
		vi.restoreAllMocks();
	});

	it("selects exactly the previous entry on ⌃Q", async () => {
		renderApp();
		await screen.findByText("page");

		pressQ();

		const dialog = await screen.findByRole("dialog", {name: "Recents"});
		expect({
			rows: within(dialog)
				.getAllByRole("option")
				.map((option) => [option.id, option.textContent]),
			selected: selectedRow(),
		}).toStrictEqual({
			rows: [
				["recents-switcher-row-0", "Alpha session"],
				["recents-switcher-row-1", "Big plan"],
				["recents-switcher-row-2", "Untitled"],
			],
			selected: {active: "recents-switcher-row-1", title: "Big plan"},
		});
	});

	it("walks to index 2 on a second ⌃Q and wraps both ways", async () => {
		renderApp();
		await screen.findByText("page");

		pressQ();
		await screen.findByRole("dialog", {name: "Recents"});
		pressQ();
		const second = selectedRow();
		pressQ();
		const wrapped = selectedRow();
		pressQ({ctrlKey: true, shiftKey: true, key: "Q"});
		const reversed = selectedRow();

		expect([second.active, wrapped.active, reversed.active]).toStrictEqual([
			"recents-switcher-row-2",
			"recents-switcher-row-0",
			"recents-switcher-row-2",
		]);
	});

	it("opens on the oldest entry with ⌃⇧Q", async () => {
		renderApp();
		await screen.findByText("page");

		pressQ({ctrlKey: true, shiftKey: true, key: "Q"});

		await screen.findByRole("dialog", {name: "Recents"});
		expect(selectedRow().active).toBe("recents-switcher-row-2");
	});

	it("moves with ↑/↓ while open", async () => {
		renderApp();
		await screen.findByText("page");
		pressQ();
		await screen.findByRole("dialog", {name: "Recents"});

		fireEvent.keyDown(document.body, {key: "ArrowDown", ctrlKey: true});
		const down = selectedRow().active;
		fireEvent.keyDown(document.body, {key: "ArrowUp", ctrlKey: true});
		fireEvent.keyDown(document.body, {key: "ArrowUp", ctrlKey: true});

		expect([down, selectedRow().active]).toStrictEqual(["recents-switcher-row-2", "recents-switcher-row-0"]);
	});

	it("navigates to the exact href when Control is released", async () => {
		const router = renderApp();
		await screen.findByText("page");

		pressQ();
		await screen.findByRole("dialog", {name: "Recents"});
		pressQ();
		releaseControl();

		await waitFor(() => expect(router.state.location.pathname).toBe("/memory/proj/notes"));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("commits on Enter", async () => {
		const router = renderApp();
		await screen.findByText("page");

		pressQ();
		await screen.findByRole("dialog", {name: "Recents"});
		fireEvent.keyDown(document.body, {key: "Enter", ctrlKey: true});

		await waitFor(() => expect(router.state.location.pathname).toBe("/plan/big-plan"));
	});

	it("closes without navigating on Esc", async () => {
		const router = renderApp();
		await screen.findByText("page");

		pressQ();
		await screen.findByRole("dialog", {name: "Recents"});
		fireEvent.keyDown(document.body, {key: "Escape", ctrlKey: true});
		releaseControl();

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(router.state.location.pathname).toBe("/session/alpha");
	});

	it("closes without navigating on window blur", async () => {
		const router = renderApp();
		await screen.findByText("page");

		pressQ();
		await screen.findByRole("dialog", {name: "Recents"});
		fireEvent.blur(window);

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(router.state.location.pathname).toBe("/session/alpha");
	});

	it("does not navigate when committing the current page", async () => {
		const router = renderApp();
		await screen.findByText("page");
		const navigate = vi.spyOn(router, "navigate");

		pressQ();
		await screen.findByRole("dialog", {name: "Recents"});
		pressQ();
		pressQ();
		releaseControl();

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(navigate).not.toHaveBeenCalled();
	});

	it("shows no dialog when the history is empty", async () => {
		window.sessionStorage.clear();
		renderApp();
		await screen.findByText("page");

		pressQ();

		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("ignores ⌃Q typed inside a terminal", async () => {
		renderApp();
		await screen.findByText("page");
		const terminal = document.createElement("div");
		terminal.setAttribute("data-terminal", "");
		const inner = document.createElement("textarea");
		terminal.append(inner);
		document.body.append(terminal);

		pressQ({ctrlKey: true}, inner);

		expect(screen.queryByRole("dialog")).toBeNull();
		terminal.remove();
	});

	it("opens on Alt+Q and ignores Ctrl+Q on windows", async () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(WINDOWS_UA);
		const router = renderApp();
		await screen.findByText("page");

		pressQ({ctrlKey: true});
		const afterCtrl = screen.queryByRole("dialog");
		pressQ({altKey: true});
		await screen.findByRole("dialog", {name: "Recents"});
		fireEvent.keyUp(document.body, {key: "Alt", code: "AltLeft"});

		expect(afterCtrl).toBeNull();
		await waitFor(() => expect(router.state.location.pathname).toBe("/plan/big-plan"));
	});

	it("is listed in the shortcuts dialog as Switch between recents ⌃Q", async () => {
		renderApp();
		await screen.findByText("page");

		act(() => setKeyboardShortcutsOpen(true));

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const row = within(dialog).getByText("Switch between recents").parentElement;
		expect([...(row?.querySelectorAll("kbd") ?? [])].map((kbd) => kbd.textContent ?? "")).toStrictEqual([
			"⌃Control",
			"Q",
		]);
	});

	it("is listed in the shortcuts dialog as Alt+Q on windows", async () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(WINDOWS_UA);
		renderApp();
		await screen.findByText("page");

		act(() => setKeyboardShortcutsOpen(true));

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const row = within(dialog).getByText("Switch between recents").parentElement;
		expect([...(row?.querySelectorAll("kbd") ?? [])].map((kbd) => kbd.textContent ?? "")).toStrictEqual([
			"Alt",
			"Q",
		]);
	});
});
