// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SettingsProvider} from "../src/components/settings-provider";
import {TitlebarWidthContext} from "../src/components/titlebar-width";
import {
	hiddenToggleCount,
	SessionPaneControls,
	type ViewOptionsFacts,
	viewOptionsItems,
} from "../src/components/view-options-menu";
import type {PaneKind} from "../src/lib/pane-layout";
import {installLocalStorage} from "./fake-storage";

class FakeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

const unregisters: Array<() => void> = [];

function registerKinds(...kinds: PaneKind[]): void {
	for (const kind of kinds) {
		unregisters.push(registerPane(kind, {title: kind, render: () => <p>{`${kind} pane body`}</p>}));
	}
}

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({x: 0, y: 0, width: 1200, height: 800}),
	);
});

afterEach(() => {
	for (const unregister of unregisters.splice(0)) unregister();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("viewOptionsItems", () => {
	const ALL_KINDS: ReadonlySet<PaneKind> = new Set<PaneKind>([
		"artifacts",
		"files",
		"links",
		"background-tasks",
		"plan",
		"subagents",
	]);

	function visible(
		registered: ReadonlySet<PaneKind>,
		facts: ViewOptionsFacts,
		open: readonly PaneKind[] = [],
	): Array<[PaneKind, number | null]> {
		return viewOptionsItems({
			registered,
			isOpen: (kind) => open.includes(kind),
			facts,
		}).map((item) => [item.kind, item.badge ?? null]);
	}

	it("lists every applicable registered pane in upstream order", () => {
		expect(
			visible(ALL_KINDS, {
				artifactCount: 2,
				hasPlan: true,
				backgroundTasks: {total: 3, running: 1},
				subagentCount: 4,
			}),
		).toStrictEqual([
			["artifacts", null],
			["files", null],
			["links", null],
			["background-tasks", 1],
			["plan", null],
			["subagents", null],
		]);
	});

	it("hides panes that do not apply to the session", () => {
		expect(visible(ALL_KINDS, {})).toStrictEqual([
			["files", null],
			["links", null],
		]);
	});

	it("keeps a pane that no longer applies while it is open", () => {
		expect(visible(ALL_KINDS, {}, ["artifacts", "plan"])).toStrictEqual([
			["artifacts", null],
			["files", null],
			["links", null],
			["plan", null],
		]);
	});

	it("shows no badge when no background task is running", () => {
		expect(
			visible(new Set<PaneKind>(["background-tasks"]), {
				backgroundTasks: {total: 2, running: 0},
			}),
		).toStrictEqual([["background-tasks", null]]);
	});

	it("hides items for panes that are not registered", () => {
		expect(
			visible(new Set<PaneKind>(["files"]), {
				artifactCount: 2,
				hasPlan: true,
				backgroundTasks: {total: 3, running: 1},
				subagentCount: 4,
			}),
		).toStrictEqual([["files", null]]);
	});
});

describe("hiddenToggleCount", () => {
	it.each([
		{width: null, extras: 0, count: 2, hidden: 0},
		{width: 1000, extras: 0, count: 2, hidden: 0},
		{width: 325, extras: 0, count: 2, hidden: 1},
		{width: 300, extras: 0, count: 2, hidden: 2},
		{width: 1000, extras: 650, count: 2, hidden: 1},
		{width: 100, extras: 0, count: 0, hidden: 0},
	])("titlebar $width with extras $extras folds $hidden of $count", (row) => {
		expect(hiddenToggleCount({titlebarWidth: row.width, extrasWidth: row.extras, count: row.count})).toBe(
			row.hidden,
		);
	});
});

function renderControls(width: number | null, facts: ViewOptionsFacts = {}) {
	return render(
		<SettingsProvider>
			<TileHost sessionId="view-options">
				<TitlebarWidthContext.Provider value={width}>
					<SessionPaneControls facts={facts} />
				</TitlebarWidthContext.Provider>
			</TileHost>
		</SettingsProvider>,
	);
}

async function openViewOptions() {
	fireEvent.click(screen.getByRole("button", {name: "View options"}));
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function menuRows(): Array<[string | null, string, string | null]> {
	const menu = screen.getByRole("menu");
	return [...menu.querySelectorAll<HTMLElement>("[role^=menuitem]")].map((item) => [
		item.getAttribute("role"),
		item.textContent ?? "",
		item.getAttribute("aria-checked"),
	]);
}

function toggleButtons(): string[] {
	return screen.queryAllByRole("button").map((button) => button.getAttribute("aria-label") ?? "");
}

describe("SessionPaneControls", () => {
	it("renders no View options trigger when nothing belongs in the menu", () => {
		renderControls(1000);

		expect(screen.queryByRole("button", {name: "View options"})).toBeNull();
	});

	it("checking an item opens its pane and checks it", async () => {
		registerKinds("files", "artifacts");
		renderControls(1000, {artifactCount: 1});
		await openViewOptions();

		expect(menuRows()).toStrictEqual([
			["menuitemcheckbox", "Artifacts", "false"],
			["menuitemcheckbox", "Files⇧Shift⌘CommandF", "false"],
		]);

		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: /^Files/}));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect({
			pane: within(screen.getByRole("region", {name: "files"})).getByText("files pane body").tagName,
			checked: screen.getByRole("menuitemcheckbox", {name: /^Files/}).getAttribute("aria-checked"),
		}).toStrictEqual({pane: "P", checked: "true"});
	});

	it("shows main pane toggles in the trail when the titlebar is wide", () => {
		registerKinds("terminal", "changes");
		renderControls(1000);

		expect({
			toggles: toggleButtons(),
			viewOptions: screen.queryByRole("button", {name: "View options"}),
		}).toStrictEqual({toggles: ["Terminal", "Changes"], viewOptions: null});
	});

	it("folds the last toggle into the top of the menu when narrow", async () => {
		registerKinds("terminal", "changes", "files");
		renderControls(325);

		expect(toggleButtons()).toStrictEqual(["Terminal", "View options"]);

		await openViewOptions();

		expect(menuRows()).toStrictEqual([
			["menuitemcheckbox", "Changes⌃Control⇧ShiftD", "false"],
			["menuitemcheckbox", "Files⇧Shift⌘CommandF", "false"],
		]);
	});

	it("folds every toggle when there is no room, and a folded toggle still opens its pane", async () => {
		registerKinds("terminal", "changes");
		renderControls(300);

		expect(toggleButtons()).toStrictEqual(["View options"]);

		await openViewOptions();

		expect(menuRows()).toStrictEqual([
			["menuitemcheckbox", "Terminal⌃Control`", "false"],
			["menuitemcheckbox", "Changes⌃Control⇧ShiftD", "false"],
		]);

		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: /^Changes/}));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(within(screen.getByRole("region", {name: "changes"})).getByText("changes pane body").tagName).toBe("P");
	});
});
