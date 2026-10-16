// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SessionRail, type RailCard} from "../src/components/session-rail/session-rail";
import {SessionRailSlot} from "../src/components/session-rail/session-rail-slot";
import {useSessionRailDocked} from "../src/components/session-rail/use-session-rail-docked";
import {SettingsProvider} from "../src/components/settings-provider";
import {TitlebarCompactContext} from "../src/components/titlebar-compact-context";
import {SessionPaneControls} from "../src/components/view-options-menu";
import type {PaneKind} from "../src/lib/pane-layout";
import {readRailSectionsState, readSessionRailShown, setSessionRailShown} from "../src/lib/session-rail-store";
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

	it("folds into the top of View options when the titlebar is compact, as upstream", async () => {
		registerKinds("changes");
		render(
			<SettingsProvider>
				<TileHost sessionId="rail-session">
					<TitlebarCompactContext.Provider value>
						<SessionPaneControls facts={{}} railAvailable />
					</TitlebarCompactContext.Provider>
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

		expect({before, rows, stored: readSessionRailShown()}).toStrictEqual({
			before: [["Changes", "false"]],
			rows: [["menuitem", "Show session rail"]],
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
	it("renders upstream's titled cards, Environment and Context open by default", () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);

		expect(cardStates()).toStrictEqual([
			["Environment", "true", true],
			["Context12%", "true", true],
			["Progress1 of 3", "false", false],
		]);
	});

	it("toggles one card from its header and remembers it for the session", () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		fireEvent.click(screen.getByRole("button", {name: /^Progress/}));
		fireEvent.click(screen.getByRole("button", {name: /^Environment/}));

		expect({cards: cardStates(), folds: readRailSectionsState().foldsBySession}).toStrictEqual({
			cards: [
				["Environment", "false", false],
				["Context12%", "true", true],
				["Progress1 of 3", "true", true],
			],
			folds: {s1: {collapsed: ["environment"], expanded: ["progress"]}},
		});
	});

	it("Alt-click sets every card to the clicked card's new state", () => {
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		fireEvent.click(screen.getByRole("button", {name: /^Progress/}), {altKey: true});

		expect(cardStates()).toStrictEqual([
			["Environment", "true", true],
			["Context12%", "true", true],
			["Progress1 of 3", "true", true],
		]);
	});
});
