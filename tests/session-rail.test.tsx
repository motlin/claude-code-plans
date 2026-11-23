// @vitest-environment jsdom

import {lazy, type ReactNode} from "react";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {RAIL_ROW_ACTION_CLASS} from "../src/components/session-rail/rail-row";
import {railSectionAccessibility} from "../src/components/session-rail/rail-section-accessibility";
import {SessionRail, type RailCard} from "../src/components/session-rail/session-rail";
import {SessionRailSlot} from "../src/components/session-rail/session-rail-slot";
import {railFit, railFits} from "../src/components/session-rail/rail-fit";
import
{
	SessionRailFitContext,
	useSessionRailDocked,
	useSessionRailFitState,
} from "../src/components/session-rail/use-session-rail-docked";
import {SettingsProvider} from "../src/components/settings-provider";
import {TitlebarHiddenCountContext} from "../src/components/titlebar-fold-context";
import {SessionPaneControls} from "../src/components/view-options-menu";
import type {PaneKind} from "../src/lib/pane-layout";
import {PHONE_SHEET_QUERY} from "../src/lib/use-phone-sheet";
import
{
	RAIL_SECTIONS_STORAGE_KEY,
	railFirstCardKey,
	readRailBandHeights,
	readRailSectionsState,
	recordRailFirstCardHeight,
	readSessionRailShown,
	requestRailContextCard,
	setSessionRailShown,
} from "../src/lib/session-rail-store";
import {installLocalStorage} from "./fake-storage";

class FakeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
	takeRecords()
	{
		return [];
	}
}

const unregisters: Array<() => void> = [];

/** Upstream's `uo` card, with local's explicit border color and the 8px inset kept until rail-flat-section-dividers lands. */
const OVERLAY_CARD_CLASS =
	"flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface-1 p-2 shadow-panel-md transition-opacity duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none starting:opacity-0";

function registerKinds(...kinds: PaneKind[]): void
{
	for (const kind of kinds)
	{
		unregisters.push(
			registerPane(
				kind,
				{
					title: kind,
					render: () => <p>{`${kind} pane body`}</p>,
				},
			),
		);
	}
}

async function settle()
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

beforeEach(() =>
{
	installLocalStorage();
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect(
			{
				x: 0,
				y: 0,
				width: 1200,
				height: 800,
			},
		),
	);
});

afterEach(() =>
{
	for (const unregister of unregisters.splice(0)) unregister();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function DockedProbe()
{
	return <output data-testid="docked">{String(useSessionRailDocked())}</output>;
}

function renderSession()
{
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
function trail(): Array<[string, string | null]>
{
	return screen
		.queryAllByRole("button")
		.filter((button) => button.hasAttribute("aria-pressed"))
		.map((button) => [button.getAttribute("aria-label") ?? "", button.getAttribute("aria-pressed")]);
}

describe("session rail toggle", () =>
{
	it("leads upstream's trail, before Changes and Files, unpressed while hidden", () =>
	{
		registerKinds("changes", "files");
		renderSession();

		expect(trail()).toStrictEqual([
			["Session rail", "false"],
			["Changes", "false"],
			["Files", "false"],
		]);
	});

	it("shows the rail, persists the global flag, and hides it again", async () =>
	{
		renderSession();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			),
		);
		await settle();
		const shown =
		{
			trail: trail(),
			stored: readSessionRailShown(),
			docked: screen.getByTestId("docked").textContent,
			rail: (await screen.findByText("rail body")).tagName,
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			),
		);
		await settle();

		expect(
			{
				shown,
				hidden:
				{
					trail: trail(),
					stored: readSessionRailShown(),
					docked: screen.getByTestId("docked").textContent,
					rail: screen.queryByText("rail body"),
				},
			},
		).toStrictEqual(
			{
				shown:
				{
					trail: [["Session rail", "true"]],
					stored: true,
					docked: "true",
					rail: "P",
				},
				hidden:
				{
					trail: [["Session rail", "false"]],
					stored: false,
					docked: "false",
					rail: null,
				},
			},
		);
	});

	it("paints the pressed rail toggle ghost-selected with primary ink, not the accent blue", async () =>
	{
		renderSession();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			),
		);
		await settle();
		const rail = screen.getByRole(
			"button",
			{
				name: "Session rail",
			},
		);

		expect(
			{
				pressed: rail.getAttribute("aria-pressed"),
				pressedPaint: rail.className.split(" ").filter((c) => c.startsWith("aria-pressed:")),
			},
		).toStrictEqual(
			{
				pressed: "true",
				pressedPaint: ["aria-pressed:bg-fill-ghost-selected", "aria-pressed:text-primary"],
			},
		);
	});

	it("lays out upstream's trail with no separator: rail toggle, the Changes/Files group, then ⋮", () =>
	{
		registerKinds("terminal", "changes", "files");
		render(
			<SettingsProvider>
				<TileHost sessionId="rail-session">
					<div data-titlebar-trail="">
						<SessionPaneControls facts={{}} railAvailable />
					</div>
				</TileHost>
			</SettingsProvider>,
		);
		const trailElement = document.querySelector("[data-titlebar-trail]");
		if (trailElement === null) throw new Error("trail missing");
		// The shared Tooltip anchors each button in a wrapper span; name that child by its button.
		const control = (child: Element) =>
			child.firstElementChild?.tagName === "BUTTON" && !child.hasAttribute("role")
				? child.firstElementChild
				: child;
		const children = [...trailElement.children].map((child) =>
		{
			const element = control(child);
			const label = element.getAttribute("aria-label") ?? element.getAttribute("role");
			return label === null ? element.tagName : `${element.tagName}:${label}`;
		});
		const group = [...trailElement.children].find((child) => child.tagName === "DIV");

		expect(
			{
				children,
				groupClasses: group?.className,
				group:
					group === undefined
						? []
						: [...group.children].map((child) => control(child).getAttribute("aria-label")),
				separator: trailElement.querySelector("[role=separator]"),
			},
		).toStrictEqual(
			{
				children: ["BUTTON:Session rail", "DIV", "BUTTON:View options"],
				groupClasses: "flex items-center gap-1 empty:hidden",
				group: ["Changes", "Files"],
				separator: null,
			},
		);
	});

	function renderFolded(hiddenCount: number)
	{
		const tree = (count: number) => (
			<SettingsProvider>
				<TileHost sessionId="rail-session">
					<TitlebarHiddenCountContext.Provider value={count}>
						<SessionPaneControls facts={{}} railAvailable />
					</TitlebarHiddenCountContext.Provider>
				</TileHost>
			</SettingsProvider>
		);
		const {rerender} = render(tree(hiddenCount));
		return (count: number) =>
		{
			rerender(tree(count));
		};
	}

	/** Tabs onto a trail button, so it matches `:focus-visible` like keyboard focus. */
	function keyboardFocus(name: string)
	{
		fireEvent.keyDown(
			document.body,
			{
				key: "Tab",
			},
		);
		screen
			.getByRole(
				"button",
				{
					name,
				},
			)
			.focus();
	}

	async function foldedState()
	{
		const buttons = screen.queryAllByRole("button").map((button) => button.getAttribute("aria-label") ?? "");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "View options",
				},
			),
		);
		await settle();
		const rows = [...screen.getByRole("menu").querySelectorAll<HTMLElement>("[role^=menuitem]")].map(
			(item) => item.textContent,
		);
		fireEvent.keyDown(
			screen.getByRole("menu"),
			{
				key: "Escape",
			},
		);
		await settle();
		return {
			buttons,
			rows,
			separators: screen.queryAllByRole("separator").length,
		};
	}

	it("folds Changes, then Files, then the rail into View options, as upstream's measured fold", async () =>
	{
		registerKinds("changes", "files");
		const setHidden = renderFolded(1);
		const one = await foldedState();
		setHidden(2);
		const two = await foldedState();
		setHidden(7);
		const seven = await foldedState();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "View options",
				},
			),
		);
		await settle();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Show session rail",
				},
			),
		);
		await settle();

		expect(
			{
				one,
				two,
				seven,
				stored: readSessionRailShown(),
			},
		).toStrictEqual(
			{
				one:
				{
					buttons: ["Session rail", "Files", "View options"],
					rows: ["Changes⌃Control⇧ShiftD"],
					separators: 0,
				},
				two:
				{
					buttons: ["Session rail", "View options"],
					rows: ["Changes⌃Control⇧ShiftD", "Files⇧Shift⌘CommandF"],
					separators: 0,
				},
				seven:
				{
					buttons: ["View options"],
					rows: ["Show session rail", "Changes⌃Control⇧ShiftD", "Files⇧Shift⌘CommandF"],
					separators: 0,
				},
				stored: true,
			},
		);
	});

	it("folds inactive panes before the open one, as upstream", async () =>
	{
		registerKinds("changes", "files");
		const setHidden = renderFolded(0);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Changes",
				},
			),
		);
		await settle();
		setHidden(1);

		expect(trail()).toStrictEqual([
			["Session rail", "false"],
			["Changes", "true"],
		]);
	});

	it("moves keyboard focus to the last inline toggle when the focused one folds past the end", async () =>
	{
		registerKinds("changes", "files");
		const setHidden = renderFolded(0);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Changes",
				},
			),
		);
		await settle();
		keyboardFocus("Files");
		setHidden(1);
		const afterFilesFolded = document.activeElement?.getAttribute("aria-label");
		setHidden(7);

		expect(
			{
				afterFilesFolded,
				afterAllFolded: document.activeElement?.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				afterFilesFolded: "Changes",
				afterAllFolded: "View options",
			},
		);
	});

	it("moves keyboard focus from the focused Changes toggle to Files when Changes folds", () =>
	{
		registerKinds("changes", "files");
		const setHidden = renderFolded(0);
		keyboardFocus("Changes");
		setHidden(1);

		expect(document.activeElement?.getAttribute("aria-label")).toBe("Files");
	});

	it("moves keyboard focus from the rail toggle to View options when the rail folds", () =>
	{
		registerKinds("changes", "files");
		const setHidden = renderFolded(6);
		keyboardFocus("Session rail");
		setHidden(7);

		expect(document.activeElement?.getAttribute("aria-label")).toBe("View options");
	});

	it("leaves focus alone when an unfocused toggle folds", () =>
	{
		registerKinds("changes", "files");
		const setHidden = renderFolded(0);
		keyboardFocus("Files");
		screen
			.getByRole(
				"button",
				{
					name: "Files",
				},
			)
			.blur();
		setHidden(1);

		expect(document.activeElement).toBe(document.body);
	});

	it("is absent when the session supplies no rail", () =>
	{
		render(
			<SettingsProvider>
				<TileHost sessionId="rail-session">
					<SessionPaneControls facts={{}} />
				</TileHost>
			</SettingsProvider>,
		);

		expect(
			screen.queryByRole(
				"button",
				{
					name: "Session rail",
				},
			),
		).toBeNull();
	});
});

describe("session rail on a phone", () =>
{
	beforeEach(() =>
	{
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => (
			{
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

	it("keeps the toggle in the trail and opens the rail as an overlay card over the transcript", async () =>
	{
		registerKinds("changes", "files");
		renderSession();
		const before = trail();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			),
		);
		await settle();
		const overlay = await screen.findByRole(
			"group",
			{
				name: "Session details",
			},
		);
		const shown =
		{
			trail: trail(),
			docked: screen.getByTestId("docked").textContent,
			body: within(overlay).getByText("rail body").tagName,
			className: overlay.className,
			card: overlay.firstElementChild?.className,
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			),
		);
		await settle();

		expect(
			{
				before,
				shown,
				closed: screen.queryByRole(
					"group",
					{
						name: "Session details",
					},
				),
			},
		).toStrictEqual(
			{
				before: [
					["Session rail", "false"],
					["Changes", "false"],
					["Files", "false"],
				],
				shown:
				{
					trail: [
						["Session rail", "true"],
						["Changes", "false"],
						["Files", "false"],
					],
					docked: "false",
					body: "P",
					className:
						"absolute inset-y-0 end-[var(--titlebar-end-inset,0.5rem)] flex w-[var(--session-rail-w,17.5rem)] flex-col pt-3 pb-2 outline-none",
					card: OVERLAY_CARD_CLASS,
				},
				closed: null,
			},
		);
	});
});

describe("session rail and side panes", () =>
{
	it("swaps out for an open pane and comes back when the pane closes", async () =>
	{
		registerKinds("changes");
		setSessionRailShown(true);
		renderSession();
		await screen.findByText("rail body");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Changes",
				},
			),
		);
		await settle();
		const withPane =
		{
			trail: trail(),
			rail: screen.queryByText("rail body"),
			stored: readSessionRailShown(),
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Changes",
				},
			),
		);
		await settle();

		expect(
			{
				withPane,
				closed: (await screen.findByText("rail body")).tagName,
			},
		).toStrictEqual(
			{
				withPane:
				{
					trail: [
						["Session rail", "false"],
						["Changes", "true"],
					],
					rail: null,
					stored: true,
				},
				closed: "P",
			},
		);
	});

	it("closes the open pane when shown from the titlebar", async () =>
	{
		registerKinds("changes");
		renderSession();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Changes",
				},
			),
		);
		await settle();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			),
		);
		await settle();

		expect(
			{
				pane: screen.queryByRole(
					"region",
					{
						name: "changes",
					},
				),
				rail: (await screen.findByText("rail body")).tagName,
				trail: trail(),
			},
		).toStrictEqual(
			{
				pane: null,
				rail: "P",
				trail: [
					["Session rail", "true"],
					["Changes", "false"],
				],
			},
		);
	});
});

describe("session rail fit by chat-panel width", () =>
{
	let tileWidth = 600;
	const observers: Array<() => void> = [];

	beforeEach(() =>
	{
		tileWidth = 600;
		vi.stubGlobal(
			"ResizeObserver",
			class
			{
				constructor(callback: ResizeObserverCallback)
				{
					observers.push(() =>
					{
						callback([], this);
					});
				}
				observe()
				{
				}
				unobserve()
				{
				}
				disconnect()
				{
				}
			},
		);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement)
		{
			return DOMRect.fromRect(
				{
					width: this.hasAttribute("data-tile") ? tileWidth : 1200,
					height: 800,
				},
			);
		});
	});

	afterEach(() =>
	{
		observers.splice(0);
	});

	function FitTile({children}: {children: ReactNode})
	{
		const fit = useSessionRailFitState();
		return (
			<SessionRailFitContext.Provider value={fit}>
				<div data-tile="" ref={fit.measureRef}>
					{children}
				</div>
			</SessionRailFitContext.Provider>
		);
	}

	function renderFitSession(rail: () => ReactNode = () => <p>rail body</p>)
	{
		return render(
			<SettingsProvider>
				<TileHost sessionId="rail-session">
					<FitTile>
						<SessionPaneControls facts={{}} railAvailable />
						<DockedProbe />
						<div data-session-scrollport="">
							<p>transcript</p>
							<div data-session-footer="">
								<textarea aria-label="Prompt" />
							</div>
						</div>
						<SessionRailSlot sessionId="rail-session" render={rail} />
					</FitTile>
				</TileHost>
			</SettingsProvider>,
		);
	}

	function raisedOverlay(): HTMLElement
	{
		return screen.getByRole(
			"group",
			{
				name: "Session details",
			},
		);
	}

	async function raiseByKeyboard()
	{
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			),
			{
				detail: 0,
			},
		);
		await settle();
	}

	function resizeTile(width: number)
	{
		tileWidth = width;
		act(() =>
		{
			for (const fire of observers) fire();
		});
	}

	function toggleState()
	{
		const toggle = screen.getByRole(
			"button",
			{
				name: "Session rail",
			},
		);
		return {
			label: toggle.getAttribute("aria-label"),
			pressed: toggle.getAttribute("aria-pressed"),
			expanded: toggle.getAttribute("aria-expanded"),
			controls: toggle.getAttribute("aria-controls"),
		};
	}

	it("thresholds the fit at upstream's panels 640px alone and 800px beside a pane", () =>
	{
		expect([railFit(639, true), railFit(640, true), railFit(799, true), railFit(800, true)]).toStrictEqual([
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

	it("keeps upstream's pre-panels 611px alone and 771px beside a pane when panels is off", () =>
	{
		expect([railFit(610, false), railFit(611, false), railFit(770, false), railFit(771, false)]).toStrictEqual([
			"none",
			"alone",
			"alone",
			"beside-pane",
		]);
	});

	it("shows upstream's delayed rail skeleton while the cards chunk loads, docked and raised", async () =>
	{
		const Pending = lazy(
			async () =>
				new Promise<
				{
					default: () => ReactNode;
				}>(() => {}),
		);
		const pending = () => <Pending />;
		const skeleton = (root: Element | null) =>
		{
			const status = root === null ? null : within(root as HTMLElement).queryByRole("status");
			return {
				status: status?.textContent ?? null,
				holds: [...(root?.querySelectorAll("[data-skeleton-group]") ?? [])].map((group) =>
					group.getAttribute("data-hold"),
				),
				reasons: [...(root?.querySelectorAll("[data-skeleton-group]") ?? [])].map((group) =>
					group.getAttribute("data-hold-reason"),
				),
			};
		};
		const expected =
		{
			status: "Loading session details",
			holds: ["delayed", "delayed"],
			reasons: [null, null],
		};
		setSessionRailShown(true);
		tileWidth = 1200;
		// The hard-loaded document's own location hands off from the route frame: shown at once.
		const first = renderFitSession(pending);
		await settle();
		const hardLoad = skeleton(document.querySelector("[data-epitaxy-rail-column]"));
		first.unmount();
		// A later SPA navigation to another session holds the skeleton back.
		const loadedPath = window.location.pathname;
		window.history.pushState(null, "", "/session/other-session");
		const {unmount} = renderFitSession(pending);
		await settle();
		const docked = skeleton(document.querySelector("[data-epitaxy-rail-column]"));
		unmount();
		setSessionRailShown(false);
		tileWidth = 600;
		renderFitSession(pending);
		await settle();
		await raiseByKeyboard();

		const raised = skeleton(raisedOverlay());
		window.history.replaceState(null, "", loadedPath);

		expect(
			{
				hardLoad,
				docked,
				raised,
			},
		).toStrictEqual(
			{
				hardLoad:
				{
					status: "Loading session details",
					holds: ["none", "none"],
					reasons: ["handoff", "handoff"],
				},
				docked: expected,
				raised: expected,
			},
		);
	});

	it("sizes the docked skeleton's first card from the session's remembered height, never the raised overlay's", async () =>
	{
		recordRailFirstCardHeight("rail-session", railFirstCardKey(readRailSectionsState(), "rail-session"), 80);
		const Pending = lazy(
			async () =>
				new Promise<
				{
					default: () => ReactNode;
				}>(() => {}),
		);
		setSessionRailShown(true);
		tileWidth = 1200;
		const {unmount} = renderFitSession(() => <Pending />);
		await settle();
		const column = document.querySelector<HTMLElement>("[data-epitaxy-rail-column]");
		const docked =
		{
			style: column?.style.cssText,
			flat: column?.hasAttribute("data-session-rail-flat"),
			className: column?.className,
		};
		unmount();
		setSessionRailShown(false);
		tileWidth = 600;
		renderFitSession(() => <Pending />);
		await settle();
		await raiseByKeyboard();

		expect(
			{
				docked,
				raised: raisedOverlay().getAttribute("style"),
			},
		).toStrictEqual(
			{
				docked:
				{
					style: "--session-rail-first-card-h: 80px; --session-rail-first-card-rows: none;",
					flat: true,
					className:
						"absolute top-0 -bottom-[var(--tiles-padding,0px)] md:-bottom-[calc(var(--tiles-padding,0px)-var(--spacing)*0.75)] flex w-[var(--session-rail-w,17.5rem)] flex-col end-[var(--session-rail-end)] border-s border-seam bg-surface-2 [&>*]:w-full",
				},
				raised: "bottom: 0px;",
			},
		);
	});

	it("doesn't dock alone at upstream's live 640px viewport (tile 632) but docks at a 640px tile", async () =>
	{
		setSessionRailShown(true);
		tileWidth = 632;
		renderFitSession();
		await settle();
		const narrow =
		{
			column: document.querySelector("[data-epitaxy-rail-column]"),
			toggle: toggleState(),
		};
		resizeTile(640);
		await settle();

		expect(
			{
				narrow,
				wide: document.querySelector("[data-epitaxy-rail-column]") !== null,
			},
		).toStrictEqual(
			{
				narrow:
				{
					column: null,
					toggle:
					{
						label: "Session rail",
						pressed: "false",
						expanded: "false",
						controls: narrow.toggle.controls,
					},
				},
				wide: true,
			},
		);
	});

	it("doesn't dock below the fit and raises an unpersisted overlay from the toggle, as upstream", async () =>
	{
		setSessionRailShown(true);
		vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement)
		{
			return this.hasAttribute("data-session-footer") ? 120 : 0;
		});
		const focus = vi.spyOn(HTMLElement.prototype, "focus");
		renderFitSession(() => <SessionRail sessionId="rail-session" cards={CARDS} />);
		await settle();
		const before =
		{
			column: document.querySelector("[data-epitaxy-rail-column]"),
			docked: screen.getByTestId("docked").textContent,
			toggle: toggleState(),
		};
		await raiseByKeyboard();
		const overlay = raisedOverlay();
		const card = overlay.firstElementChild as HTMLElement;

		expect(
			{
				before,
				toggle: toggleState(),
				overlay:
				{
					id: overlay.id,
					tabIndex: overlay.tabIndex,
					attributes: overlay.getAttributeNames().toSorted(),
					className: overlay.className,
					bottom: overlay.style.bottom,
					focused: document.activeElement === overlay,
					focusCalls: focus.mock.calls.filter((_, index) => focus.mock.contexts[index] === overlay),
					card: card.className,
					flat: card.hasAttribute("data-session-rail-flat"),
					aside: within(overlay).getByRole(
						"complementary",
						{
							name: "Session details",
						},
					).className,
				},
				stored: readSessionRailShown(),
			},
		).toStrictEqual(
			{
				before:
				{
					column: null,
					docked: "false",
					toggle:
					{
						label: "Session rail",
						pressed: "false",
						expanded: "false",
						controls: overlay.id,
					},
				},
				toggle:
				{
					label: "Session rail",
					pressed: "true",
					expanded: "true",
					controls: overlay.id,
				},
				overlay:
				{
					id: overlay.id,
					tabIndex: -1,
					attributes: ["aria-label", "class", "id", "role", "style", "tabindex"],
					className:
						"absolute inset-y-0 end-[var(--titlebar-end-inset,0.5rem)] flex w-[var(--session-rail-w,17.5rem)] flex-col pt-3 pb-2 outline-none",
					bottom: "120px",
					focused: true,
					focusCalls: [
						[
							{
								preventScroll: true,
							},
						],
					],
					card: OVERLAY_CARD_CLASS,
					flat: true,
					aside: "relative flex min-h-0 flex-col font-sans outline-none h-full w-full rounded-[inherit]",
				},
				stored: true,
			},
		);
	});

	it("closes the overlay on an outside pointerdown or Escape, but not on the toggle", async () =>
	{
		renderFitSession();
		await settle();
		const toggle = screen.getByRole(
			"button",
			{
				name: "Session rail",
			},
		);
		fireEvent.click(toggle);
		await settle();
		fireEvent.pointerDown(toggle);
		const afterToggleDown =
			screen.queryByRole(
				"group",
				{
					name: "Session details",
				},
			) !== null;
		fireEvent.pointerDown(screen.getByText("transcript"));
		await settle();
		const afterOutside = screen.queryByRole(
			"group",
			{
				name: "Session details",
			},
		);
		fireEvent.click(toggle);
		await settle();
		fireEvent.keyDown(
			screen.getByRole(
				"group",
				{
					name: "Session details",
				},
			),
			{
				key: "Escape",
			},
		);
		await settle();

		expect(
			{
				afterToggleDown,
				afterOutside,
				afterEscape: screen.queryByRole(
					"group",
					{
						name: "Session details",
					},
				),
				refocused: document.activeElement === toggle,
				toggle: toggleState(),
				stored: readSessionRailShown(),
			},
		).toStrictEqual(
			{
				afterToggleDown: true,
				afterOutside: null,
				afterEscape: null,
				refocused: true,
				toggle:
				{
					label: "Session rail",
					pressed: "false",
					expanded: "false",
					controls: toggle.getAttribute("aria-controls"),
				},
				stored: false,
			},
		);
	});

	it("keeps focus on the toggle when a mouse click raises the overlay, as upstream", async () =>
	{
		renderFitSession();
		await settle();
		const toggle = screen.getByRole(
			"button",
			{
				name: "Session rail",
			},
		);
		toggle.focus();
		fireEvent.click(
			toggle,
			{
				detail: 1,
			},
		);
		await settle();

		expect(
			{
				overlay: raisedOverlay().id,
				focusedToggle: document.activeElement === toggle,
			},
		).toStrictEqual(
			{
				overlay: toggle.getAttribute("aria-controls"),
				focusedToggle: true,
			},
		);
	});

	it("lowers on Escape from the composer, leaving focus there and stopping the key", async () =>
	{
		renderFitSession();
		await settle();
		await raiseByKeyboard();
		const prompt = screen.getByRole(
			"textbox",
			{
				name: "Prompt",
			},
		);
		prompt.focus();
		const bubbled = vi.fn<(event: KeyboardEvent) => void>();
		document.addEventListener("keydown", bubbled);
		const notCancelled = fireEvent.keyDown(
			prompt,
			{
				key: "Escape",
			},
		);
		document.removeEventListener("keydown", bubbled);
		await settle();

		expect(
			{
				overlay: screen.queryByRole(
					"group",
					{
						name: "Session details",
					},
				),
				focusKept: document.activeElement === prompt,
				notCancelled,
				bubbled: bubbled.mock.calls.length,
			},
		).toStrictEqual(
			{
				overlay: null,
				focusKept: true,
				notCancelled: false,
				bubbled: 0,
			},
		);
	});

	it("keeps the overlay for an Escape already handled or focused in another layer, and for a press in another layer", async () =>
	{
		renderFitSession();
		await settle();
		await raiseByKeyboard();
		const layer = document.createElement("div");
		const item = document.createElement("button");
		layer.append(item);
		document.body.append(layer);
		const handled = (event: KeyboardEvent) =>
		{
			event.preventDefault();
		};
		window.addEventListener("keydown", handled, true);
		fireEvent.keyDown(
			raisedOverlay(),
			{
				key: "Escape",
			},
		);
		window.removeEventListener("keydown", handled, true);
		await settle();
		const afterHandled = raisedOverlay().id;
		item.focus();
		fireEvent.keyDown(
			item,
			{
				key: "Escape",
			},
		);
		await settle();
		const afterLayerEscape = raisedOverlay().id;
		fireEvent.pointerDown(item);
		await settle();
		const afterLayerPress = raisedOverlay().id;
		layer.remove();

		expect([afterHandled, afterLayerEscape, afterLayerPress]).toStrictEqual([
			raisedOverlay().id,
			raisedOverlay().id,
			raisedOverlay().id,
		]);
	});

	it("keeps the overlay for a mouse press on a scrollbar, but not for a touch there", async () =>
	{
		renderFitSession();
		await settle();
		await raiseByKeyboard();
		const transcript = screen.getByText("transcript");
		vi.spyOn(transcript, "clientWidth", "get").mockReturnValue(100);
		vi.spyOn(transcript, "clientHeight", "get").mockReturnValue(40);
		const onScrollbar = (pointerType: string) =>
		{
			const event = new MouseEvent(
				"pointerdown",
				{
					bubbles: true,
					cancelable: true,
				},
			);
			Object.defineProperties(
				event,
				{
					pointerType:
					{
						value: pointerType,
					},
					offsetX:
					{
						value: 104,
					},
					offsetY:
					{
						value: 10,
					},
				},
			);
			fireEvent(transcript, event);
		};
		onScrollbar("mouse");
		await settle();
		const afterMouse =
			screen.queryByRole(
				"group",
				{
					name: "Session details",
				},
			) !== null;
		onScrollbar("touch");
		await settle();

		expect(
			{
				afterMouse,
				afterTouch: screen.queryByRole(
					"group",
					{
						name: "Session details",
					},
				),
			},
		).toStrictEqual(
			{
				afterMouse: true,
				afterTouch: null,
			},
		);
	});

	it("forwards vertical wheel input over the card to the transcript, as upstream", async () =>
	{
		renderFitSession(() => (
			<div>
				<p>rail body</p>
				<div
					data-testid="rail-scroller"
					style={
					{
						overflowY: "auto",
					}}
				>
					<p>scrolling card</p>
				</div>
			</div>
		));
		await settle();
		await raiseByKeyboard();
		const scrollport = document.querySelector<HTMLElement>("[data-session-scrollport]");
		if (scrollport === null) throw new Error("no scrollport");
		const scrollBy = vi.fn<(options: ScrollToOptions) => void>();
		Object.defineProperty(
			scrollport,
			"scrollBy",
			{
				value: scrollBy,
			},
		);
		const wheels: Array<[number, number, number]> = [];
		scrollport.addEventListener("wheel", (event) =>
		{
			wheels.push([event.deltaX, event.deltaY, event.deltaMode]);
		});
		const railScroller = screen.getByTestId("rail-scroller");
		vi.spyOn(railScroller, "scrollHeight", "get").mockReturnValue(400);
		vi.spyOn(railScroller, "clientHeight", "get").mockReturnValue(100);
		const body = screen.getByText("rail body");
		fireEvent.wheel(
			body,
			{
				deltaY: 120,
			},
		);
		fireEvent.wheel(
			screen.getByText("scrolling card"),
			{
				deltaY: 120,
			},
		);
		fireEvent.wheel(
			body,
			{
				deltaY: 120,
				ctrlKey: true,
			},
		);
		fireEvent.wheel(
			body,
			{
				deltaY: 10,
				deltaX: 40,
			},
		);
		fireEvent.wheel(
			body,
			{
				deltaY: 3,
				deltaMode: 1,
			},
		);

		expect(
			{
				scrolled: scrollBy.mock.calls,
				wheels,
			},
		).toStrictEqual(
			{
				scrolled: [
					[
						{
							top: 120,
							left: 0,
						},
					],
					[
						{
							top: 48,
							left: 0,
						},
					],
				],
				wheels: [
					[0, 120, 0],
					[0, 3, 1],
				],
			},
		);
	});

	it("docks once the tile widens past the fit, clearing the overlay, and doesn't re-raise when it narrows", async () =>
	{
		setSessionRailShown(true);
		renderFitSession();
		await settle();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			),
		);
		await settle();
		resizeTile(700);
		await settle();
		const wide =
		{
			column: document.querySelector("[data-epitaxy-rail-column]") !== null,
			overlay: screen.queryByRole(
				"group",
				{
					name: "Session details",
				},
			),
			docked: screen.getByTestId("docked").textContent,
			toggle: screen
				.getByRole(
					"button",
					{
						name: "Session rail",
					},
				)
				.getAttribute("aria-expanded"),
		};
		resizeTile(600);
		await settle();

		expect(
			{
				wide,
				narrow:
				{
					column: document.querySelector("[data-epitaxy-rail-column]"),
					overlay: screen.queryByRole(
						"group",
						{
							name: "Session details",
						},
					),
					docked: screen.getByTestId("docked").textContent,
				},
			},
		).toStrictEqual(
			{
				wide:
				{
					column: true,
					overlay: null,
					docked: "true",
					toggle: null,
				},
				narrow:
				{
					column: null,
					overlay: null,
					docked: "false",
				},
			},
		);
	});

	it("docks beside an open pane once the tile is 800px, as upstream under panels", async () =>
	{
		registerKinds("changes");
		setSessionRailShown(true);
		tileWidth = 800;
		renderFitSession();
		await settle();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Changes",
				},
			),
		);
		await settle();
		const shown =
		{
			column: document.querySelector("[data-epitaxy-rail-column]") !== null,
			docked: screen.getByTestId("docked").textContent,
			pane:
				screen.queryByRole(
					"region",
					{
						name: "changes",
					},
				) !== null,
			toggle: toggleState(),
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			),
		);
		await settle();
		const hidden =
		{
			column: document.querySelector("[data-epitaxy-rail-column]"),
			pane:
				screen.queryByRole(
					"region",
					{
						name: "changes",
					},
				) !== null,
			stored: readSessionRailShown(),
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			),
		);
		await settle();

		expect(
			{
				shown,
				hidden,
				reshown:
				{
					column: document.querySelector("[data-epitaxy-rail-column]") !== null,
					pane:
						screen.queryByRole(
							"region",
							{
								name: "changes",
							},
						) !== null,
					stored: readSessionRailShown(),
				},
			},
		).toStrictEqual(
			{
				shown:
				{
					column: true,
					docked: "true",
					pane: true,
					toggle:
					{
						label: "Session rail",
						pressed: "true",
						expanded: null,
						controls: null,
					},
				},
				hidden:
				{
					column: null,
					pane: true,
					stored: false,
				},
				reshown:
				{
					column: true,
					pane: true,
					stored: true,
				},
			},
		);
	});

	it("doesn't dock beside an open pane at a 799px tile under panels", async () =>
	{
		registerKinds("changes");
		setSessionRailShown(true);
		tileWidth = 799;
		renderFitSession();
		await settle();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Changes",
				},
			),
		);
		await settle();
		const toggle = toggleState();

		expect(
			{
				column: document.querySelector("[data-epitaxy-rail-column]"),
				pane:
					screen.queryByRole(
						"region",
						{
							name: "changes",
						},
					) !== null,
				toggle,
			},
		).toStrictEqual(
			{
				column: null,
				pane: true,
				toggle:
				{
					label: "Session rail",
					pressed: "false",
					expanded: "false",
					controls: toggle.controls,
				},
			},
		);
	});

	it("raises the overlay beside a pane below 800px, leaving the pane open", async () =>
	{
		registerKinds("changes");
		setSessionRailShown(true);
		tileWidth = 799;
		renderFitSession();
		await settle();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Changes",
				},
			),
		);
		await settle();
		const before =
		{
			column: document.querySelector("[data-epitaxy-rail-column]"),
			docked: screen.getByTestId("docked").textContent,
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			),
		);
		await settle();

		expect(
			{
				before,
				overlay: within(
					screen.getByRole(
						"group",
						{
							name: "Session details",
						},
					),
				).getByText("rail body").tagName,
				pane:
					screen.queryByRole(
						"region",
						{
							name: "changes",
						},
					) !== null,
				stored: readSessionRailShown(),
			},
		).toStrictEqual(
			{
				before:
				{
					column: null,
					docked: "false",
				},
				overlay: "P",
				pane: true,
				stored: true,
			},
		);
	});

	describe("raised by /autocompact", () =>
	{
		function focusedPrompt(): HTMLTextAreaElement
		{
			const prompt = document.createElement("textarea");
			document.body.append(prompt);
			prompt.focus();
			return prompt;
		}

		async function requestContext()
		{
			act(() =>
			{
				requestRailContextCard("rail-session");
			});
			await settle();
		}

		it("leaves a shown, fitting rail docked and raises nothing", async () =>
		{
			setSessionRailShown(true);
			tileWidth = 1200;
			renderFitSession();
			await settle();
			await requestContext();

			expect(
				{
					overlay: screen.queryByRole(
						"group",
						{
							name: "Session details",
						},
					),
					column: document.querySelector("[data-epitaxy-rail-column]") !== null,
				},
			).toStrictEqual(
				{
					overlay: null,
					column: true,
				},
			);
		});

		it("raises a hidden, fitting rail as an unpersisted overlay without taking focus, and lowers it on an outside pointerdown", async () =>
		{
			tileWidth = 1200;
			renderFitSession();
			await settle();
			const prompt = focusedPrompt();
			await requestContext();
			const overlay = screen.queryByRole(
				"group",
				{
					name: "Session details",
				},
			);
			const raised =
			{
				role: overlay?.getAttribute("role"),
				label: overlay?.getAttribute("aria-label"),
				body: overlay === null ? null : within(overlay).getByText("rail body").tagName,
				focusKept: document.activeElement === prompt,
				stored: readSessionRailShown(),
				toggle: toggleState(),
			};
			fireEvent.pointerDown(document.body);
			await settle();

			expect(
				{
					raised,
					lowered:
					{
						overlay: screen.queryByRole(
							"group",
							{
								name: "Session details",
							},
						),
						stored: readSessionRailShown(),
						pressed: toggleState().pressed,
					},
				},
			).toStrictEqual(
				{
					raised:
					{
						role: "group",
						label: "Session details",
						body: "P",
						focusKept: true,
						stored: false,
						toggle:
						{
							label: "Session rail",
							pressed: "true",
							expanded: "true",
							controls: overlay?.id,
						},
					},
					lowered:
					{
						overlay: null,
						stored: false,
						pressed: "false",
					},
				},
			);
		});

		it("lowers the command-raised overlay from the toggle without showing the rail", async () =>
		{
			tileWidth = 1200;
			renderFitSession();
			await settle();
			await requestContext();
			const toggle = screen.getByRole(
				"button",
				{
					name: "Session rail",
				},
			);
			fireEvent.pointerDown(toggle);
			fireEvent.click(toggle);
			await settle();

			expect(
				{
					overlay: screen.queryByRole(
						"group",
						{
							name: "Session details",
						},
					),
					column: document.querySelector("[data-epitaxy-rail-column]"),
					stored: readSessionRailShown(),
				},
			).toStrictEqual(
				{
					overlay: null,
					column: null,
					stored: false,
				},
			);
		});

		it("raises the overlay below the fit without moving focus", async () =>
		{
			renderFitSession();
			await settle();
			const prompt = focusedPrompt();
			await requestContext();

			expect(
				{
					overlay:
						screen.queryByRole(
							"group",
							{
								name: "Session details",
							},
						) !== null,
					focusKept: document.activeElement === prompt,
					toggle: toggleState().expanded,
				},
			).toStrictEqual(
				{
					overlay: true,
					focusKept: true,
					toggle: "true",
				},
			);
		});

		it("ignores another session's request", async () =>
		{
			tileWidth = 1200;
			renderFitSession();
			await settle();
			act(() =>
			{
				requestRailContextCard("other-session");
			});
			await settle();

			expect(
				screen.queryByRole(
					"group",
					{
						name: "Session details",
					},
				),
			).toBe(null);
		});
	});
});

const CARDS: RailCard[] = [
	{
		id: "environment",
		body: <p>env body</p>,
	},
	{
		id: "context",
		summary: "12%",
		body: <p>context body</p>,
	},
	{
		id: "progress",
		summary: "1 of 3",
		body: <p>progress body</p>,
	},
];

function cardStates(): Array<[string, string | null, boolean]>
{
	return within(
		screen.getByRole(
			"complementary",
			{
				name: "Session details",
			},
		),
	)
		.getAllByRole("region")
		.map((section) =>
		{
			const button = section.querySelector("button[aria-expanded]");
			return [
				button?.textContent ?? "",
				button?.getAttribute("aria-expanded") ?? null,
				section.querySelector("[data-rail-body]") !== null,
			];
		});
}

describe("session rail cards", () =>
{
	it("records the first shown card's settled height after upstream's 1000ms debounce, under this config's key", () =>
	{
		vi.useFakeTimers();
		const observed: Array<
		{
			fire: () => void;
			targets: Element[];
		}> = [];
		vi.stubGlobal(
			"ResizeObserver",
			class
			{
				readonly entry:
				{
					fire: () => void;
					targets: Element[];
				};
				constructor(callback: ResizeObserverCallback)
				{
					this.entry =
					{
						fire: () =>
						{
							callback([], this);
						},
						targets: [],
					};
					observed.push(this.entry);
				}
				observe(target: Element)
				{
					this.entry.targets.push(target);
				}
				unobserve()
				{
				}
				disconnect()
				{
				}
			},
		);
		let height = 129.6;
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() =>
			DOMRect.fromRect(
				{
					width: 280,
					height,
				},
			),
		);
		try
		{
			render(<SessionRail sessionId="s1" cards={CARDS} />);
			const stored = () => readRailBandHeights()["s1"] ?? null;
			const fire = () =>
			{
				for (const each of observed) each.fire();
			};
			fire();
			vi.advanceTimersByTime(600);
			height = 140.2;
			fire();
			vi.advanceTimersByTime(999);
			const early = stored();
			vi.advanceTimersByTime(1);

			expect(
				{
					targets: observed.flatMap((each) =>
						each.targets.map((target) => target.getAttribute("data-rail-card")),
					),
					early,
					settled: stored(),
				},
			).toStrictEqual(
				{
					targets: ["environment"],
					early: null,
					settled:
					{
						"session-rail-first-card:[[],[],{},null]":
						{
							px: 140,
						},
					},
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("renders upstream's titled cards, every one open by default except Context", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);

		expect(cardStates()).toStrictEqual([
			["Environment", "true", true],
			["Context12%", "false", false],
			["Progress1 of 3", "true", true],
		]);
	});

	it("toggles one card from its header, and the toggle becomes the default for other sessions", () =>
	{
		const {unmount} = render(<SessionRail sessionId="s1" cards={CARDS} />);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Context/,
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Environment/,
				},
			),
		);
		const s1 =
		{
			cards: cardStates(),
			folds: readRailSectionsState().foldsBySession,
		};
		unmount();
		render(<SessionRail sessionId="s2" cards={CARDS} />);

		expect(
			{
				s1,
				s2: cardStates(),
			},
		).toStrictEqual(
			{
				s1:
				{
					cards: [
						["Environment", "false", false],
						["Context12%", "true", true],
						["Progress1 of 3", "true", true],
					],
					folds:
					{
						s1:
						{
							collapsed: ["environment"],
							expanded: ["context"],
						},
					},
				},
				s2: [
					["Environment", "false", false],
					["Context12%", "true", true],
					["Progress1 of 3", "true", true],
				],
			},
		);
	});

	it("Alt-click sets every card to the clicked card's new state", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Context/,
				},
			),
			{
				altKey: true,
			},
		);

		expect(cardStates()).toStrictEqual([
			["Environment", "true", true],
			["Context12%", "true", true],
			["Progress1 of 3", "true", true],
		]);
	});
});

describe("session rail card summary", () =>
{
	function summaryOf(name: RegExp)
	{
		const summary = screen
			.getByRole(
				"button",
				{
					name,
				},
			)
			.querySelector<HTMLElement>("[data-rail-summary]");
		return {
			invisible: summary?.classList.contains("invisible"),
			ariaHidden: summary?.getAttribute("aria-hidden"),
		};
	}

	it("hides an open card's summary like upstream, and shows a collapsed one's", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);

		expect(
			{
				open: summaryOf(/^Progress/),
				collapsed: summaryOf(/^Context/),
			},
		).toStrictEqual(
			{
				open:
				{
					invisible: true,
					ariaHidden: "true",
				},
				collapsed:
				{
					invisible: false,
					ariaHidden: null,
				},
			},
		);
	});

	it("renders a rollup percentage with upstream's 24x10 mini meter, filled by severity", () =>
	{
		// Upstream's rail summary shell `Ne` (cdbb20c70), with the grip-hover fade.
		const ROLLUP_SHELL_CLASS =
			"ms-auto min-w-0 truncate ps-sm text-footnote font-normal text-muted-as-secondary group-hover/railtop:opacity-0 group-has-[[data-rail-grip]:focus-visible]/railtop:opacity-0 ";
		render(
			<SessionRail
				sessionId="s1"
				cards={[
					{
						id: "context",
						rollupPct: 18,
						body: <p>context body</p>,
					},
					{
						id: "environment",
						rollupPct: 80,
						body: <p>env body</p>,
					},
				]}
			/>,
		);
		const meter = (name: RegExp) =>
		{
			const summary = screen
				.getByRole(
					"button",
					{
						name,
					},
				)
				.querySelector<HTMLElement>("[data-rail-summary]");
			const track = summary?.querySelector<HTMLElement>(".h-2\\.5.w-6");
			const fill = track?.firstElementChild as HTMLElement | null | undefined;
			return {
				text: summary?.textContent,
				summaryClass: summary?.className,
				testId: track?.getAttribute("data-testid"),
				track: track?.className,
				trackHidden: track?.getAttribute("aria-hidden"),
				fill: fill?.className,
				width: fill?.style.width,
			};
		};

		expect(
			{
				context: meter(/^Context/),
				environment: meter(/^Environment/),
			},
		).toStrictEqual(
			{
				context:
				{
					text: "18%",
					summaryClass: ROLLUP_SHELL_CLASS,
					testId: "rail-meter",
					track: "flex h-2.5 w-6 shrink-0 rounded-full bg-alpha-2 p-0.5",
					trackHidden: "true",
					fill: "h-full min-w-1.5 rounded-full bg-fill-accent",
					width: "18%",
				},
				environment:
				{
					text: "80%",
					// Environment starts open, so its rollup hides under the open card.
					summaryClass: `${ROLLUP_SHELL_CLASS}invisible`,
					testId: "rail-meter",
					track: "flex h-2.5 w-6 shrink-0 rounded-full bg-alpha-2 p-0.5",
					trackHidden: "true",
					fill: "h-full min-w-1.5 rounded-full bg-usage-warning",
					width: "80%",
				},
			},
		);
	});

	it("draws a warning rollup as the warning-coloured summary and a Warning icon instead of the meter (upstream Ve)", () =>
	{
		render(
			<SessionRail
				sessionId="s1"
				cards={[
					{
						id: "context",
						summary: "190.2k / 200k",
						rollupWarning: "Limited until Claude Code updates",
						body: <p>context body</p>,
					},
				]}
			/>,
		);
		const summary = screen
			.getByRole(
				"button",
				{
					name: /^Context/,
				},
			)
			.querySelector<HTMLElement>("[data-rail-summary]");
		const shell = summary?.firstElementChild;
		const icon = shell?.querySelector("[data-cds='Icon']");
		expect(
			{
				text: summary?.textContent,
				shell: shell?.className,
				textClass: shell?.firstElementChild?.className,
				iconClass: icon?.getAttribute("class"),
				iconAlt: icon?.getAttribute("aria-label"),
				meter: summary?.querySelector("[data-testid='rail-meter']") ?? null,
			},
		).toStrictEqual(
			{
				text: "190.2k / 200k",
				shell: "flex items-center justify-end gap-1.5",
				textClass: "min-w-0 truncate text-warning",
				iconClass:
					"lucide lucide-triangle-exclamation-point lucide-alert-triangle lucide-triangle-alert shrink-0 text-fill-warning",
				iconAlt: "Limited until Claude Code updates",
				meter: null,
			},
		);
	});
});

describe("session rail header menu", () =>
{
	function menuRows(): Array<[string | null, string, string | null]>
	{
		const menu = screen.getByRole("menu");
		return [...menu.querySelectorAll<HTMLElement>("[role^=menuitem], [data-menu-label]")].map((item) => [
			item.getAttribute("role"),
			item.textContent,
			item.getAttribute("aria-checked") ?? item.getAttribute("aria-disabled"),
		]);
	}

	async function openHeaderMenu(title: RegExp)
	{
		fireEvent.contextMenu(
			screen.getByRole(
				"button",
				{
					name: title,
				},
			),
		);
		await settle();
	}

	function cardIds(): string[]
	{
		return [...document.querySelectorAll<HTMLElement>("[data-rail-section]")].map(
			(section) => section.dataset["railSection"] ?? "",
		);
	}

	it("lists upstream's Show checkboxes and a disabled Reset to defaults on right-click", async () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		await openHeaderMenu(/^Progress/);
		const widthClasses = [...screen.getByRole("menu").classList].filter(
			(name) => name.startsWith("w-") || name.startsWith("min-w-") || name.startsWith("max-w-"),
		);

		expect(widthClasses).toStrictEqual(["min-w-[128px]", "max-w-[320px]"]);
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

	it("hides a section from the Show group, and Reset to defaults brings it back", async () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		await openHeaderMenu(/^Environment/);
		fireEvent.click(
			screen.getByRole(
				"menuitemcheckbox",
				{
					name: "Context",
				},
			),
		);
		await settle();
		const hidden =
		{
			cards: cardIds(),
			stored: readRailSectionsState().hidden,
		};
		fireEvent.keyDown(
			screen.getByRole("menu"),
			{
				key: "Escape",
			},
		);
		await settle();
		await openHeaderMenu(/^Environment/);
		const reset = screen.getByRole(
			"menuitem",
			{
				name: "Reset to defaults",
			},
		);
		const resetDisabled = reset.getAttribute("aria-disabled");
		fireEvent.click(reset);
		await settle();

		expect(
			{
				hidden,
				resetDisabled,
				restored: cardIds(),
			},
		).toStrictEqual(
			{
				hidden:
				{
					cards: ["environment", "progress"],
					stored: ["context"],
				},
				resetDisabled: null,
				restored: ["environment", "context", "progress"],
			},
		);
	});
});

describe("session rail reorder", () =>
{
	it("draws the cards in the saved order", () =>
	{
		localStorage.setItem(
			RAIL_SECTIONS_STORAGE_KEY,
			JSON.stringify(
				{
					state:
					{
						foldsBySession: {},
						startsOpen:
						{
							environment: true,
							context: true,
						},
						hidden: [],
						order: ["progress", "environment"],
					},
					version: 0,
				},
			),
		);
		render(<SessionRail sessionId="s1" cards={CARDS} />);

		// Upstream's merge: the saved ids fill the slots they name, and Context keeps its default slot between them.
		expect(cardStates().map(([title]) => title)).toStrictEqual(["Progress1 of 3", "Context12%", "Environment"]);
	});

	it("gives each header upstream's hover-only Reorder grip, a keyboard-sortable handle", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const grip = screen.getByRole(
			"button",
			{
				name: "Reorder Progress",
			},
		);

		expect(
			{
				grip: grip.hasAttribute("data-rail-grip"),
				roledescription: grip.getAttribute("aria-roledescription"),
				tabIndex: grip.tabIndex,
				hoverOnly: grip.className.split(" ").filter((c) => c.includes("opacity")),
				grips: screen
					.getAllByRole(
						"button",
						{
							name: /^Reorder /,
						},
					)
					.map((each) => each.getAttribute("aria-label")),
			},
		).toStrictEqual(
			{
				grip: true,
				roledescription: "Draggable section",
				tabIndex: 0,
				hoverOnly: ["opacity-0", "group-hover/railtop:opacity-100", "focus-visible:opacity-100"],
				grips: ["Reorder Environment", "Reorder Context", "Reorder Progress"],
			},
		);
	});

	it("describes each grip with upstream's section pick-up instructions", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const grip = screen.getByRole(
			"button",
			{
				name: "Reorder Context",
			},
		);
		const describedBy = grip.getAttribute("aria-describedby") ?? "";

		expect(document.getElementById(describedBy)?.textContent).toBe(
			"To pick up a section, press Space or Enter. While it is picked up, press the up or down arrow key to move it, Space or Enter to drop it, or Escape to cancel.",
		);
	});

	it("announces a keyboard pick-up, move-over and cancel with upstream's section strings", async () =>
	{
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement)
		{
			const slot = this.closest("[data-rail-card]");
			const index = slot ? [...document.querySelectorAll("[data-rail-card]")].indexOf(slot) : 0;
			return DOMRect.fromRect(
				{
					x: 0,
					y: index * 100,
					width: 280,
					height: 80,
				},
			);
		});
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const grip = screen.getByRole(
			"button",
			{
				name: "Reorder Context",
			},
		);
		const announced: string[] = [];
		const observer = new MutationObserver(() =>
		{
			const text = document.querySelector("[aria-live]")?.textContent ?? "";
			if (text !== "" && announced.at(-1) !== text) announced.push(text);
		});
		observer.observe(
			document.body,
			{
				subtree: true,
				childList: true,
				characterData: true,
			},
		);

		for (const key of [" ", "Escape"])
		{
			await act(async () =>
			{
				fireEvent.keyDown(
					grip,
					{
						code: key === " " ? "Space" : key,
						key,
					},
				);
				await new Promise((resolve) =>
				{
					setTimeout(resolve, 0);
				});
			});
		}
		observer.disconnect();

		// dnd-kit's move-over on pick-up replaces the pick-up line in the same commit.
		expect(announced).toStrictEqual(["Context is now section 2 of 3.", "Moving Context was cancelled."]);
	});

	it("words every pick-up, move, drop and cancel announcement with the section's position", () =>
	{
		const {announcements} = railSectionAccessibility(["environment", "context", "progress"]);
		const context =
		{
			id: "context",
		};
		const progress =
		{
			id: "progress",
		};
		const event =
		{
			active: context,
			over: progress,
		} as unknown as Parameters<typeof announcements.onDragOver>[0];

		expect([
			announcements.onDragStart(event),
			announcements.onDragOver(event),
			announcements.onDragOver(
				{
					...event,
					over: null,
				},
			),
			announcements.onDragEnd(event),
			announcements.onDragEnd(
				{
					...event,
					over: null,
				},
			),
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

	it("rings the grip's 20px dot frame on keyboard focus like upstream", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const grip = screen.getByRole(
			"button",
			{
				name: "Reorder Context",
			},
		);
		const frame = grip.firstElementChild;

		expect(
			{
				gripOutline: grip.className.split(" ").filter((c) => c.includes("outline")),
				frame: frame?.className,
				dots: frame?.firstElementChild?.className,
				dotClasses: [...(frame?.firstElementChild?.children ?? [])].map(
					(dot) => `${dot.tagName}.${dot.className}`,
				),
			},
		).toStrictEqual(
			{
				gripOutline: ["outline-hidden"],
				frame: "flex size-5 items-center justify-center rounded group-focus-visible/railgrip:shadow-focus",
				dots: "grid grid-cols-2 gap-[3px] scale-75",
				dotClasses: Array.from(
					{
						length: 6,
					},
					() => "I.size-0.5 rounded-full bg-current",
				),
			},
		);
	});

	it("uses upstream's lined 10px word gap between row slots and gap-xs 6px across the header row", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const railtop = screen
			.getByRole(
				"button",
				{
					name: "Reorder Progress",
				},
			)
			.closest(".group\\/railtop");
		const gaps = (className: string | undefined) => className?.split(" ").filter((c) => c.startsWith("gap-"));

		expect(
			{
				row: gaps(RAIL_ROW_ACTION_CLASS),
				railtop: gaps(railtop?.className),
			},
		).toStrictEqual(
			{
				row: ["gap-2.5"],
				railtop: ["gap-1.5"],
			},
		);
	});
	it("wraps each card in upstream's div[data-rail-card] sortable slot, in card order", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const slots = [...document.querySelectorAll<HTMLElement>("section[data-rail-section]")].map((section) =>
		{
			const parent = section.parentElement;
			return {
				section: section.dataset["railSection"],
				tag: parent?.tagName,
				railCard: parent?.dataset["railCard"],
				className: parent?.className,
			};
		});

		expect(
			{
				slots,
				order: [...document.querySelectorAll<HTMLElement>("[data-rail-card]")].map(
					(each) => each.dataset["railCard"],
				),
			},
		).toStrictEqual(
			{
				slots: ["environment", "context", "progress"].map((id) => (
				{
					section: id,
					tag: "DIV",
					railCard: id,
					className: "relative flex flex-col rounded-r7 [[data-session-rail-flat]_&]:rounded-none",
				})),
				order: ["environment", "context", "progress"],
			},
		);
	});

	it("flattens the list and cards inside a [data-session-rail-flat] ancestor and draws upstream's zy hairline", () =>
	{
		render(
			<div data-session-rail-flat="">
				<SessionRail sessionId="s1" cards={CARDS} />
			</div>,
		);
		const list = document.querySelector("[data-rail-card]")?.parentElement;
		const flatClasses = [
			"relative",
			"before:absolute",
			"before:inset-x-4",
			"before:top-0",
			"before:h-px",
			"[[data-session-rail-flat]_:not(:empty):not([data-rail-slot-off])~[data-rail-card]>&]:before:bg-alpha-1",
			"[[data-session-rail-flat]_&]:rounded-none",
			"[[data-session-rail-flat]_&]:shadow-none",
		];

		expect(
			{
				list: ["[[data-session-rail-flat]_&]:gap-0", "[[data-session-rail-flat]_&]:p-0"].filter((name) =>
					list?.classList.contains(name),
				),
				sections: [...document.querySelectorAll<HTMLElement>("section[data-rail-section]")].map((section) =>
					flatClasses.filter((name) => section.classList.contains(name)),
				),
			},
		).toStrictEqual(
			{
				list: ["[[data-session-rail-flat]_&]:gap-0", "[[data-session-rail-flat]_&]:p-0"],
				sections: [flatClasses, flatClasses, flatClasses],
			},
		);
	});

	it("lifts the slot with bg-page and z-index 1 while a keyboard drag is active, leaving the section untransformed", async () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const grip = screen.getByRole(
			"button",
			{
				name: "Reorder Context",
			},
		);
		await act(async () =>
		{
			fireEvent.keyDown(
				grip,
				{
					code: "Space",
					key: " ",
				},
			);
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});
		const slot = document.querySelector<HTMLElement>('[data-rail-card="context"]');
		const section = document.querySelector<HTMLElement>('[data-rail-section="context"]');
		expect(
			{
				slotClasses: slot?.className.split(" ").filter((c) => c === "bg-page"),
				zIndex: slot?.style.zIndex,
				slotDragging: slot?.hasAttribute("data-dragging"),
				sectionStyle: section?.getAttribute("style"),
			},
		).toStrictEqual(
			{
				slotClasses: ["bg-page"],
				zIndex: "1",
				slotDragging: true,
				sectionStyle: null,
			},
		);
	});
});

describe("session rail lined layout", () =>
{
	/** The classes of `element` that appear in `wanted`, in `wanted`'s order. */
	function picked(element: Element | null | undefined, wanted: readonly string[]): string[]
	{
		const classes = new Set(element?.getAttribute("class")?.split(" "));
		return wanted.filter((each) => classes.has(each));
	}

	it("lines each card like upstream: a 24px header, 8px row pad, a 4px body top pad and pb 6px while open", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const section = document.querySelector('[data-rail-section="progress"]');
		const button = screen.getByRole(
			"button",
			{
				name: /^Progress/,
			},
		);
		const railtop = button.closest(".group\\/railtop");
		const body = section?.querySelector("[data-rail-body]");

		expect(
			{
				section: picked(section, ["epitaxy-rail-lined", "pt-2", "pb-2", "data-open:pb-1.5"]),
				railtop: picked(railtop, ["min-h-6", "min-h-6.5", "gap-1.5", "px-1.5", "px-2"]),
				button: picked(button, ["relative", "min-h-6", "min-h-6.5", "px-1", "px-2", "text-[12px]/[16px]"]),
				body: picked(body, ["flex", "flex-col", "px-1.5", "px-2", "pt-1", "[&_.px-xs]:px-2"]),
			},
		).toStrictEqual(
			{
				section: ["epitaxy-rail-lined", "pt-2", "pb-2", "data-open:pb-1.5"],
				railtop: ["min-h-6", "gap-1.5", "px-1.5"],
				button: ["relative", "min-h-6", "px-2", "text-[12px]/[16px]"],
				body: ["flex", "flex-col", "px-2", "pt-1", "[&_.px-xs]:px-2"],
			},
		);
	});

	it("gives rows upstream's 32px list-row height, 10px word gap and 8px row pad", () =>
	{
		const row = RAIL_ROW_ACTION_CLASS.split(" ");

		expect(["min-h-8", "min-h-6.5", "gap-2.5", "px-2", "px-1"].filter((each) => row.includes(each))).toStrictEqual([
			"min-h-8",
			"gap-2.5",
			"px-2",
		]);
	});

	it("hides an open card's caret until the header is hovered, focused within or touched", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const caret = (name: RegExp) =>
			screen
				.getByRole(
					"button",
					{
						name,
					},
				)
				.querySelector("svg");
		const fade = [
			"opacity-0",
			"group-hover/railtop:opacity-100",
			"group-focus-within/railtop:opacity-100",
			"touch:opacity-100",
		];

		expect(
			{
				open: picked(caret(/^Progress/), fade),
				collapsed: picked(caret(/^Context/), fade),
			},
		).toStrictEqual(
			{
				open: fade,
				collapsed: [],
			},
		);
	});

	it("toggles a card from a click on the grab zone inside the header button", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const button = screen.getByRole(
			"button",
			{
				name: /^Progress/,
			},
		);
		const grab = button.querySelector<HTMLElement>("[data-rail-grab]");
		if (grab === null) throw new Error("no grab zone");
		fireEvent.pointerDown(
			grab,
			{
				button: 0,
				isPrimary: true,
				clientX: 260,
				clientY: 10,
			},
		);
		fireEvent.pointerUp(
			grab,
			{
				button: 0,
				isPrimary: true,
				clientX: 260,
				clientY: 10,
			},
		);
		fireEvent.click(grab);

		expect(
			{
				grab: [
					grab.getAttribute("aria-hidden"),
					picked(grab, ["absolute", "inset-y-0", "end-0", "w-20", "cursor-grab"]),
				],
				open: document.querySelector('[data-rail-section="progress"]')?.hasAttribute("data-open"),
			},
		).toStrictEqual(
			{
				grab: ["true", ["absolute", "inset-y-0", "end-0", "w-20", "cursor-grab"]],
				open: false,
			},
		);
	});

	it("keeps the grip keyboard-only and labels each card by a div, like upstream", () =>
	{
		render(<SessionRail sessionId="s1" cards={CARDS} />);
		const section = document.querySelector('[data-rail-section="context"]');
		const labelledBy = section?.getAttribute("aria-labelledby") ?? "";

		expect(
			{
				grip: picked(
					screen.getByRole(
						"button",
						{
							name: "Reorder Context",
						},
					),
					["pointer-events-none"],
				),
				label: document.getElementById(labelledBy)?.tagName,
			},
		).toStrictEqual(
			{
				grip: ["pointer-events-none"],
				label: "DIV",
			},
		);
	});
});
