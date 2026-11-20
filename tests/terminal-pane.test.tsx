// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {useEffect} from "react";
import {z} from "zod";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {usePaneHost} from "../src/components/panes/pane-host-context";
import {TileHost} from "../src/components/panes/tile-host";
import {TerminalPaneShortcut} from "../src/components/panes/terminal-pane-shortcut";
import {preloadTerminalPane, useRegisterTerminalPane} from "../src/components/panes/terminal-pane-entry";
import {terminalShortcutAction} from "../src/components/panes/terminal-shortcut-action";
import {SettingsProvider} from "../src/components/settings-provider";
import {clearShellTabs} from "../src/lib/shell-tabs";
import {terminalTabsStorageKey} from "../src/lib/terminal-tabs";
import {SessionPaneControls} from "../src/components/view-options-menu";
import {validateSessionSearch} from "../src/lib/session-search";
import {installLocalStorage} from "./fake-storage";

vi.mock("../src/components/herdr-terminal", () => (
{
	HerdrTerminal: ({sessionId, interactive}: {sessionId: string; interactive?: boolean}) => (
		<p data-testid="herdr-terminal" data-interactive={String(interactive ?? false)}>
			{sessionId}
		</p>
	),
}));

vi.mock("../src/components/shell-terminal", () => (
{
	ShellTerminal: ({
		ptyKey,
		closeRequested,
		onClosed,
	}: {
		ptyKey: string;
		closeRequested: boolean;
		onClosed: () => void;
	}) =>
	{
		useEffect(() =>
		{
			if (closeRequested) onClosed();
		}, [closeRequested, onClosed]);
		return <p data-testid="shell-terminal">{ptyKey}</p>;
	},
}));

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

const SESSION_ID = "terminal-pane-session";

/** Stand-in for View options ▸ Terminal, so tests can toggle the pane and read its state in one click. */
function TestTerminalToggle()
{
	const host = usePaneHost();
	return (
		<button
			type="button"
			aria-label="Terminal"
			aria-pressed={host.isOpen("terminal")}
			onClick={() =>
			{
				host.togglePane("terminal");
			}}
		/>
	);
}

function Harness({
	available,
	interactive,
	shells,
	openTerminalHere,
}: {
	available: boolean;
	interactive: boolean;
	shells: boolean;
	openTerminalHere?: (() => Promise<void>) | undefined;
})
{
	useRegisterTerminalPane(
		SESSION_ID,
		{
			livePane: available,
			interactive,
			shells,
		},
		openTerminalHere,
	);
	return (
		<>
			<TerminalPaneShortcut available={available || shells} shells={shells} />
			<SessionPaneControls facts={{}} />
			<TestTerminalToggle />
			<textarea aria-label="Composer" />
		</>
	);
}

interface SessionOptions
{
	pane?: "terminal";
	onHandled?: () => void;
	interactive?: boolean;
	shells?: boolean;
	openTerminalHere?: () => Promise<void>;
}

function sessionTree(available: boolean, requested: SessionOptions)
{
	return (
		<SettingsProvider>
			<TileHost
				sessionId={SESSION_ID}
				onExpandWithoutPane={() =>
				{
				}}
				requestedPane={requested.pane}
				onRequestedPaneHandled={requested.onHandled}
			>
				<Harness
					available={available}
					interactive={requested.interactive ?? false}
					shells={requested.shells ?? false}
					openTerminalHere={requested.openTerminalHere}
				/>
			</TileHost>
		</SettingsProvider>
	);
}

function renderSession(available: boolean, requested: SessionOptions = {})
{
	const result = render(sessionTree(available, requested));
	return {
		...result,
		setAvailable: (next: boolean) =>
		{
			result.rerender(sessionTree(next, requested));
		},
	};
}

const CTRL_BACKQUOTE =
{
	key: "`",
	code: "Backquote",
	ctrlKey: true,
};

function pressOn(target: Element, init: KeyboardEventInit): KeyboardEvent
{
	const event = new KeyboardEvent(
		"keydown",
		{
			bubbles: true,
			cancelable: true,
			...init,
		},
	);
	act(() =>
	{
		target.dispatchEvent(event);
	});
	return event;
}

let storage: ReturnType<typeof installLocalStorage>;

// The pane renderer is deferred off the cold load; settle its download first so it renders in the first pass.
beforeAll(async () =>
{
	await preloadTerminalPane();
});

beforeEach(() =>
{
	storage = installLocalStorage();
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
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
	cleanup();
	clearShellTabs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("terminalShortcutAction", () =>
{
	it("follows upstream's ⌃` state machine", () =>
	{
		const table = [
			{
				available: false,
				open: false,
				focusedTile: "chat",
				focusInTerminal: false,
			},
			{
				available: true,
				open: false,
				focusedTile: "chat",
				focusInTerminal: false,
			},
			{
				available: true,
				open: true,
				focusedTile: "changes",
				focusInTerminal: false,
			},
			{
				available: true,
				open: true,
				focusedTile: "terminal",
				focusInTerminal: true,
			},
			{
				available: true,
				open: true,
				focusedTile: "terminal",
				focusInTerminal: false,
			},
		] as const;

		expect(table.map((input) => terminalShortcutAction(input))).toStrictEqual([
			"noop",
			"open",
			"focus",
			"close",
			"caret",
		]);
	});
});

describe("Terminal pane", () =>
{
	it("leaves View options out when herdr has no pane for the session", () =>
	{
		renderSession(false);

		expect(
			screen.queryByRole(
				"button",
				{
					name: "View options",
				},
			),
		).toBeNull();
	});

	it("lists Terminal in View options with its ⌃` shortcut, not as a trail toggle", async () =>
	{
		renderSession(true);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "View options",
				},
			),
		);
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});
		const item = screen.getByRole(
			"menuitemcheckbox",
			{
				name: /^Terminal/,
			},
		);

		expect(
			{
				checked: item.getAttribute("aria-checked"),
				keys: item.getAttribute("aria-keyshortcuts"),
			},
		).toStrictEqual(
			{
				checked: "false",
				keys: "Control+Backquote",
			},
		);
	});

	it("opens the Claude tab with the toggle", () =>
	{
		renderSession(true);

		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});

		expect(
			{
				pressed: screen
					.getByRole(
						"button",
						{
							name: "Terminal",
						},
					)
					.getAttribute("aria-pressed"),
				tabs: screen.getAllByRole("tab").map((tab) => (
				{
					name: tab.textContent,
					selected: tab.getAttribute("aria-selected"),
				})),
				terminal: screen.getByTestId("herdr-terminal").textContent,
			},
		).toStrictEqual(
			{
				pressed: "true",
				tabs: [
					{
						name: "Claude",
						selected: "true",
					},
				],
				terminal: SESSION_ID,
			},
		);
	});

	it.each([
		[false, "false"],
		[true, "true"],
	])("makes the Claude tab interactive only when herdr writes are enabled (%s)", (writes, expected) =>
	{
		renderSession(
			true,
			{
				interactive: writes,
			},
		);

		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});

		expect(screen.getByTestId("herdr-terminal").getAttribute("data-interactive")).toBe(expected);
	});

	it("⌃` opens and focuses the pane, and pressing it again inside closes it", () =>
	{
		renderSession(true);
		const composer = screen.getByRole(
			"textbox",
			{
				name: "Composer",
			},
		);
		composer.focus();

		const opened = pressOn(composer, CTRL_BACKQUOTE);
		const afterOpen = screen
			.getByRole(
				"button",
				{
					name: "Terminal",
				},
			)
			.getAttribute("aria-pressed");
		const focused = document.activeElement?.getAttribute("aria-label") ?? null;
		const closed = pressOn(document.activeElement ?? document.body, CTRL_BACKQUOTE);

		expect(
			{
				afterOpen,
				focused,
				afterClose: screen
					.getByRole(
						"button",
						{
							name: "Terminal",
						},
					)
					.getAttribute("aria-pressed"),
				prevented: [opened.defaultPrevented, closed.defaultPrevented],
			},
		).toStrictEqual(
			{
				afterOpen: "true",
				focused: "Claude terminal",
				afterClose: "false",
				prevented: [true, true],
			},
		);
	});

	it("⌃` does nothing without a live pane", () =>
	{
		renderSession(false);

		const event = pressOn(document.body, CTRL_BACKQUOTE);

		expect(event.defaultPrevented).toBe(false);
	});
});

describe("Shell tabs", () =>
{
	function stubShellApi(
		created: Array<
		{
			status: number;
			body: unknown;
		}>,
		busy: readonly string[] = [],
	)
	{
		const fetcher = vi.fn<typeof fetch>(async (input, init) =>
		{
			if (input === "/api/shell-busy")
			{
				const {ptyKeys} = z
					.object(
						{
							ptyKeys: z.array(z.string()),
						},
					)
					.parse(JSON.parse(typeof init?.body === "string" ? init.body : "null"));
				return Promise.resolve(
					Response.json(
						{
							busy: ptyKeys.filter((key) => busy.includes(key)),
						},
					),
				);
			}
			const next = created.shift();
			if (!next) return Promise.reject(new Error("unexpected shell request"));
			return Promise.resolve(
				Response.json(
					next.body,
					{
						status: next.status,
					},
				),
			);
		});
		vi.stubGlobal("fetch", fetcher);
		return fetcher;
	}

	async function flush()
	{
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});
	}

	/** Resolves on the next save of this session's tab list, which dispatchTerminalTabs makes as it adds a tab. */
	async function nextTabsWrite(): Promise<void>
	{
		return new Promise((resolve) =>
		{
			const save = storage.setItem.bind(storage);
			const spy = vi.spyOn(storage, "setItem").mockImplementation((key, value) =>
			{
				save(key, value);
				if (key !== terminalTabsStorageKey(SESSION_ID)) return;
				spy.mockRestore();
				resolve();
			});
		});
	}

	async function openWithShells(ptyKeys: readonly string[], busy: readonly string[] = [])
	{
		stubShellApi(
			ptyKeys.map((ptyKey) => (
			{
				status: 200,
				body:
				{
					ptyKey,
				},
			})),
			busy,
		);
		const view = renderSession(
			true,
			{
				shells: true,
			},
		);
		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});
		for (const _ of ptyKeys)
		{
			const added = nextTabsWrite();
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "New terminal",
					},
				),
			);
			// Await the store's add itself, not a wall-clock budget: its render is queued in this act and commits
			// with the button re-enabled when the act ends.
			await act(async () =>
			{
				await added;
			});
		}
		// Let the new tab take focus in its frame, as upstream's addTab does, before the test moves focus elsewhere.
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				requestAnimationFrame(resolve);
			});
		});
		return view;
	}

	async function openTabMenu(name: string): Promise<HTMLElement>
	{
		fireEvent.contextMenu(
			screen.getByRole(
				"tab",
				{
					name,
				},
			),
			{
				clientX: 20,
				clientY: 20,
			},
		);
		await flush();
		return await waitFor(() => screen.getByRole("menu"));
	}

	async function chooseFromTabMenu(name: string, label: string)
	{
		const menu = await openTabMenu(name);
		const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
			(node) => node.textContent === label,
		);
		if (item === undefined) throw new Error(`No menu item ${label}`);
		fireEvent.click(item);
		await flush();
	}

	function tabs()
	{
		return screen.getAllByRole("tab").map((tab) => (
		{
			name: tab.textContent,
			selected: tab.getAttribute("aria-selected"),
		}));
	}

	it("offers the Terminal pane without a live herdr pane and starts a shell on open", async () =>
	{
		const fetcher = stubShellApi([
			{
				status: 200,
				body:
				{
					ptyKey: "pty-alice-1",
				},
			},
		]);
		renderSession(
			false,
			{
				shells: true,
			},
		);

		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});
		await screen.findByTestId("shell-terminal");

		expect(
			{
				requests: fetcher.mock.calls.map(([url, init]) => [url, init?.method]),
				tabs: tabs(),
				shell: screen.getByTestId("shell-terminal").textContent,
				claude: screen.queryByTestId("herdr-terminal"),
			},
		).toStrictEqual(
			{
				requests: [[`/api/sessions/${SESSION_ID}/shell`, "POST"]],
				tabs: [
					{
						name: "Shell",
						selected: "true",
					},
				],
				shell: "pty-alice-1",
				claude: null,
			},
		);
	});

	it("adds numbered Shell tabs after Claude with New terminal and closes them", async () =>
	{
		stubShellApi([
			{
				status: 200,
				body:
				{
					ptyKey: "pty-alice-1",
				},
			},
			{
				status: 200,
				body:
				{
					ptyKey: "pty-alice-2",
				},
			},
		]);
		renderSession(
			true,
			{
				shells: true,
			},
		);
		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "New terminal",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.getAllByRole("tab")).toHaveLength(2);
		});
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "New terminal",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.getAllByRole("tab")).toHaveLength(3);
		});
		const focusTargets = () =>
			[...document.querySelectorAll("[data-tile-focus-target]")].map((panel) => [
				panel.getAttribute("role"),
				panel.getAttribute("aria-label"),
			]);
		const afterAdd = tabs();
		const targetsAfterAdd = focusTargets();
		const owners = screen
			.getAllByRole(
				"tabpanel",
				{
					hidden: true,
				},
			)
			.map((panel) => [panel.getAttribute("aria-label"), panel.getAttribute("data-owns-typing-and-pastes")]);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Close Shell 2",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.getAllByRole("tab")).toHaveLength(2);
		});

		expect(
			{
				afterAdd,
				owners,
				afterClose: tabs(),
				targetsAfterAdd,
				targetsAfterClose: focusTargets(),
			},
		).toStrictEqual(
			{
				// Upstream cc4b9f569 marks the terminal as its tile's focus target; locally the active panel is that surface.
				targetsAfterAdd: [["tabpanel", "Shell 2 terminal"]],
				targetsAfterClose: [["tabpanel", "Shell terminal"]],
				owners: [
					["Claude terminal", ""],
					["Shell terminal", ""],
					["Shell 2 terminal", ""],
				],
				afterAdd: [
					{
						name: "Claude",
						selected: "false",
					},
					{
						name: "Shell",
						selected: "false",
					},
					{
						name: "Shell 2",
						selected: "true",
					},
				],
				afterClose: [
					{
						name: "Claude",
						selected: "false",
					},
					{
						name: "Shell",
						selected: "true",
					},
				],
			},
		);
	});

	const CTRL_SHIFT_BACKQUOTE =
	{
		key: "~",
		code: "Backquote",
		ctrlKey: true,
		shiftKey: true,
	};

	function focusedPanel(): string | null | undefined
	{
		return document.activeElement?.getAttribute("aria-label");
	}

	function openPane()
	{
		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});
	}

	it("cycles tabs with ⌃⇧] and ⌃⇧[ from inside the pane, wrapping and focusing the new terminal, and ignores key repeat", async () =>
	{
		await openWithShells(["pty-alice-1", "pty-alice-2"]);
		const panel = () => document.querySelector<HTMLElement>("[data-terminal-focus]");
		act(() =>
		{
			panel()?.focus();
		});
		const step = async (init: KeyboardEventInit) =>
		{
			const target = panel();
			if (target === null) throw new Error("no active panel");
			const event = pressOn(target, init);
			await flush();
			await waitFor(() =>
			{
				expect(focusedPanel()).toBe(panel()?.getAttribute("aria-label"));
			});
			return {
				prevented: event.defaultPrevented,
				selected: tabs().find((tab) => tab.selected === "true")?.name,
				focused: focusedPanel(),
			};
		};
		const next =
		{
			key: "}",
			code: "BracketRight",
			ctrlKey: true,
			shiftKey: true,
		};
		const prev =
		{
			key: "{",
			code: "BracketLeft",
			ctrlKey: true,
			shiftKey: true,
		};

		expect([
			await step(next),
			await step(next),
			await step(prev),
			await step(
				{
					...prev,
					repeat: true,
				},
			),
		]).toStrictEqual([
			{
				prevented: true,
				selected: "Claude",
				focused: "Claude terminal",
			},
			{
				prevented: true,
				selected: "Shell",
				focused: "Shell terminal",
			},
			{
				prevented: true,
				selected: "Claude",
				focused: "Claude terminal",
			},
			{
				prevented: true,
				selected: "Claude",
				focused: "Claude terminal",
			},
		]);
	});

	it("adds and focuses a Shell tab with ⌃⇧` from inside the pane and from the composer", async () =>
	{
		const fetcher = stubShellApi([
			{
				status: 200,
				body:
				{
					ptyKey: "pty-alice-1",
				},
			},
			{
				status: 200,
				body:
				{
					ptyKey: "pty-alice-2",
				},
			},
		]);
		renderSession(
			true,
			{
				shells: true,
			},
		);
		openPane();
		const claude = document.querySelector<HTMLElement>("[data-terminal-focus]");
		if (claude === null) throw new Error("no Claude panel");
		act(() =>
		{
			claude.focus();
		});
		const fromPane = pressOn(claude, CTRL_SHIFT_BACKQUOTE).defaultPrevented;
		await waitFor(() =>
		{
			expect(focusedPanel()).toBe("Shell terminal");
		});
		const afterPane = tabs();
		const fromComposer = pressOn(
			screen.getByRole(
				"textbox",
				{
					name: "Composer",
				},
			),
			CTRL_SHIFT_BACKQUOTE,
		).defaultPrevented;
		await waitFor(() =>
		{
			expect(focusedPanel()).toBe("Shell 2 terminal");
		});

		expect(
			{
				fromPane,
				fromComposer,
				afterPane,
				afterComposer: tabs(),
				requests: fetcher.mock.calls.length,
			},
		).toStrictEqual(
			{
				fromPane: true,
				fromComposer: true,
				afterPane: [
					{
						name: "Claude",
						selected: "false",
					},
					{
						name: "Shell",
						selected: "true",
					},
				],
				afterComposer: [
					{
						name: "Claude",
						selected: "false",
					},
					{
						name: "Shell",
						selected: "false",
					},
					{
						name: "Shell 2",
						selected: "true",
					},
				],
				requests: 2,
			},
		);
	});

	it("opens the closed pane on ⌃⇧` focused on a new Shell tab, reusing the shell it starts on its own", async () =>
	{
		const fetcher = stubShellApi([
			{
				status: 200,
				body:
				{
					ptyKey: "pty-alice-1",
				},
			},
		]);
		renderSession(
			false,
			{
				shells: true,
			},
		);
		const event = pressOn(document.body, CTRL_SHIFT_BACKQUOTE);
		await waitFor(() =>
		{
			expect(focusedPanel()).toBe("Shell terminal");
		});
		await flush();

		expect(
			{
				prevented: event.defaultPrevented,
				tabs: tabs(),
				requests: fetcher.mock.calls.length,
			},
		).toStrictEqual(
			{
				prevented: true,
				tabs: [
					{
						name: "Shell",
						selected: "true",
					},
				],
				requests: 1,
			},
		);
	});

	it("opens the closed pane on ⌃⇧` with a new Shell beside Claude", async () =>
	{
		stubShellApi([
			{
				status: 200,
				body:
				{
					ptyKey: "pty-alice-1",
				},
			},
		]);
		renderSession(
			true,
			{
				shells: true,
			},
		);
		pressOn(document.body, CTRL_SHIFT_BACKQUOTE);
		await waitFor(() =>
		{
			expect(focusedPanel()).toBe("Shell terminal");
		});

		expect(tabs()).toStrictEqual([
			{
				name: "Claude",
				selected: "false",
			},
			{
				name: "Shell",
				selected: "true",
			},
		]);
	});

	it("leaves ⌃⇧` alone when Shell tabs are turned off", async () =>
	{
		const fetcher = stubShellApi([]);
		renderSession(
			true,
			{
				shells: false,
			},
		);
		const closed = pressOn(document.body, CTRL_SHIFT_BACKQUOTE).defaultPrevented;
		openPane();
		const panel = document.querySelector<HTMLElement>("[data-terminal-focus]");
		if (panel === null) throw new Error("no Claude panel");
		act(() =>
		{
			panel.focus();
		});
		const inside = pressOn(panel, CTRL_SHIFT_BACKQUOTE).defaultPrevented;
		await flush();

		expect(
			{
				closed,
				inside,
				tabs: tabs(),
				requests: fetcher.mock.calls.length,
			},
		).toStrictEqual(
			{
				closed: false,
				inside: false,
				tabs: [
					{
						name: "Claude",
						selected: "true",
					},
				],
				requests: 0,
			},
		);
	});

	it("shows New terminal ⌃⇧` in a tooltip below the + button instead of a native title", async () =>
	{
		stubShellApi([]);
		renderSession(
			true,
			{
				shells: true,
			},
		);
		openPane();
		const button = screen.getByRole(
			"button",
			{
				name: "New terminal",
			},
		);
		fireEvent.pointerEnter(button);
		const tip = await screen.findByRole(
			"tooltip",
			{},
			{
				timeout: 1000,
			},
		);

		expect(
			{
				title: button.getAttribute("title"),
				keys: button.getAttribute("aria-keyshortcuts"),
				tip: tip.textContent,
				side: tip.getAttribute("data-side"),
			},
		).toStrictEqual(
			{
				title: null,
				keys: "Control+Shift+Backquote",
				tip: "New terminal⌃Control⇧Shift`",
				side: "bottom",
			},
		);
	});

	it("reports a missing session folder instead of adding a tab", async () =>
	{
		stubShellApi([
			{
				status: 409,
				body:
				{
					error: "Session folder not found",
				},
			},
		]);
		renderSession(
			true,
			{
				shells: true,
			},
		);
		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "New terminal",
				},
			),
		);

		expect(
			{
				alert: (await screen.findByRole("alert")).textContent,
				tabs: tabs(),
			},
		).toStrictEqual(
			{
				alert: "Session folder not found",
				tabs: [
					{
						name: "Claude",
						selected: "true",
					},
				],
			},
		);
	});

	it("hides New terminal when Shell tabs are turned off", () =>
	{
		renderSession(
			true,
			{
				shells: false,
			},
		);
		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});

		expect(
			screen.queryByRole(
				"button",
				{
					name: "New terminal",
				},
			),
		).toBeNull();
	});

	it("offers Rename, Close and Close other terminals per tab, and Close others alone on Claude", async () =>
	{
		await openWithShells(["pty-alice-1", "pty-alice-2"]);

		const outline = (menu: HTMLElement) =>
			[...menu.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent);
		const shellMenu = outline(await openTabMenu("Shell 2"));
		fireEvent.keyDown(
			screen.getByRole("menu"),
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		const claudeMenu = outline(await openTabMenu("Claude"));

		expect(
			{
				shellMenu,
				claudeMenu,
				popupPrevented: !fireEvent.contextMenu(screen.getAllByRole("menuitem")[0]!),
			},
		).toStrictEqual(
			{
				shellMenu: ["Rename terminal", "Close terminal", "Close other terminals"],
				claudeMenu: ["Close other terminals"],
				popupPrevented: true,
			},
		);
	});

	it("renames a tab inline and remembers the name", async () =>
	{
		await openWithShells(["pty-alice-1"]);

		await chooseFromTabMenu("Shell", "Rename terminal");
		const input = await waitFor(() =>
			screen.getByRole(
				"textbox",
				{
					name: "Rename terminal",
				},
			),
		);
		fireEvent.change(
			input,
			{
				target:
				{
					value: "  dev server  ",
				},
			},
		);
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
			},
		);
		await flush();

		expect(
			{
				tabs: tabs(),
				stored: z
					.looseObject(
						{
							tabs: z.array(
								z.looseObject(
									{
										title: z.string(),
									},
								),
							),
						},
					)
					.parse(JSON.parse(storage.getItem(terminalTabsStorageKey(SESSION_ID)) ?? "null"))
					.tabs.map((tab) => tab.title),
			},
		).toStrictEqual(
			{
				tabs: [
					{
						name: "Claude",
						selected: "false",
					},
					{
						name: "dev server",
						selected: "true",
					},
				],
				stored: ["dev server"],
			},
		);
	});

	it("closes the other terminals, keeping Claude and the chosen tab", async () =>
	{
		await openWithShells(["pty-alice-1", "pty-alice-2", "pty-alice-3"]);

		await chooseFromTabMenu("Shell 2", "Close other terminals");
		await waitFor(() =>
		{
			expect(screen.getAllByRole("tab")).toHaveLength(2);
		});

		expect(tabs()).toStrictEqual([
			{
				name: "Claude",
				selected: "false",
			},
			{
				name: "Shell 2",
				selected: "true",
			},
		]);
	});

	it("closes the focused tab with Delete or Backspace, but never Claude", async () =>
	{
		await openWithShells(["pty-alice-1", "pty-alice-2"]);

		fireEvent.keyDown(
			screen.getByRole(
				"tab",
				{
					name: "Shell 2",
				},
			),
			{
				key: "Backspace",
			},
		);
		await waitFor(() =>
		{
			expect(screen.getAllByRole("tab")).toHaveLength(2);
		});
		fireEvent.keyDown(
			screen.getByRole(
				"tab",
				{
					name: "Shell",
				},
			),
			{
				key: "Delete",
			},
		);
		await waitFor(() =>
		{
			expect(screen.getAllByRole("tab")).toHaveLength(1);
		});
		fireEvent.keyDown(
			screen.getByRole(
				"tab",
				{
					name: "Claude",
				},
			),
			{
				key: "Delete",
			},
		);
		await flush();

		expect(
			{
				tabs: tabs(),
				closeClaude: screen.queryByRole(
					"button",
					{
						name: "Close Claude",
					},
				),
			},
		).toStrictEqual(
			{
				tabs: [
					{
						name: "Claude",
						selected: "true",
					},
				],
				closeClaude: null,
			},
		);
	});

	it("reorders Shell tabs with Control+Shift+Arrow, never ahead of Claude", async () =>
	{
		await openWithShells(["pty-alice-1", "pty-alice-2"]);

		fireEvent.keyDown(
			screen.getByRole(
				"tab",
				{
					name: "Shell 2",
				},
			),
			{
				key: "ArrowLeft",
				ctrlKey: true,
				shiftKey: true,
			},
		);
		const afterLeft = tabs().map((tab) => tab.name);
		fireEvent.keyDown(
			screen.getByRole(
				"tab",
				{
					name: "Shell 2",
				},
			),
			{
				key: "ArrowLeft",
				ctrlKey: true,
				shiftKey: true,
			},
		);
		const atStart = tabs().map((tab) => tab.name);
		fireEvent.keyDown(
			screen.getByRole(
				"tab",
				{
					name: "Shell 2",
				},
			),
			{
				key: "ArrowRight",
				ctrlKey: true,
				shiftKey: true,
			},
		);

		expect(
			{
				afterLeft,
				atStart,
				afterRight: tabs().map((tab) => tab.name),
			},
		).toStrictEqual(
			{
				afterLeft: ["Claude", "Shell 2", "Shell"],
				atStart: ["Claude", "Shell 2", "Shell"],
				afterRight: ["Claude", "Shell", "Shell 2"],
			},
		);
	});

	it("asks before closing a terminal that is still running a command", async () =>
	{
		await openWithShells(["pty-alice-1", "pty-alice-2"], ["pty-alice-2"]);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Close Shell 2",
				},
			),
		);
		const dialog = await waitFor(() => screen.getByRole("alertdialog"));
		const asked =
		{
			text: dialog.textContent,
			tabs: screen.getAllByRole(
				"tab",
				{
					hidden: true,
				},
			).length,
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Close terminal",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.getAllByRole("tab")).toHaveLength(2);
		});

		expect(asked).toStrictEqual(
			{
				text: "Close terminal?A command is still running in Shell 2. Closing the terminal stops it.CancelClose terminal",
				tabs: 3,
			},
		);
	});

	it("keeps a busy terminal open when the close is cancelled", async () =>
	{
		await openWithShells(["pty-alice-1"], ["pty-alice-1"]);

		fireEvent.keyDown(
			screen.getByRole(
				"tab",
				{
					name: "Shell",
				},
			),
			{
				key: "Delete",
			},
		);
		await waitFor(() => screen.getByRole("alertdialog"));
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Cancel",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});

		expect(tabs()).toStrictEqual([
			{
				name: "Claude",
				selected: "false",
			},
			{
				name: "Shell",
				selected: "true",
			},
		]);
	});

	it("restores the session's tab list from localStorage without starting a new shell", async () =>
	{
		storage.setItem(
			terminalTabsStorageKey(SESSION_ID),
			JSON.stringify(
				{
					tabs: [
						{
							id: "shell-1",
							ptyKey: "pty-alice-1",
							title: "logs",
						},
						{
							id: "shell-4",
							ptyKey: "pty-alice-4",
							title: "Shell 4",
						},
					],
					active: "shell-4",
					opened: 4,
				},
			),
		);
		const fetcher = stubShellApi([]);
		renderSession(
			false,
			{
				shells: true,
			},
		);

		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});
		await flush();

		expect(
			{
				tabs: tabs(),
				shells: screen.getAllByTestId("shell-terminal").map((node) => node.textContent),
				requests: fetcher.mock.calls.length,
			},
		).toStrictEqual(
			{
				tabs: [
					{
						name: "logs",
						selected: "false",
					},
					{
						name: "Shell 4",
						selected: "true",
					},
				],
				shells: ["pty-alice-1", "pty-alice-4"],
				requests: 0,
			},
		);
	});

	it("offers More terminals when the tabs overflow the strip", async () =>
	{
		vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
		await openWithShells(["pty-alice-1", "pty-alice-2"]);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "More terminals",
				},
			),
		);
		await flush();
		const menu = await waitFor(() => screen.getByRole("menu"));
		const items = [...menu.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent);
		const popupPrevented = !fireEvent.contextMenu(menu.querySelector('[role="menuitem"]')!);
		fireEvent.click(
			[...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === "Claude")!,
		);
		await flush();

		expect(
			{
				items,
				popupPrevented,
				tabs: tabs(),
			},
		).toStrictEqual(
			{
				items: ["Claude", "Shell", "Shell 2"],
				popupPrevented: true,
				tabs: [
					{
						name: "Claude",
						selected: "true",
					},
					{
						name: "Shell",
						selected: "false",
					},
					{
						name: "Shell 2",
						selected: "false",
					},
				],
			},
		);
	});
});

describe("Terminal pane header menu", () =>
{
	it("pops the terminal out to its /terminals page with Open in new window", async () =>
	{
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		renderSession(true);
		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "More options",
				},
			),
		);
		const menu = await waitFor(() => screen.getByRole("menu"));
		const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
		fireEvent.click(items.find((node) => node.textContent === "Open in new window")!);

		expect(
			{
				items: items.map((node) => node.textContent),
				opened: open.mock.calls,
			},
		).toStrictEqual(
			{
				items: ["Open in new window"],
				opened: [[`/terminals/${SESSION_ID}`, "_blank", "noopener"]],
			},
		);
	});
});

describe("Terminal pane Open terminal here", () =>
{
	it("opens a herdr shell in the session's directory from the header menu, showing why it failed", async () =>
	{
		const openTerminalHere = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("herdr is not running"));
		renderSession(
			true,
			{
				openTerminalHere,
			},
		);
		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "More options",
				},
			),
		);
		const menu = await waitFor(() => screen.getByRole("menu"));
		const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
		fireEvent.click(items.find((node) => node.textContent === "Open terminal here")!);

		expect(
			{
				items: items.map((node) => node.textContent),
				calls: openTerminalHere.mock.calls.length,
				failure: (await screen.findByRole("alert")).textContent,
			},
		).toStrictEqual(
			{
				items: ["Open in new window", "Open terminal here"],
				calls: 1,
				failure: "herdr is not running",
			},
		);
	});
});

describe("Claude tab lifecycle", () =>
{
	it("shows Session ended with a transcript link when the herdr pane closes", () =>
	{
		const view = renderSession(true);
		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});

		view.setAvailable(false);
		const panel = screen.getByRole(
			"tabpanel",
			{
				name: "Claude terminal",
			},
		);

		expect(
			{
				tabs: screen.getAllByRole("tab").map((tab) => tab.textContent),
				text: panel.textContent,
				link: screen
					.getByRole(
						"link",
						{
							name: "View transcript",
						},
					)
					.getAttribute("href"),
				terminal: screen.queryByTestId("herdr-terminal"),
			},
		).toStrictEqual(
			{
				tabs: ["Claude"],
				text: "Session endedView transcript",
				link: `/session/${SESSION_ID}`,
				terminal: null,
			},
		);
	});

	it("closes the pane from the transcript link", () =>
	{
		const view = renderSession(true);
		act(() =>
		{
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.click();
		});
		view.setAvailable(false);

		fireEvent.click(
			screen.getByRole(
				"link",
				{
					name: "View transcript",
				},
			),
		);

		expect(
			screen
				.getByRole(
					"button",
					{
						name: "Terminal",
					},
				)
				.getAttribute("aria-pressed"),
		).toBe("false");
	});
});

describe("?pane= deep link", () =>
{
	it("keeps only a known pane kind and the terminal view", () =>
	{
		expect([
			validateSessionSearch(
				{
					pane: "terminal",
				},
			),
			validateSessionSearch(
				{
					pane: "bogus",
				},
			),
			validateSessionSearch(
				{
					pane: 7,
				},
			),
			validateSessionSearch({}),
			validateSessionSearch(
				{
					view: "terminal",
				},
			),
			validateSessionSearch(
				{
					view: "x",
				},
			),
			validateSessionSearch(
				{
					pane: "terminal",
					view: "terminal",
				},
			),
		]).toStrictEqual([
			{
				pane: "terminal",
			},
			{},
			{},
			{},
			{
				view: "terminal",
			},
			{},
			{
				pane: "terminal",
				view: "terminal",
			},
		]);
	});

	it("opens the requested pane once the layout loads, then reports it handled", () =>
	{
		const onHandled = vi.fn<() => void>();
		renderSession(
			true,
			{
				pane: "terminal",
				onHandled,
			},
		);

		expect(
			{
				pressed: screen
					.getByRole(
						"button",
						{
							name: "Terminal",
						},
					)
					.getAttribute("aria-pressed"),
				handled: onHandled.mock.calls.length,
			},
		).toStrictEqual(
			{
				pressed: "true",
				handled: 1,
			},
		);
	});
});
