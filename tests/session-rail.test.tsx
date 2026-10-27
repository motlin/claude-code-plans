// @vitest-environment jsdom

import type {ReactNode} from "react";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {RAIL_ROW_ACTION_CLASS} from "../src/components/session-rail/rail-row";
import {railSectionAccessibility} from "../src/components/session-rail/rail-section-accessibility";
import {SessionRail, type RailCard} from "../src/components/session-rail/session-rail";
import {SessionRailSlot} from "../src/components/session-rail/session-rail-slot";
import {railFit, railFits} from "../src/components/session-rail/rail-fit";
import {
	SessionRailFitContext,
	useSessionRailDocked,
	useSessionRailFitState,
} from "../src/components/session-rail/use-session-rail-docked";
import {SettingsProvider} from "../src/components/settings-provider";
import {TitlebarFoldedContext} from "../src/components/titlebar-folded-context";
import {SessionPaneControls} from "../src/components/view-options-menu";
import type {PaneKind} from "../src/lib/pane-layout";
import {PHONE_SHEET_QUERY} from "../src/lib/use-phone-sheet";
import {
	RAIL_SECTIONS_STORAGE_KEY,
	readRailSectionsState,
	readSessionRailShown,
	setSessionRailShown,
} from "../src/lib/session-rail-store";
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

async function settle() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
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

function DockedProbe() {
	return <output data-testid="docked">{String(useSessionRailDocked())}</output>;
}

function renderSession() {
	return render(
		<SettingsProvider>
			<TileHost sessionId="rail-session">
				<SessionPaneControls facts={{}} railAvailable />
				<DockedProbe />
				<SessionRailSlot render={() => <p>rail body</p>} />
			</TileHost>
		</SettingsProvider>,
	);
}

/** The titlebar's toggles; a pane's own Move, Expand and Close carry no pressed state. */
function trail(): Array<[string, string | null]> {
	return screen
		.queryAllByRole("button")
		.filter((button) => button.hasAttribute("aria-pressed"))
		.map((button) => [button.getAttribute("aria-label") ?? "", button.getAttribute("aria-pressed")]);
}

describe("session rail toggle", () => {
	it("leads upstream's trail, before Changes and Files, unpressed while hidden", () => {
		registerKinds("changes", "files");
		renderSession();

		expect(trail()).toStrictEqual([
			["Show session rail", "false"],
			["Changes", "false"],
			["Files", "false"],
		]);
	});

	it("shows the rail, persists the global flag, and hides it again", async () => {
		renderSession();
		fireEvent.click(screen.getByRole("button", {name: "Show session rail"}));
		await settle();
		const shown = {
			trail: trail(),
			stored: readSessionRailShown(),
			docked: screen.getByTestId("docked").textContent,
			rail: (await screen.findByText("rail body")).tagName,
		};
		fireEvent.click(screen.getByRole("button", {name: "Hide session rail"}));
		await settle();

		expect({
			shown,
			hidden: {
				trail: trail(),
				stored: readSessionRailShown(),
				docked: screen.getByTestId("docked").textContent,
				rail: screen.queryByText("rail body"),
			},
		}).toStrictEqual({
			shown: {trail: [["Hide session rail", "true"]], stored: true, docked: "true", rail: "P"},
			hidden: {trail: [["Show session rail", "false"]], stored: false, docked: "false", rail: null},
		});
	});

	it("sets a 1x16 separator between the rail toggle and Changes, as upstream", () => {
		registerKinds("changes", "files");
		renderSession();
		const order = [...document.querySelectorAll("button[aria-pressed], [role=separator]")].map(
			(element) => element.getAttribute("aria-label") ?? element.getAttribute("role"),
		);
		const separator = screen.getByRole("separator");

		expect({order, classes: separator.className}).toStrictEqual({
			order: ["Show session rail", "separator", "Changes", "Files"],
			classes: "mx-0.5 h-4 w-px shrink-0 bg-border",
		});
	});

	it("folds the rail, Changes and Files into View options when the chat tile is squeezed, as upstream", async () => {
		registerKinds("changes", "files");
		render(
			<SettingsProvider>
				<TileHost sessionId="rail-session">
					<TitlebarFoldedContext.Provider value>
						<SessionPaneControls facts={{}} railAvailable />
					</TitlebarFoldedContext.Provider>
				</TileHost>
			</SettingsProvider>,
		);
		const before = trail();
		fireEvent.click(screen.getByRole("button", {name: "View options"}));
		await settle();
		const rows = [...screen.getByRole("menu").querySelectorAll<HTMLElement>("[role^=menuitem]")].map((item) => [
			item.getAttribute("role"),
			item.textContent,
		]);
		fireEvent.click(screen.getByRole("menuitem", {name: "Show session rail"}));
		await settle();

		expect({
			before,
			rows,
			separators: screen.queryAllByRole("separator").length,
			stored: readSessionRailShown(),
		}).toStrictEqual({
			before: [],
			rows: [
				["menuitem", "Show session rail"],
				["menuitemcheckbox", "Changes⌃Control⇧ShiftD"],
				["menuitemcheckbox", "Files⇧Shift⌘CommandF"],
			],
			separators: 0,
			stored: true,
		});
	});

	it("is absent when the session supplies no rail", () => {
		render(
			<SettingsProvider>
				<TileHost sessionId="rail-session">
					<SessionPaneControls facts={{}} />
				</TileHost>
			</SettingsProvider>,
		);

		expect(screen.queryByRole("button", {name: /session rail/})).toBeNull();
	});
});

describe("session rail on a phone", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches: query === PHONE_SHEET_QUERY,
				media: query,
				onchange: null,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
				addListener: () => undefined,
				removeListener: () => undefined,
				dispatchEvent: () => false,
			})),
		);
	});

	it("keeps the toggle in the trail and opens the rail as an overlay card over the transcript", async () => {
		registerKinds("changes", "files");
		renderSession();
		const before = trail();
		fireEvent.click(screen.getByRole("button", {name: "Show session rail"}));
		await settle();
		const overlay = await screen.findByRole("group", {name: "Session details"});
		const shown = {
			trail: trail(),
			docked: screen.getByTestId("docked").textContent,
			body: within(overlay).getByText("rail body").tagName,
			overlay: overlay.hasAttribute("data-session-rail-overlay"),
			card: overlay.firstElementChild?.className,
		};
		fireEvent.click(screen.getByRole("button", {name: "Hide session rail"}));
		await settle();

		expect({before, shown, closed: screen.queryByRole("group", {name: "Session details"})}).toStrictEqual({
			before: [
				["Show session rail", "false"],
				["Changes", "false"],
				["Files", "false"],
			],
			shown: {
				trail: [
					["Hide session rail", "true"],
					["Changes", "false"],
					["Files", "false"],
				],
				docked: "false",
				body: "P",
				overlay: true,
				card: "flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface-1 p-2 shadow-panel-md transition-opacity duration-200 ease-out motion-reduce:transition-none starting:opacity-0 [--session-rail-w:100%]",
			},
			closed: null,
		});
	});
});

describe("session rail and side panes", () => {
	it("swaps out for an open pane and comes back when the pane closes", async () => {
		registerKinds("changes");
		setSessionRailShown(true);
		renderSession();
		await screen.findByText("rail body");
		fireEvent.click(screen.getByRole("button", {name: "Changes"}));
		await settle();
		const withPane = {
			trail: trail(),
			rail: screen.queryByText("rail body"),
			stored: readSessionRailShown(),
		};
		fireEvent.click(screen.getByRole("button", {name: "Changes"}));
		await settle();

		expect({withPane, closed: (await screen.findByText("rail body")).tagName}).toStrictEqual({
			withPane: {
				trail: [
					["Show session rail", "false"],
					["Changes", "true"],
				],
				rail: null,
				stored: true,
			},
			closed: "P",
		});
	});

	it("closes the open pane when shown from the titlebar", async () => {
		registerKinds("changes");
		renderSession();
		fireEvent.click(screen.getByRole("button", {name: "Changes"}));
		await settle();
		fireEvent.click(screen.getByRole("button", {name: "Show session rail"}));
		await settle();

		expect({
			pane: screen.queryByRole("region", {name: "changes"}),
			rail: (await screen.findByText("rail body")).tagName,
			trail: trail(),
		}).toStrictEqual({
			pane: null,
			rail: "P",
			trail: [
				["Hide session rail", "true"],
				["Changes", "false"],
			],
		});
	});
});

describe("session rail fit by chat-panel width", () => {
	let tileWidth = 600;
	const observers: Array<() => void> = [];

	beforeEach(() => {
		tileWidth = 600;
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: ResizeObserverCallback) {
					observers.push(() => {
						callback([], this);
					});
				}
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			return DOMRect.fromRect({width: this.hasAttribute("data-tile") ? tileWidth : 1200, height: 800});
		});
	});

	afterEach(() => {
		observers.splice(0);
	});

	function FitTile({children}: {children: ReactNode}) {
		const fit = useSessionRailFitState();
		return (
			<SessionRailFitContext.Provider value={fit}>
				<div data-tile="" ref={fit.measureRef}>
					{children}
				</div>
			</SessionRailFitContext.Provider>
		);
	}

	function renderFitSession() {
		return render(
			<SettingsProvider>
				<TileHost sessionId="rail-session">
					<FitTile>
						<SessionPaneControls facts={{}} railAvailable />
						<DockedProbe />
						<p>transcript</p>
						<SessionRailSlot render={() => <p>rail body</p>} />
					</FitTile>
				</TileHost>
			</SettingsProvider>,
		);
	}

	function resizeTile(width: number) {
		tileWidth = width;
		act(() => {
			for (const fire of observers) fire();
		});
	}

	function toggleState() {
		const toggle = screen.getByRole("button", {name: /session rail/});
		return {
			label: toggle.getAttribute("aria-label"),
			pressed: toggle.getAttribute("aria-pressed"),
			expanded: toggle.getAttribute("aria-expanded"),
			controls: toggle.getAttribute("aria-controls"),
		};
	}

	it("thresholds the fit at upstream's 611px alone and 771px beside a pane", () => {
		expect([railFit(610), railFit(611), railFit(770), railFit(771)]).toStrictEqual([
			"none",
			"alone",
			"alone",
			"beside-pane",
		]);
		expect([railFits("alone", false), railFits("alone", true), railFits("beside-pane", true)]).toStrictEqual([
			true,
			false,
			true,
		]);
	});

	it("doesn't dock below the fit and raises an unpersisted overlay from the toggle, as upstream", async () => {
		setSessionRailShown(true);
		renderFitSession();
		await settle();
		const before = {
			column: document.querySelector("[data-epitaxy-rail-column]"),
			docked: screen.getByTestId("docked").textContent,
			toggle: toggleState(),
		};
		fireEvent.click(screen.getByRole("button", {name: /session rail/}));
		await settle();
		const overlay = screen.getByRole("group", {name: "Session details"});
		const card = overlay.firstElementChild as HTMLElement;

		expect({
			before,
			toggle: toggleState(),
			overlay: {
				id: overlay.id,
				tabIndex: overlay.tabIndex,
				className: overlay.className,
				focused: document.activeElement === overlay,
				card: card.className,
				flat: card.hasAttribute("data-session-rail-flat"),
				body: within(overlay).getByText("rail body").tagName,
			},
			stored: readSessionRailShown(),
		}).toStrictEqual({
			before: {
				column: null,
				docked: "false",
				toggle: {label: "Show session rail", pressed: "false", expanded: "false", controls: overlay.id},
			},
			toggle: {label: "Hide session rail", pressed: "true", expanded: "true", controls: overlay.id},
			overlay: {
				id: overlay.id,
				tabIndex: -1,
				className:
					"absolute inset-y-0 end-3 z-10 flex w-[var(--session-rail-w,17.5rem)] flex-col pt-3 pb-2 outline-none",
				focused: true,
				card: "flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface-1 p-2 shadow-panel-md transition-opacity duration-200 ease-out motion-reduce:transition-none starting:opacity-0 [--session-rail-w:100%]",
				flat: true,
				body: "P",
			},
			stored: true,
		});
	});

	it("closes the overlay on an outside pointerdown or Escape, but not on the toggle", async () => {
		renderFitSession();
		await settle();
		const toggle = screen.getByRole("button", {name: /session rail/});
		fireEvent.click(toggle);
		await settle();
		fireEvent.pointerDown(toggle);
		const afterToggleDown = screen.queryByRole("group", {name: "Session details"}) !== null;
		fireEvent.pointerDown(screen.getByText("transcript"));
		await settle();
		const afterOutside = screen.queryByRole("group", {name: "Session details"});
		fireEvent.click(toggle);
		await settle();
		fireEvent.keyDown(screen.getByRole("group", {name: "Session details"}), {key: "Escape"});
		await settle();

		expect({
			afterToggleDown,
			afterOutside,
			afterEscape: screen.queryByRole("group", {name: "Session details"}),
			refocused: document.activeElement === toggle,
			toggle: toggleState(),
			stored: readSessionRailShown(),
		}).toStrictEqual({
			afterToggleDown: true,
			afterOutside: null,
			afterEscape: null,
			refocused: true,
			toggle: {
				label: "Show session rail",
				pressed: "false",
				expanded: "false",
				controls: toggle.getAttribute("aria-controls"),
			},
			stored: false,
		});
	});

	it("docks once the tile widens past the fit, clearing the overlay, and doesn't re-raise when it narrows", async () => {
		setSessionRailShown(true);
		renderFitSession();
		await settle();
		fireEvent.click(screen.getByRole("button", {name: /session rail/}));
		await settle();
		resizeTile(700);
		await settle();
		const wide = {
			column: document.querySelector("[data-epitaxy-rail-column]") !== null,
			overlay: screen.queryByRole("group", {name: "Session details"}),
			docked: screen.getByTestId("docked").textContent,
			toggle: screen.getByRole("button", {name: /session rail/}).getAttribute("aria-expanded"),
		};
		resizeTile(600);
		await settle();

		expect({
			wide,
			narrow: {
				column: document.querySelector("[data-epitaxy-rail-column]"),
				overlay: screen.queryByRole("group", {name: "Session details"}),
				docked: screen.getByTestId("docked").textContent,
			},
		}).toStrictEqual({
			wide: {column: true, overlay: null, docked: "true", toggle: null},
			narrow: {column: null, overlay: null, docked: "false"},
		});
	});
});

const CARDS: RailCard[] = [
	{id: "environment", body: <p>env body</p>},
	{id: "context", summary: "12%", body: <p>context body</p>},
	{id: "progress", summary: "1 of 3", body: <p>progress body</p>},
];

function cardStates(): Array<[string, string | null, boolean]> {
	return within(screen.getByRole("complementary", {name: "Session details"}))
		.getAllByRole("heading", {level: 3})
		.map((heading) => {
			const button = within(heading).getByRole("button");
			const section = heading.closest("section");
			return [
				button.textContent,
				button.getAttribute("aria-expanded"),
				section?.querySelector("[data-rail-body]") !== null,
			];
		});
}

describe("session rail cards", () => {
	it("renders upstream's titled cards, every one open by default except Context", () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);

		expect(cardStates()).toStrictEqual([
			["Environment", "true", true],
			["Context12%", "false", false],
			["Progress1 of 3", "true", true],
		]);
	});

	it("toggles one card from its header, and the toggle becomes the default for other sessions", () => {
		const {unmount} = render(<SessionRail sessionId="s1" cards={CARDS} />);
		fireEvent.click(screen.getByRole("button", {name: /^Context/}));
		fireEvent.click(screen.getByRole("button", {name: /^Environment/}));
		const s1 = {cards: cardStates(), folds: readRailSectionsState().foldsBySession};
		unmount();
		render(<SessionRail sessionId="s2" cards={CARDS} />);

		expect({s1, s2: cardStates()}).toStrictEqual({
			s1: {
				cards: [
					["Environment", "false", false],
					["Context12%", "true", true],
					["Progress1 of 3", "true", true],
				],
				folds: {s1: {collapsed: ["environment"], expanded: ["context"]}},
			},
			s2: [
				["Environment", "false", false],
				["Context12%", "true", true],
				["Progress1 of 3", "true", true],
			],
		});
	});

	it("Alt-click sets every card to the clicked card's new state", () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		fireEvent.click(screen.getByRole("button", {name: /^Context/}), {altKey: true});

		expect(cardStates()).toStrictEqual([
			["Environment", "true", true],
			["Context12%", "true", true],
			["Progress1 of 3", "true", true],
		]);
	});
});

describe("session rail card summary", () => {
	function summaryOf(name: RegExp) {
		const summary = screen.getByRole("button", {name}).querySelector<HTMLElement>("[data-rail-summary]");
		return {invisible: summary?.classList.contains("invisible"), ariaHidden: summary?.getAttribute("aria-hidden")};
	}

	it("hides an open card's summary like upstream, and shows a collapsed one's", () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);

		expect({open: summaryOf(/^Progress/), collapsed: summaryOf(/^Context/)}).toStrictEqual({
			open: {invisible: true, ariaHidden: "true"},
			collapsed: {invisible: false, ariaHidden: null},
		});
	});

	it("renders a rollup percentage with upstream's 24x10 mini meter, filled by severity", () => {
		render(
			<SessionRail
				sessionId="s1"
				cards={[
					{id: "context", rollupPct: 18, body: <p>context body</p>},
					{id: "environment", rollupPct: 80, body: <p>env body</p>},
				]}
			/>,
		);
		const meter = (name: RegExp) => {
			const summary = screen.getByRole("button", {name}).querySelector<HTMLElement>("[data-rail-summary]");
			const track = summary?.querySelector<HTMLElement>(".h-2\\.5.w-6");
			const fill = track?.firstElementChild as HTMLElement | null | undefined;
			return {
				text: summary?.textContent,
				track: track?.className,
				trackHidden: track?.getAttribute("aria-hidden"),
				fill: fill?.className,
				width: fill?.style.width,
			};
		};

		expect({context: meter(/^Context/), environment: meter(/^Environment/)}).toStrictEqual({
			context: {
				text: "18%",
				track: "flex h-2.5 w-6 shrink-0 rounded-full bg-alpha-2 p-0.5",
				trackHidden: "true",
				fill: "h-full min-w-1.5 rounded-full bg-fill-accent",
				width: "18%",
			},
			environment: {
				text: "80%",
				track: "flex h-2.5 w-6 shrink-0 rounded-full bg-alpha-2 p-0.5",
				trackHidden: "true",
				fill: "h-full min-w-1.5 rounded-full bg-usage-warning",
				width: "80%",
			},
		});
	});
});

describe("session rail header menu", () => {
	function menuRows(): Array<[string | null, string, string | null]> {
		const menu = screen.getByRole("menu");
		return [...menu.querySelectorAll<HTMLElement>("[role^=menuitem], [data-menu-label]")].map((item) => [
			item.getAttribute("role"),
			item.textContent,
			item.getAttribute("aria-checked") ?? item.getAttribute("aria-disabled"),
		]);
	}

	async function openHeaderMenu(title: RegExp) {
		fireEvent.contextMenu(screen.getByRole("button", {name: title}));
		await settle();
	}

	function cardIds(): string[] {
		return [...document.querySelectorAll<HTMLElement>("[data-rail-section]")].map(
			(section) => section.dataset["railSection"] ?? "",
		);
	}

	it("lists upstream's Show checkboxes and a disabled Reset to defaults on right-click", async () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		await openHeaderMenu(/^Progress/);

		expect(menuRows()).toStrictEqual([
			[null, "Show", null],
			["menuitemcheckbox", "Goal", "true"],
			["menuitemcheckbox", "Context", "true"],
			["menuitemcheckbox", "Connectors", "true"],
			["menuitemcheckbox", "Outputs", "true"],
			["menuitemcheckbox", "Changes", "true"],
			["menuitemcheckbox", "Servers", "true"],
			["menuitemcheckbox", "Background tasks", "true"],
			["menuitem", "Reset to defaults", "true"],
		]);
	});

	it("hides a section from the Show group, and Reset to defaults brings it back", async () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		await openHeaderMenu(/^Environment/);
		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: "Context"}));
		await settle();
		const hidden = {cards: cardIds(), stored: readRailSectionsState().hidden};
		fireEvent.keyDown(screen.getByRole("menu"), {key: "Escape"});
		await settle();
		await openHeaderMenu(/^Environment/);
		const reset = screen.getByRole("menuitem", {name: "Reset to defaults"});
		const resetDisabled = reset.getAttribute("aria-disabled");
		fireEvent.click(reset);
		await settle();

		expect({hidden, resetDisabled, restored: cardIds()}).toStrictEqual({
			hidden: {cards: ["environment", "progress"], stored: ["context"]},
			resetDisabled: null,
			restored: ["environment", "context", "progress"],
		});
	});
});

describe("session rail reorder", () => {
	it("draws the cards in the saved order", () => {
		localStorage.setItem(
			RAIL_SECTIONS_STORAGE_KEY,
			JSON.stringify({
				state: {
					foldsBySession: {},
					startsOpen: {environment: true, context: true},
					hidden: [],
					order: ["progress", "environment"],
				},
				version: 0,
			}),
		);
		render(<SessionRail sessionId="s1" cards={CARDS} />);

		expect(cardStates().map(([title]) => title)).toStrictEqual(["Progress1 of 3", "Environment", "Context12%"]);
	});

	it("gives each header upstream's hover-only Reorder grip, a keyboard-sortable handle", () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const grip = screen.getByRole("button", {name: "Reorder Progress"});

		expect({
			grip: grip.hasAttribute("data-rail-grip"),
			roledescription: grip.getAttribute("aria-roledescription"),
			tabIndex: grip.tabIndex,
			hoverOnly: grip.className.split(" ").filter((c) => c.includes("opacity")),
			grips: screen.getAllByRole("button", {name: /^Reorder /}).map((each) => each.getAttribute("aria-label")),
		}).toStrictEqual({
			grip: true,
			roledescription: "Draggable section",
			tabIndex: 0,
			hoverOnly: ["opacity-0", "group-hover/railtop:opacity-100", "focus-visible:opacity-100"],
			grips: ["Reorder Environment", "Reorder Context", "Reorder Progress"],
		});
	});

	it("describes each grip with upstream's section pick-up instructions", () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const grip = screen.getByRole("button", {name: "Reorder Context"});
		const describedBy = grip.getAttribute("aria-describedby") ?? "";

		expect(document.getElementById(describedBy)?.textContent).toBe(
			"To pick up a section, press Space or Enter. While it is picked up, press the up or down arrow key to move it, Space or Enter to drop it, or Escape to cancel.",
		);
	});

	it("announces a keyboard pick-up, move-over and cancel with upstream's section strings", async () => {
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const section = this.closest("[data-rail-section]");
			const index = section ? [...document.querySelectorAll("[data-rail-section]")].indexOf(section) : 0;
			return DOMRect.fromRect({x: 0, y: index * 100, width: 280, height: 80});
		});
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const grip = screen.getByRole("button", {name: "Reorder Context"});
		const announced: string[] = [];
		const observer = new MutationObserver(() => {
			const text = document.querySelector("[aria-live]")?.textContent ?? "";
			if (text !== "" && announced.at(-1) !== text) announced.push(text);
		});
		observer.observe(document.body, {subtree: true, childList: true, characterData: true});

		for (const key of [" ", "Escape"]) {
			await act(async () => {
				fireEvent.keyDown(grip, {code: key === " " ? "Space" : key, key});
				await new Promise((resolve) => {
					setTimeout(resolve, 0);
				});
			});
		}
		observer.disconnect();

		// dnd-kit's move-over on pick-up replaces the pick-up line in the same commit.
		expect(announced).toStrictEqual(["Context is now section 2 of 3.", "Moving Context was cancelled."]);
	});

	it("words every pick-up, move, drop and cancel announcement with the section's position", () => {
		const {announcements} = railSectionAccessibility(["environment", "context", "progress"]);
		const context = {id: "context"};
		const progress = {id: "progress"};
		const event = {active: context, over: progress} as unknown as Parameters<typeof announcements.onDragOver>[0];

		expect([
			announcements.onDragStart(event),
			announcements.onDragOver(event),
			announcements.onDragOver({...event, over: null}),
			announcements.onDragEnd(event),
			announcements.onDragEnd({...event, over: null}),
			announcements.onDragCancel(event),
		]).toStrictEqual([
			"Picked up Context. It is section 2 of 3.",
			"Context is now section 3 of 3.",
			undefined,
			"Context dropped at section 3 of 3.",
			"Context dropped at section 2 of 3.",
			"Moving Context was cancelled.",
		]);
	});

	it("rings the grip's 20px dot frame on keyboard focus like upstream", () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const grip = screen.getByRole("button", {name: "Reorder Context"});
		const frame = grip.firstElementChild;

		expect({
			gripOutline: grip.className.split(" ").filter((c) => c.includes("outline")),
			frame: frame?.className,
			dots: frame?.firstElementChild?.className,
			dotClasses: [...(frame?.firstElementChild?.children ?? [])].map((dot) => `${dot.tagName}.${dot.className}`),
		}).toStrictEqual({
			gripOutline: ["outline-hidden"],
			frame: "flex size-5 items-center justify-center rounded group-focus-visible/railgrip:shadow-focus",
			dots: "grid grid-cols-2 gap-[3px] scale-75",
			dotClasses: Array.from({length: 6}, () => "I.size-0.5 rounded-full bg-current"),
		});
	});

	it("uses upstream's gap-sm 8px between row slots and gap-xs 6px across the header row", () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const railtop = screen.getByRole("button", {name: "Reorder Progress"}).closest(".group\\/railtop");
		const gaps = (className: string | undefined) => className?.split(" ").filter((c) => c.startsWith("gap-"));

		expect({row: gaps(RAIL_ROW_ACTION_CLASS), railtop: gaps(railtop?.className)}).toStrictEqual({
			row: ["gap-2"],
			railtop: ["gap-1.5"],
		});
	});
});
