// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

vi.mock("@tanstack/react-router", () => (
{
	useNavigate: () => vi.fn<() => Promise<void>>(),
}));

import {TileHost} from "../src/components/panes/tile-host";
import {SideChat} from "../src/components/side-chat";
import {preloadSideChatPanel} from "../src/components/side-chat-panel-module";
import {ToastProvider} from "../src/components/toast";
import {askSideChat, getSideChat, openSideChat, resetSideChatStore, setSideChatMode} from "../src/lib/side-chat-store";

// The deferred chunks these tests render, loaded up front as the page warms them before first use.
beforeAll(async () =>
{
	await preloadSideChatPanel();
});

const SESSION_ID = "session-side-chat-variants";

class FakeStorage implements Storage
{
	readonly values = new Map<string, string>();

	get length(): number
	{
		return this.values.size;
	}

	clear(): void
	{
		this.values.clear();
	}

	getItem(key: string): string | null
	{
		return this.values.get(key) ?? null;
	}

	key(index: number): string | null
	{
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string): void
	{
		this.values.delete(key);
	}

	setItem(key: string, value: string): void
	{
		this.values.set(key, value);
	}
}

function ndjsonResponse(text: string): Response
{
	const events = [
		{
			type: "stream_event",
			event:
			{
				type: "content_block_delta",
				delta:
				{
					type: "text_delta",
					text,
				},
			},
		},
	];
	return new Response(
		events.map((event) => `${JSON.stringify(event)}\n`).join(""),
		{
			status: 200,
			headers:
			{
				"Content-Type": "application/x-ndjson",
				"X-Process-Id": "proc-1",
			},
		},
	);
}

function renderInHost()
{
	return render(
		<ToastProvider>
			<TileHost sessionId={SESSION_ID}>
				<p>Main chat</p>
				<SideChat sessionId={SESSION_ID} messageCount={7} />
			</TileHost>
		</ToastProvider>,
	);
}

function floatingCard(): HTMLElement | null
{
	return document.querySelector<HTMLElement>('aside[aria-label="Side chat"][data-open]');
}

function dockedPane(): HTMLElement | null
{
	return document.querySelector<HTMLElement>('[data-pane-root][data-pane-kind="side-chat"]');
}

function sideChatTab(): HTMLElement
{
	const tab = dockedPane()?.querySelector<HTMLElement>('[role="tab"]');
	if (tab === null || tab === undefined) throw new Error("No side chat tab");
	return tab;
}

function sideChatTabBox(): HTMLElement
{
	const box = dockedPane()?.querySelector<HTMLElement>("[data-vtb-id]");
	if (box === null || box === undefined) throw new Error("No side chat tab box");
	return box;
}

function openDocked()
{
	renderInHost();
	act(() =>
	{
		openSideChat(SESSION_ID);
		setSideChatMode(SESSION_ID, "docked");
	});
}

function menuOutline(menu: HTMLElement): (string | null)[]
{
	return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((node) =>
		node.getAttribute("role") === "separator" ? "---" : node.textContent,
	);
}

/** Where the Q/A history is visible: floating card, docked pane, or neither. */
function snapshot()
{
	const floating = floatingCard();
	const docked = dockedPane();
	const surface = floating ?? docked;
	return {
		mode: getSideChat(SESSION_ID).mode,
		floating: floating !== null,
		docked: docked !== null,
		history:
			surface === null
				? []
				: within(surface)
						.queryAllByRole("listitem")
						.map((item) => item.textContent),
	};
}

async function askOneQuestion()
{
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Promise.resolve(ndjsonResponse("It loads the config."))),
	);
	await act(async () => askSideChat(SESSION_ID, "What does load() do?"));
}

const HISTORY = ["What does load() do?It loads the config.\nCopyBranch"];

beforeEach(() =>
{
	resetSideChatStore();
	vi.stubGlobal("localStorage", new FakeStorage());
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
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("SideChat variants", () =>
{
	it("switches floating → docked → floating while keeping the Q/A history", async () =>
	{
		renderInHost();
		act(() =>
		{
			openSideChat(SESSION_ID);
		});
		await askOneQuestion();
		const floating = snapshot();

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Dock side chat",
				},
			),
		);
		const docked = snapshot();
		const dockedTitle = dockedPane()?.querySelector("[data-vtb-label]")?.textContent;
		const dockedMarked = dockedPane()?.querySelector('[data-side-session-pane=""]') !== null;

		fireEvent.contextMenu(sideChatTab());
		fireEvent.click(
			await waitFor(() =>
				screen.getByRole(
					"menuitem",
					{
						name: "Undock side chat",
					},
				),
			),
		);
		const refloated = snapshot();
		const floatingMarked = floatingCard()?.querySelector('[data-side-session-pane=""]') !== null;

		expect(
			{
				floating,
				docked,
				dockedTitle,
				dockedMarked,
				refloated,
				floatingMarked,
			},
		).toEqual(
			{
				floating:
				{
					mode: "floating",
					floating: true,
					docked: false,
					history: HISTORY,
				},
				docked:
				{
					mode: "docked",
					floating: false,
					docked: true,
					history: HISTORY,
				},
				dockedTitle: "Side chat",
				dockedMarked: true,
				refloated:
				{
					mode: "floating",
					floating: true,
					docked: false,
					history: HISTORY,
				},
				floatingMarked: true,
			},
		);
	});

	it("closes the docked pane with Close side chat, discarding its thread, and reopens docked and empty", async () =>
	{
		renderInHost();
		act(() =>
		{
			openSideChat(SESSION_ID);
		});
		await askOneQuestion();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Dock side chat",
				},
			),
		);

		const closeButton = dockedPane()?.querySelector<HTMLElement>('button[aria-label="Close side chat"]');
		if (closeButton === null || closeButton === undefined) throw new Error("No Close side chat button");
		fireEvent.click(closeButton);
		const closed =
		{
			...snapshot(),
			open: getSideChat(SESSION_ID).open,
		};

		act(() =>
		{
			openSideChat(SESSION_ID);
		});
		const reopened =
		{
			...snapshot(),
			open: getSideChat(SESSION_ID).open,
		};

		expect(
			{
				closed,
				reopened,
			},
		).toEqual(
			{
				closed:
				{
					mode: "docked",
					floating: false,
					docked: false,
					history: [],
					open: false,
				},
				reopened:
				{
					mode: "docked",
					floating: false,
					docked: true,
					history: [],
					open: true,
				},
			},
		);
	});

	it("pops out into a new window and returns to floating when that window closes", async () =>
	{
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const popup = frame.contentWindow;
		if (popup === null) throw new Error("iframe has no window");
		const close = vi.spyOn(popup, "close").mockImplementation(() => undefined);
		const open = vi.fn<() => Window>(() => popup);
		vi.stubGlobal("open", open);

		renderInHost();
		act(() =>
		{
			openSideChat(SESSION_ID);
		});
		await askOneQuestion();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open in new window",
				},
			),
		);

		const popped =
		{
			mode: getSideChat(SESSION_ID).mode,
			floating: floatingCard() !== null,
			docked: dockedPane() !== null,
			history: within(popup.document.body)
				.queryAllByRole("listitem")
				.map((item) => item.textContent),
			openCalls: open.mock.calls.length,
			marked: popup.document.body.querySelector('[data-side-session-pane=""]') !== null,
		};

		act(() =>
		{
			popup.dispatchEvent(new Event("pagehide"));
		});
		const returned = snapshot();

		expect(
			{
				popped,
				returned,
				closed: close.mock.calls.length > 0,
			},
		).toEqual(
			{
				popped:
				{
					mode: "popout",
					floating: false,
					docked: false,
					history: HISTORY,
					openCalls: 1,
					marked: true,
				},
				returned:
				{
					mode: "floating",
					floating: true,
					docked: false,
					history: HISTORY,
				},
				closed: true,
			},
		);
		frame.remove();
	});

	it("stays floating when the browser blocks the pop-out window", async () =>
	{
		vi.stubGlobal(
			"open",
			vi.fn(() => null),
		);
		renderInHost();
		act(() =>
		{
			openSideChat(SESSION_ID);
		});
		await askOneQuestion();

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open in new window",
				},
			),
		);

		expect(snapshot()).toEqual(
			{
				mode: "floating",
				floating: true,
				docked: false,
				history: HISTORY,
			},
		);
	});

	it("draws the docked header as upstream's one-tab Side chat strip beside the host's Expand and Close", () =>
	{
		openDocked();
		const pane = dockedPane();
		if (pane === null) throw new Error("No docked pane");
		const tablist = pane.querySelector<HTMLElement>('[role="tablist"]');
		const box = sideChatTabBox();
		const tab = sideChatTab();
		const hintId = tab.getAttribute("aria-describedby");
		const hint = hintId === null ? null : document.getElementById(hintId);
		const close = box.querySelector<HTMLElement>('button[aria-label="Close side chat"]');
		const header = pane.querySelector<HTMLElement>("[data-pane-corner-row]");

		expect(
			{
				toolbar: pane.querySelector('[role="toolbar"]')?.getAttribute("aria-label"),
				tablist:
				{
					label: tablist?.getAttribute("aria-label"),
					pillHeight: tablist?.style.getPropertyValue("--vtb-pill-h"),
					pillCorner: tablist?.style.getPropertyValue("--vtb-pill-corner"),
				},
				boxes: pane.querySelectorAll("[data-vtb-id]").length,
				box:
				{
					id: box.getAttribute("data-vtb-id"),
					selected: box.getAttribute("data-selected"),
					solo: box.getAttribute("data-vtb-solo"),
					noIcon: box.getAttribute("data-vtb-no-icon"),
					width: box.style.width,
					flexBasis: box.style.flexBasis,
				},
				tab:
				{
					tabIndex: tab.getAttribute("tabindex"),
					selected: tab.getAttribute("aria-selected"),
					posinset: tab.getAttribute("aria-posinset"),
					setsize: tab.getAttribute("aria-setsize"),
					label: tab.querySelector("[data-vtb-label]")?.textContent,
				},
				hint:
				{
					srOnly: hint?.classList.contains("sr-only"),
					text: hint?.textContent,
				},
				close:
				{
					tabIndex: close?.getAttribute("tabindex"),
					hidden: close?.getAttribute("aria-hidden"),
					size: close?.getAttribute("data-size"),
				},
				actions: [...(pane.querySelector("[data-pane-actions]")?.querySelectorAll("button") ?? [])].map(
					(button) => button.getAttribute("aria-label"),
				),
				leftovers:
				{
					heading: header?.querySelector("h2") ?? null,
					shortcut: header?.querySelector('[data-cds="Shortcut"]') ?? null,
					buttons: ["Clear side chat", "Undock side chat", "Open in new window"].filter(
						(label) => header?.querySelector(`button[aria-label="${label}"]`) !== null,
					),
				},
			},
		).toStrictEqual(
			{
				toolbar: "Side chat controls",
				tablist:
				{
					label: "Side chat tabs",
					pillHeight: "var(--cds-h-control)",
					pillCorner: "var(--cds-radius)",
				},
				boxes: 1,
				box:
				{
					id: `side-chat:${SESSION_ID}`,
					selected: "true",
					solo: "true",
					noIcon: "",
					width: "180px",
					flexBasis: "180px",
				},
				tab:
				{
					tabIndex: "0",
					selected: "true",
					posinset: "1",
					setsize: "1",
					label: "Side chat",
				},
				hint:
				{
					srOnly: true,
					text: "Press Delete or Backspace to close the side chat. A working side chat is stopped first.",
				},
				close:
				{
					tabIndex: "-1",
					hidden: "true",
					size: "xs",
				},
				actions: ["Expand", "Close"],
				leftovers:
				{
					heading: null,
					shortcut: null,
					buttons: [],
				},
			},
		);
	});

	it("announces a working side chat inside the tab label", async () =>
	{
		openDocked();
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Promise<Response>(() =>
					{
						// Never answers, so the entry stays pending.
					}),
			),
		);
		act(() =>
		{
			void askSideChat(SESSION_ID, "Still thinking?");
		});
		await waitFor(() =>
		{
			expect(sideChatTab().querySelector("[data-vtb-label]")?.textContent).toBe("Side chat, Working");
		});
	});

	it.each(["Delete", "Backspace"])("closes the side chat with %s on the focused tab", (key) =>
	{
		openDocked();
		const event = new KeyboardEvent(
			"keydown",
			{
				key,
				bubbles: true,
				cancelable: true,
			},
		);
		act(() =>
		{
			sideChatTab().dispatchEvent(event);
		});
		expect(
			{
				prevented: event.defaultPrevented,
				open: getSideChat(SESSION_ID).open,
				docked: dockedPane() !== null,
			},
		).toStrictEqual(
			{
				prevented: true,
				open: false,
				docked: false,
			},
		);
	});

	it("ignores an auto-repeated or modified Delete on the tab", () =>
	{
		openDocked();
		fireEvent.keyDown(
			sideChatTab(),
			{
				key: "Delete",
				repeat: true,
			},
		);
		fireEvent.keyDown(
			sideChatTab(),
			{
				key: "Delete",
				metaKey: true,
			},
		);
		fireEvent.keyDown(
			sideChatTab(),
			{
				key: "Backspace",
				ctrlKey: true,
			},
		);
		expect(
			{
				open: getSideChat(SESSION_ID).open,
				docked: dockedPane() !== null,
			},
		).toStrictEqual(
			{
				open: true,
				docked: true,
			},
		);
	});

	it("closes the side chat on a middle click of the tab, preventing its mousedown", () =>
	{
		openDocked();
		const mouseDownAllowed = fireEvent.mouseDown(
			sideChatTabBox(),
			{
				button: 1,
			},
		);
		act(() =>
		{
			sideChatTabBox().dispatchEvent(
				new MouseEvent(
					"auxclick",
					{
						button: 1,
						bubbles: true,
					},
				),
			);
		});
		expect(
			{
				mouseDownAllowed,
				open: getSideChat(SESSION_ID).open,
				docked: dockedPane() !== null,
			},
		).toStrictEqual(
			{
				mouseDownAllowed: false,
				open: false,
				docked: false,
			},
		);
	});

	it("opens the tab menu on right-click with the local dock actions above Close", async () =>
	{
		openDocked();
		fireEvent.contextMenu(
			sideChatTab(),
			{
				clientX: 20,
				clientY: 20,
			},
		);
		const menu = await waitFor(() => screen.getByRole("menu"));
		const opened =
		{
			outline: menuOutline(menu),
			popupOpen: sideChatTabBox().hasAttribute("data-popup-open"),
			pressed: sideChatTabBox().hasAttribute("data-pressed"),
		};

		fireEvent.click(
			within(menu).getByRole(
				"menuitem",
				{
					name: "Close side chat",
				},
			),
		);

		expect(
			{
				opened,
				open: getSideChat(SESSION_ID).open,
				docked: dockedPane() !== null,
			},
		).toStrictEqual(
			{
				opened:
				{
					outline: ["Undock side chat", "Open in new window", "---", "Close side chat"],
					popupOpen: true,
					pressed: true,
				},
				open: false,
				docked: false,
			},
		);
	});
});
