// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SettingsProvider} from "../src/components/settings-provider";
import {SessionPaneControls} from "../src/components/view-options-menu";
import {type ViewOptionsFacts, viewOptionsItems} from "../src/components/view-options-items";
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
		"terminal",
		"artifacts",
		"files",
		"links",
		"background-tasks",
		"plan",
		"subagents",
		"session-details",
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
			["terminal", null],
			["artifacts", null],
			["links", null],
			["background-tasks", 1],
			["plan", null],
			["subagents", null],
			["session-details", null],
		]);
	});

	it("hides panes that do not apply to the session", () => {
		expect(visible(ALL_KINDS, {})).toStrictEqual([
			["terminal", null],
			["links", null],
			["session-details", null],
		]);
	});

	it("keeps a pane that no longer applies while it is open", () => {
		expect(visible(ALL_KINDS, {}, ["artifacts", "plan"])).toStrictEqual([
			["terminal", null],
			["artifacts", null],
			["links", null],
			["plan", null],
			["session-details", null],
		]);
	});

	it("lists Plan while earlier transcript messages are still unloaded, as upstream does", () => {
		expect(visible(ALL_KINDS, {hasPlan: false, hasUnloadedHistory: true})).toStrictEqual([
			["terminal", null],
			["links", null],
			["plan", null],
			["session-details", null],
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
			visible(new Set<PaneKind>(["links"]), {
				artifactCount: 2,
				hasPlan: true,
				backgroundTasks: {total: 3, running: 1},
				subagentCount: 4,
			}),
		).toStrictEqual([["links", null]]);
	});
});

function renderControls(facts: ViewOptionsFacts = {}, onExpandChat?: () => void) {
	return render(
		<SettingsProvider>
			<TileHost sessionId="view-options">
				<SessionPaneControls facts={facts} {...(onExpandChat === undefined ? {} : {onExpandChat})} />
			</TileHost>
		</SettingsProvider>,
	);
}

async function openViewOptions() {
	fireEvent.click(screen.getByRole("button", {name: "View options"}));
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

function menuRows(): Array<[string | null, string, string | null]> {
	const menu = screen.getByRole("menu");
	return [...menu.querySelectorAll<HTMLElement>("[role^=menuitem]")].map((item) => [
		item.getAttribute("role"),
		item.textContent,
		item.getAttribute("aria-checked"),
	]);
}

function toggleButtons(): string[] {
	return screen.queryAllByRole("button").map((button) => button.getAttribute("aria-label") ?? "");
}

describe("SessionPaneControls", () => {
	it("renders no View options trigger when nothing belongs in the menu", () => {
		renderControls();

		expect(screen.queryByRole("button", {name: "View options"})).toBeNull();
	});

	it("checking an item opens its pane and checks it", async () => {
		registerKinds("links", "artifacts");
		renderControls({artifactCount: 1});
		await openViewOptions();

		expect(menuRows()).toStrictEqual([
			["menuitemcheckbox", "Artifacts", "false"],
			["menuitemcheckbox", "Links", "false"],
		]);

		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: /^Links/}));
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});

		expect({
			pane: within(screen.getByRole("region", {name: "links"})).getByText("links pane body").tagName,
			checked: screen.getByRole("menuitemcheckbox", {name: /^Links/}).getAttribute("aria-checked"),
		}).toStrictEqual({pane: "P", checked: "true"});
	});

	it("keeps a checked Plan item while the Plan pane is open without a plan, as upstream does", async () => {
		registerKinds("plan");
		const {rerender} = renderControls({hasPlan: true});
		await openViewOptions();
		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: /^Plan/}));
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});

		rerender(
			<SettingsProvider>
				<TileHost sessionId="view-options">
					<SessionPaneControls facts={{hasPlan: false}} />
				</TileHost>
			</SettingsProvider>,
		);

		expect(menuRows()).toStrictEqual([["menuitemcheckbox", "Plan", "true"]]);
	});

	it("draws item icons in full ink, as upstream does", async () => {
		registerKinds("links");
		renderControls();
		await openViewOptions();

		const icon = screen.getByRole("menuitemcheckbox", {name: /^Links/}).querySelector("svg");

		expect(
			icon
				?.getAttribute("class")
				?.split(" ")
				.filter((c) => c.startsWith("text-")),
		).toEqual(["text-primary"]);
	});

	it("lists Session details and opens it as a pane", async () => {
		registerKinds("session-details");
		renderControls();
		await openViewOptions();

		expect(menuRows()).toStrictEqual([["menuitemcheckbox", "Session details", "false"]]);

		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: "Session details"}));
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});

		expect(
			within(screen.getByRole("region", {name: "session-details"})).getByText("session-details pane body")
				.tagName,
		).toBe("P");
	});

	it("shows upstream's trail, Changes, Files, then View options, with Terminal in the menu", async () => {
		registerKinds("terminal", "changes", "files");
		renderControls({}, () => {});

		expect(toggleButtons()).toStrictEqual(["Changes", "Files", "View options"]);

		await openViewOptions();

		expect(menuRows()).toStrictEqual([
			["menuitemcheckbox", "Terminal⌃Control`", "false"],
			["menuitem", "Expand chat⇧Shift⌘Command\\", null],
		]);
	});

	it("opens the Files pane from its trail toggle, labelled with ⇧⌘F like upstream", async () => {
		registerKinds("files");
		renderControls();
		const files = screen.getByRole("button", {name: "Files"});
		expect(files.getAttribute("aria-keyshortcuts")).toBe("Shift+Meta+f");
		fireEvent.click(files);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});

		expect({
			pressed: files.getAttribute("aria-pressed"),
			pane: within(screen.getByRole("region", {name: "files"})).getByText("files pane body").tagName,
		}).toStrictEqual({pressed: "true", pane: "P"});
	});

	it("keeps the trail ink on hover and paints a pressed Changes toggle in upstream's deeper blue", async () => {
		registerKinds("changes");
		renderControls();
		const changes = screen.getByRole("button", {name: "Changes"});
		fireEvent.click(changes);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});

		const classes = changes.className.split(" ");

		expect({
			pressed: changes.getAttribute("aria-pressed"),
			hoverInk: classes.filter((c) => c.startsWith("hover:text-")),
			pressedPaint: classes.filter((c) => c.startsWith("aria-pressed:")),
		}).toStrictEqual({
			pressed: "true",
			hoverInk: [],
			pressedPaint: ["aria-pressed:bg-upstream-accent-pressed", "aria-pressed:text-upstream-accent"],
		});
	});

	it("expands the chat from View options", async () => {
		const onExpandChat = vi.fn<() => void>();
		renderControls({}, onExpandChat);
		await openViewOptions();
		fireEvent.click(screen.getByRole("menuitem", {name: /^Expand chat/}));

		expect(onExpandChat).toHaveBeenCalledTimes(1);
	});

	it("opens the View options popup 6px below the trigger, as upstream does", async () => {
		renderControls({}, vi.fn<() => void>());
		await openViewOptions();
		const positioner = screen.getByRole("menu").closest("[data-side-offset]");

		expect(positioner?.getAttribute("data-side-offset")).toBe("6");
	});

	it("keeps Changes and Files as titlebar icons while the titlebar hides nothing", () => {
		registerKinds("terminal", "changes", "files");
		renderControls();

		expect(toggleButtons()).toStrictEqual(["Changes", "Files", "View options"]);
	});
});
