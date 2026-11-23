// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {FileTabsStrip} from "../src/components/files/file-tabs-strip";
import {filesEmptyState} from "../src/components/panes/files-empty-state";
import {FileTypeIconSetContext} from "../src/components/file-type-icon-set-context";
import {FilesPaneView} from "../src/components/panes/files-pane";
import {FilesPaneShortcut} from "../src/components/panes/files-pane-shortcut";
import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {PopoverContent, PopoverRoot, PopoverTrigger} from "../src/components/ui/popover";
import {writeClipboardText} from "../src/lib/clipboard";
import {requestFileOpen} from "../src/lib/file-open-requests";
import type {SessionFiles} from "../src/lib/session-files";
import {TOUCH_REVEAL} from "../src/lib/touch-reveal";
import {installLocalStorage} from "./fake-storage";

vi.mock("../src/lib/clipboard", () => (
{
	writeClipboardText: vi.fn<typeof import("../src/lib/clipboard").writeClipboardText>(),
}));

const SESSION_FILES =
{
	files: [
		{
			path: "~/example/agent.ts",
			absolutePath: "/home/alice/example/agent.ts",
			occurrences: [
				{
					source: "visible",
					anchorIndex: 10,
					role: "assistant",
				},
				{
					source: "tool",
					anchorIndex: 20,
					role: "assistant",
					tool: "Read",
				},
			],
		},
		{
			path: "~/example/read-only.ts",
			absolutePath: "/home/alice/example/read-only.ts",
			occurrences: [
				{
					source: "tool",
					anchorIndex: 30,
					role: "assistant",
					tool: "Read",
				},
			],
		},
		{
			path: "~/notes/user.md",
			absolutePath: "/home/alice/notes/user.md",
			occurrences: [
				{
					source: "visible",
					anchorIndex: 40,
					role: "user",
				},
			],
		},
	],
	totalCount: 3,
	counts:
	{
		userMessage: 1,
		agentMessage: 1,
		read: 2,
		editWrite: 0,
		bash: 0,
		grepGlob: 0,
		thinking: 0,
		other: 0,
	},
} satisfies SessionFiles;

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

function press(init: KeyboardEventInit): KeyboardEvent
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
		document.body.dispatchEvent(event);
	});
	return event;
}

const CMD_SHIFT_F =
{
	key: "f",
	code: "KeyF",
	metaKey: true,
	shiftKey: true,
};
const CTRL_SHIFT_F =
{
	key: "F",
	code: "KeyF",
	ctrlKey: true,
	shiftKey: true,
};
const CTRL_SHIFT_Y =
{
	key: "Y",
	code: "KeyY",
	ctrlKey: true,
	shiftKey: true,
};
const CMD_P =
{
	key: "p",
	code: "KeyP",
	metaKey: true,
};

let unregister: () => void = () =>
{
};

function registerFilesPane(sessionFiles: SessionFiles = SESSION_FILES, unscanned = 0): void
{
	unregister = registerPane(
		"files",
		{
			title: "Files",
			header: "custom",
			render: (chrome) => (
				<FilesPaneView chrome={chrome} sessionFiles={sessionFiles} unscannedRecordCount={unscanned} />
			),
		},
	);
}

function renderSession(
	onExpandWithoutPane: () => void = () =>
	{
	},
)
{
	return render(
		<SettingsProvider>
			<TileHost sessionId="files-pane" onExpandWithoutPane={onExpandWithoutPane}>
				<FilesPaneShortcut />
			</TileHost>
		</SettingsProvider>,
	);
}

function filesPane(): HTMLElement
{
	return screen.getByRole(
		"region",
		{
			name: "Files",
		},
	);
}

function filesOpen(): string | null
{
	return String(
		screen.queryByRole(
			"region",
			{
				name: "Files",
			},
		) !== null,
	);
}

beforeEach(() =>
{
	installLocalStorage();
	vi.mocked(writeClipboardText).mockReset();
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
	unregister();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("filesEmptyState", () =>
{
	it.each([
		[
			"tabs open, none selected, in a session",
			false,
			2,
			true,
			true,
			"No file selected",
			"Pick an open file above, or click a file path in the conversation.",
		],
		[
			"tabs open, none selected, no session",
			true,
			1,
			false,
			true,
			"No file selected",
			"Pick one of the open files.",
		],
		[
			"no tabs, tree shown, in a session",
			true,
			0,
			true,
			true,
			"Open files appear here",
			"Pick a file in the tree, or click a file path in the conversation.",
		],
		["no tabs, tree shown, no session", true, 0, false, true, "Open files appear here", "Pick a file in the tree."],
		[
			"no tabs, tree hidden, in a session",
			false,
			0,
			true,
			true,
			"Open files appear here",
			"Click a file path in the conversation to open it.",
		],
		[
			"no tabs, tree hidden, no session",
			false,
			0,
			false,
			true,
			"Open files appear here",
			"Show the file tree to pick a file.",
		],
		["no tabs, no tree, no session", false, 0, false, false, "Open files appear here", ""],
	])("%s", (_name, hasTree, tabCount, inSession, treeAvailable, title, detail) =>
	{
		expect(
			filesEmptyState(
				hasTree,
				tabCount,
				{
					inSession,
					treeAvailable,
				},
			),
		).toStrictEqual(
			{
				title,
				detail,
			},
		);
	});
});

describe("Files pane shortcut", () =>
{
	it("⇧⌘F toggles the pane, focuses the filter, and never toggles chromeHidden", () =>
	{
		registerFilesPane();
		const onExpandWithoutPane = vi.fn<() => void>();
		renderSession(onExpandWithoutPane);

		const before = filesOpen();
		const opened = press(CMD_SHIFT_F);
		const afterOpen = filesOpen();
		const focusedLabel = document.activeElement?.getAttribute("aria-label");
		const closed = press(CMD_SHIFT_F);

		expect(
			{
				before,
				afterOpen,
				focusedLabel,
				afterClose: filesOpen(),
				paneAfterClose: screen.queryByRole(
					"region",
					{
						name: "Files",
					},
				),
				prevented: [opened.defaultPrevented, closed.defaultPrevented],
				chromeToggles: onExpandWithoutPane.mock.calls.length,
			},
		).toStrictEqual(
			{
				before: "false",
				afterOpen: "true",
				focusedLabel: "Filter files",
				afterClose: "false",
				paneAfterClose: null,
				prevented: [true, true],
				chromeToggles: 0,
			},
		);
	});

	it("⌃⇧F is not the Files shortcut on mac", () =>
	{
		registerFilesPane();
		renderSession();

		const event = press(CTRL_SHIFT_F);

		expect(
			{
				pressed: filesOpen(),
				prevented: event.defaultPrevented,
			},
		).toStrictEqual(
			{
				pressed: "false",
				prevented: false,
			},
		);
	});
});

describe("Files pane header", () =>
{
	it("lists the header controls in upstream order", () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		const header = filesPane().querySelector("[data-files-header]");
		const secondRow = filesPane().querySelector("[data-files-header] + [role=presentation]");
		const labelsIn = (element: Element | null | undefined) =>
			[...(element?.querySelectorAll("button") ?? [])].map((button) => button.getAttribute("aria-label"));
		expect(
			{
				rowOne: labelsIn(header),
				title: header?.querySelector("[data-pane-title]")?.textContent,
				rowTwo: labelsIn(secondRow),
				rowTwoToolbar: secondRow?.querySelector(":scope > [role=toolbar]")?.getAttribute("aria-label"),
				lead: secondRow?.querySelector("[data-files-breadcrumb]")?.parentElement?.className,
				breadcrumb: secondRow?.querySelector("[data-files-breadcrumb]")?.className,
			},
		).toStrictEqual(
			{
				rowOne: ["Expand", "Close", "Move"],
				title: "Files",
				rowTwo: ["Go to file or search", "Hide file tree", "Files settings"],
				rowTwoToolbar: "Files controls",
				lead: "flex min-w-0 flex-1 items-center ms-pad-md",
				breadcrumb:
					"draggable-none flex min-w-0 items-center gap-1 self-stretch overflow-x-clip px-1.5 -mx-1.5 flex-1",
			},
		);
	});

	it("sets the pane title as upstream's name-step toolbar title (Hn titleTakesNameStep, file)", () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		const title = filesPane().querySelector("[data-files-header] [data-pane-title]");
		expect(
			{
				wrapper: title?.parentElement?.className.split(" "),
				title: title?.className.split(" "),
			},
		).toStrictEqual(
			{
				wrapper: ["min-w-0", "ms-pad-sm"],
				title: [
					"block",
					"min-w-0",
					"truncate",
					"px-1",
					"text-body",
					"font-control",
					"text-primary",
					"select-none",
				],
			},
		);
	});

	it("paints the pressed tree toggle with accent ink on a transparent background", () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		const classes = within(filesPane())
			.getByRole(
				"button",
				{
					name: "Hide file tree",
				},
			)
			.className.split(" ");
		expect(
			{
				pressed: classes.filter((name) => name.startsWith("aria-pressed:")),
				fillControl: classes.some((name) => name.includes("bg-fill-control")),
			},
		).toStrictEqual(
			{
				pressed: ["aria-pressed:bg-transparent", "aria-pressed:text-upstream-accent"],
				fillControl: false,
			},
		);
	});

	it("the tree toggle hides the tree without unmounting it and switches the empty state copy", () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		const pane = filesPane();
		const toggle = within(pane).getByRole(
			"button",
			{
				name: "Hide file tree",
			},
		);
		const before =
		{
			pressed: toggle.getAttribute("aria-pressed"),
			keyshortcuts: toggle.getAttribute("aria-keyshortcuts"),
			tree: pane.querySelector("[data-files-tree]:not(.hidden)") !== null,
			detail: within(pane).queryByText("Pick a file in the tree.") !== null,
		};
		fireEvent.change(
			within(pane).getByLabelText("Filter files"),
			{
				target:
				{
					value: "agent",
				},
			},
		);
		fireEvent.click(toggle);
		const after =
		{
			pressed: within(pane)
				.getByRole(
					"button",
					{
						name: "Show file tree",
					},
				)
				.getAttribute("aria-pressed"),
			treeClasses: [...(pane.querySelector("[data-files-tree]")?.classList ?? [])],
			detail: within(pane).queryByText("Show the file tree to pick a file.") !== null,
		};
		fireEvent.click(
			within(pane).getByRole(
				"button",
				{
					name: "Show file tree",
				},
			),
		);

		expect(
			{
				before,
				after,
				filter: within(pane).getByLabelText<HTMLInputElement>("Filter files").value,
			},
		).toStrictEqual(
			{
				before:
				{
					pressed: "true",
					keyshortcuts: "Control+Shift+y",
					tree: true,
					detail: true,
				},
				after:
				{
					pressed: "false",
					treeClasses: ["hidden"],
					detail: true,
				},
				filter: "agent",
			},
		);
	});

	it("wraps the tree and viewer in upstream's files-body container", () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		const body = filesPane().querySelector("[data-files-tree]")?.parentElement;
		expect(
			["@container/files-body", "flex", "min-h-0", "flex-1"].filter((name) => body?.classList.contains(name)),
		).toStrictEqual(["@container/files-body", "flex", "min-h-0", "flex-1"]);
	});

	it("a click on the tree's resize handle hides it, and the edge handle shows it again, in step with the toggle", () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);
		const pane = filesPane();

		const handle = within(pane).getByRole(
			"separator",
			{
				name: "Resize file tree",
			},
		);
		handle.focus();
		fireEvent.pointerDown(
			handle,
			{
				button: 0,
				clientX: 240,
			},
		);
		fireEvent.pointerUp(
			handle,
			{
				clientX: 240,
			},
		);
		const edge = within(pane).getByRole(
			"separator",
			{
				name: "Resize file tree",
			},
		);
		const hidden =
		{
			toggle: within(pane)
				.getByRole(
					"button",
					{
						name: /file tree$/,
					},
				)
				.getAttribute("aria-pressed"),
			tree: pane.querySelector("[data-files-tree]:not(.hidden)") !== null,
			edgeFocused: document.activeElement === edge,
			valuenow: edge.getAttribute("aria-valuenow"),
		};
		fireEvent.pointerDown(
			edge,
			{
				button: 0,
				clientX: 0,
			},
		);
		fireEvent.pointerUp(
			edge,
			{
				clientX: 0,
			},
		);
		const shown =
		{
			toggle: within(pane)
				.getByRole(
					"button",
					{
						name: /file tree$/,
					},
				)
				.getAttribute("aria-pressed"),
			tree: pane.querySelector("[data-files-tree]:not(.hidden)") !== null,
			handleFocused:
				document.activeElement ===
				within(pane).getByRole(
					"separator",
					{
						name: "Resize file tree",
					},
				),
		};

		expect(
			{
				hidden,
				shown,
			},
		).toStrictEqual(
			{
				hidden:
				{
					toggle: "false",
					tree: false,
					edgeFocused: true,
					valuenow: "0",
				},
				shown:
				{
					toggle: "true",
					tree: true,
					handleFocused: true,
				},
			},
		);
	});

	it("⌃⇧Y toggles the file tree while the Files pane is focused", () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		const event = press(CTRL_SHIFT_Y);

		expect(
			{
				prevented: event.defaultPrevented,
				toggle: within(filesPane())
					.getByRole(
						"button",
						{
							name: /file tree$/,
						},
					)
					.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				prevented: true,
				toggle: "Show file tree",
			},
		);
	});

	it("Files settings offers Hide ignored files, off by default and persisted", async () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		fireEvent.click(
			within(filesPane()).getByRole(
				"button",
				{
					name: "Files settings",
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
		const before = [...screen.getByRole("menu").querySelectorAll<HTMLElement>("[role^=menuitem]")].map((item) => [
			item.textContent,
			item.getAttribute("aria-checked"),
		]);
		fireEvent.click(
			screen.getByRole(
				"menuitemcheckbox",
				{
					name: "Hide ignored files",
				},
			),
		);

		expect(
			{
				before,
				stored: localStorage.getItem("ccp-files-hide-ignored"),
				checked: screen
					.getByRole(
						"menuitemcheckbox",
						{
							name: "Hide ignored files",
						},
					)
					.getAttribute("aria-checked"),
			},
		).toStrictEqual(
			{
				before: [
					["Show file tree⌃Control⇧ShiftY", "true"],
					["File tree positionAutomatic", null],
					["Preview tabs", "true"],
					["Word wrap", "true"],
					["Indent guides", "true"],
					["Show whitespace", "false"],
					["Scroll past end", "false"],
					["Tab size4", null],
					["Hide ignored files", "false"],
					["Show files from", null],
				],
				stored: "true",
				checked: "true",
			},
		);
	});

	it("Files settings toggles Word wrap, Indent guides, Show whitespace and Scroll past end and picks a Tab size, all persisted", async () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		fireEvent.click(
			within(filesPane()).getByRole(
				"button",
				{
					name: "Files settings",
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
		for (const name of ["Word wrap", "Indent guides", "Show whitespace", "Scroll past end"])
		{
			fireEvent.click(
				screen.getByRole(
					"menuitemcheckbox",
					{
						name,
					},
				),
			);
		}
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: /^Tab size/,
				},
			),
		);
		fireEvent.click(
			await screen.findByRole(
				"menuitemradio",
				{
					name: "8",
				},
			),
		);

		expect(
			{
				wrap: localStorage.getItem("ccp-files-word-wrap"),
				indentGuides: localStorage.getItem("ccp-files-indent-guides"),
				whitespace: localStorage.getItem("ccp-files-show-whitespace"),
				pastEnd: localStorage.getItem("ccp-files-scroll-past-end"),
				tabSize: localStorage.getItem("ccp-files-tab-size"),
				radios: screen
					.getAllByRole("menuitemradio")
					.map((item) => [item.textContent, item.getAttribute("aria-checked")]),
			},
		).toStrictEqual(
			{
				wrap: "false",
				indentGuides: "false",
				whitespace: "true",
				pastEnd: "true",
				tabSize: "8",
				radios: [
					["2", "false"],
					["4", "false"],
					["8", "true"],
				],
			},
		);
	});

	it("Files settings lists upstream's items first, then the local extras after a separator", async () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		fireEvent.click(
			within(filesPane()).getByRole(
				"button",
				{
					name: "Files settings",
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
		const rows = [
			...screen.getByRole("menu").querySelectorAll<HTMLElement>("[role^=menuitem], [role=separator]"),
		].map((row) => (row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? "")));

		expect(
			{
				rows,
				popupContextMenuPrevented: !fireEvent.contextMenu(screen.getByRole("menu")),
				itemContextMenuPrevented: !fireEvent.contextMenu(screen.getAllByRole("menuitemcheckbox")[0]!),
				separatorContextMenuPrevented: !fireEvent.contextMenu(
					screen.getByRole("menu").querySelector("[role=separator]")!,
				),
			},
		).toStrictEqual(
			{
				rows: [
					"Show file tree",
					"File tree position",
					"─",
					"Preview tabs",
					"─",
					"Word wrap",
					"Indent guides",
					"Show whitespace",
					"Scroll past end",
					"Tab size",
					"─",
					"Hide ignored files",
					"Show files from",
				],
				popupContextMenuPrevented: true,
				itemContextMenuPrevented: true,
				separatorContextMenuPrevented: true,
			},
		);
	});

	it("File tree position defaults to Automatic, putting the tree right of the chat's pane, and Left moves it", async () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);
		function side()
		{
			const column = filesPane().querySelector<HTMLElement>("[data-files-tree]");
			return {
				reversed: column?.parentElement?.classList.contains("flex-row-reverse"),
				border: [...(column?.classList ?? [])].filter((name) => /^border-[se]$/.test(name)),
			};
		}
		const before = side();
		fireEvent.click(
			within(filesPane()).getByRole(
				"button",
				{
					name: "Files settings",
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
		const trigger = screen.getByRole(
			"menuitem",
			{
				name: /^File tree position/,
			},
		);
		const hint = trigger.textContent;
		fireEvent.click(trigger);
		const radios = (await screen.findAllByRole("menuitemradio")).map((item) => [
			item.textContent,
			item.getAttribute("aria-checked"),
		]);
		fireEvent.click(
			screen.getByRole(
				"menuitemradio",
				{
					name: "Left",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});

		expect(
			{
				before,
				hint,
				radios,
				stored: localStorage.getItem("ccp-file-column-position"),
				after: side(),
			},
		).toStrictEqual(
			{
				before:
				{
					reversed: true,
					border: ["border-s"],
				},
				hint: "File tree positionAutomatic",
				radios: [
					["Automatic", "true"],
					["Left", "false"],
					["Right", "false"],
				],
				stored: "left",
				after:
				{
					reversed: false,
					border: ["border-e"],
				},
			},
		);
	});

	it("Go to file or search shows its ⌘P keycap", async () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		const button = within(filesPane()).getByRole(
			"button",
			{
				name: "Go to file or search",
			},
		);
		fireEvent.pointerEnter(button);
		const tooltip = await waitFor(() => screen.getByRole("tooltip"));

		expect(
			{
				tooltip: tooltip.textContent,
				keyshortcuts: button.getAttribute("aria-keyshortcuts"),
			},
		).toStrictEqual(
			{
				tooltip: "Go to file or search⌘CommandP",
				keyshortcuts: "Meta+p",
			},
		);
	});

	it("⌘P inside the Files pane focuses the filter with its text selected", () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);
		const input = within(filesPane()).getByRole<HTMLInputElement>(
			"searchbox",
			{
				name: "Filter files",
			},
		);
		fireEvent.change(
			input,
			{
				target:
				{
					value: "agent",
				},
			},
		);
		input.setSelectionRange(5, 5);
		input.blur();
		act(() =>
		{
			within(filesPane())
				.getByRole(
					"button",
					{
						name: "Files settings",
					},
				)
				.focus();
		});

		const event = press(CMD_P);

		expect(
			{
				prevented: event.defaultPrevented,
				focused: document.activeElement?.getAttribute("aria-label"),
				selection: [input.selectionStart, input.selectionEnd],
			},
		).toStrictEqual(
			{
				prevented: true,
				focused: "Filter files",
				selection: [0, 5],
			},
		);
	});

	function pressGoToFileFromBody(withOpenPopover: boolean)
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);
		if (withOpenPopover)
		{
			render(
				<PopoverRoot defaultOpen>
					<PopoverTrigger>Usage</PopoverTrigger>
					<PopoverContent>
						<p>Usage body</p>
					</PopoverContent>
				</PopoverRoot>,
			);
		}
		act(() =>
		{
			(document.activeElement as HTMLElement | null)?.blur();
		});
		const event = press(CMD_P);
		return {
			prevented: event.defaultPrevented,
			focused:
				document.activeElement === document.body ? "body" : document.activeElement?.getAttribute("aria-label"),
		};
	}

	it("⌘P from the body focuses the Files filter while no overlay is open", () =>
	{
		expect(pressGoToFileFromBody(false)).toStrictEqual(
			{
				prevented: true,
				focused: "Filter files",
			},
		);
	});

	it("⌘P does nothing while another overlay is open, as upstream's KA gates on zI(document)", () =>
	{
		expect(pressGoToFileFromBody(true)).toStrictEqual(
			{
				prevented: true,
				focused: "body",
			},
		);
	});

	it("Go to file or search reveals a hidden tree and focuses the filter", async () =>
	{
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);
		const pane = filesPane();
		fireEvent.click(
			within(pane).getByRole(
				"button",
				{
					name: "Hide file tree",
				},
			),
		);
		(document.activeElement as HTMLElement | null)?.blur();

		fireEvent.click(
			within(pane).getByRole(
				"button",
				{
					name: "Go to file or search",
				},
			),
		);

		await waitFor(() =>
		{
			expect(
				{
					tree: pane.querySelector("[data-files-tree]:not(.hidden)") !== null,
					focused: document.activeElement?.getAttribute("aria-label"),
				},
			).toStrictEqual(
				{
					tree: true,
					focused: "Filter files",
				},
			);
		});
	});
});

describe("Files pane tabs", () =>
{
	it("draws 13px tabs with 6px leading padding, the selected pill on the tab, and a 20x20 close button with a 4px radius", () =>
	{
		render(
			<FileTabsStrip
				state={
				{
					tabs: [
						{
							path: "/w/a.ts",
							preview: false,
						},
						{
							path: "/w/b.ts",
							preview: true,
						},
					],
					active: "/w/a.ts",
				}}
				dispatch={() =>
				{
				}}
			/>,
		);
		const [selected, other] = screen.getAllByRole("tab");
		const selectedClasses = selected?.className.split(" ") ?? [];
		const closeClasses = screen
			.getByRole(
				"button",
				{
					name: "Close a.ts",
				},
			)
			.className.split(" ");
		expect(
			{
				text: selectedClasses.includes("text-pane"),
				paddingLeft: selectedClasses.includes("pl-1.5"),
				selectedPill: selectedClasses.includes("bg-fill-control"),
				otherPill: other?.className.split(" ").includes("bg-fill-control"),
				closeSize: closeClasses.includes("size-5"),
				closeRadius: closeClasses.includes("rounded-r3"),
			},
		).toStrictEqual(
			{
				text: true,
				paddingLeft: true,
				selectedPill: true,
				otherPill: false,
				closeSize: true,
				closeRadius: true,
			},
		);
	});
	it("draws upstream's 12px file-type icon in each tab", () =>
	{
		render(
			<FileTypeIconSetContext value="pierre">
				<FileTabsStrip
					state={
					{
						tabs: [
							{
								path: "/w/README.md",
								preview: false,
							},
						],
						active: "/w/README.md",
					}}
					dispatch={() =>
					{
					}}
				/>
			</FileTypeIconSetContext>,
		);
		const svg = screen.getByRole("tab").querySelector("svg");

		expect(
			{
				fileTypeIcon: svg?.hasAttribute("data-file-type-icon"),
				width: svg?.style.width,
				className: svg?.getAttribute("class"),
				fill: svg?.querySelector("path")?.getAttribute("fill"),
			},
		).toStrictEqual(
			{
				fileTypeIcon: true,
				width: "12px",
				className: "shrink-0 text-ink-muted",
				fill: "var(--fti-markdown)",
			},
		);
	});

	it.each([
		[
			"github-light",
			{
				coloured: true,
				width: "12px",
				glyph: false,
			},
		],
		[
			"claude-light",
			{
				coloured: false,
				width: "12px",
				glyph: true,
			},
		],
	] as const)("follows the %s code theme for the pane's tab icons", async (theme, expected) =>
	{
		localStorage.setItem("ccp-code-theme-light", theme);
		requestFileOpen(
			"files-pane-icons",
			{
				path: "/w/README.md",
			},
		);
		unregister = registerPane(
			"files",
			{
				title: "Files",
				header: "custom",
				render: (chrome) => (
					<FilesPaneView
						chrome={chrome}
						sessionId="files-pane-icons"
						sessionFiles={SESSION_FILES}
						unscannedRecordCount={0}
					/>
				),
			},
		);
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () =>
				Promise.resolve(
					Response.json(
						{},
						{
							status: 404,
						},
					),
				),
			),
		);
		render(
			<QueryClientProvider
				client={
					new QueryClient(
						{
							defaultOptions:
							{
								queries:
								{
									retry: false,
								},
							},
						},
					)
				}
			>
				<ToastProvider>
					<SettingsProvider>
						<TileHost
							sessionId="files-pane"
							onExpandWithoutPane={() =>
							{
							}}
						>
							<FilesPaneShortcut />
						</TileHost>
					</SettingsProvider>
				</ToastProvider>
			</QueryClientProvider>,
		);
		press(CMD_SHIFT_F);
		const tab = await within(filesPane()).findByRole("tab");
		const svg = tab.querySelector("svg");

		expect(
			{
				coloured: tab.querySelector("[data-file-type-icon]") !== null,
				width: svg?.style.width,
				glyph: tab.querySelector(".lucide-sticky-note") !== null,
			},
		).toStrictEqual(expected);
	});
	it("reveals an inactive tab's hover-only close button on touch", () =>
	{
		render(
			<FileTabsStrip
				state={
				{
					tabs: [
						{
							path: "/w/a.ts",
							preview: false,
						},
						{
							path: "/w/b.ts",
							preview: false,
						},
					],
					active: "/w/a.ts",
				}}
				dispatch={() =>
				{
				}}
			/>,
		);

		expect(
			screen
				.getByRole(
					"button",
					{
						name: "Close b.ts",
					},
				)
				.className.includes(TOUCH_REVEAL),
		).toBe(true);
	});

	it("shows the name and its folder in a tooltip and describes the close and move keys, without a native title", async () =>
	{
		render(
			<FileTabsStrip
				state={
				{
					tabs: [
						{
							path: "/w/.llm/plan.md",
							preview: false,
						},
					],
					active: "/w/.llm/plan.md",
				}}
				dispatch={() =>
				{
				}}
				cwd="/w"
			/>,
		);
		const tab = screen.getByRole("tab");
		const descriptions = (tab.getAttribute("aria-describedby") ?? "")
			.split(" ")
			.map((id) => document.getElementById(id)?.textContent);
		fireEvent.pointerEnter(tab);
		const tooltip = await waitFor(() => screen.getByRole("tooltip"));

		expect(
			{
				tooltip: tooltip.textContent,
				folderMuted: tooltip.querySelector("[data-tooltip-detail]")?.textContent,
				descriptions,
				title: tab.getAttribute("title"),
			},
		).toStrictEqual(
			{
				tooltip: "plan.md .llm",
				folderMuted: ".llm",
				descriptions: [
					"Press Delete or Backspace to close the file",
					"Press Control+Shift+Left Arrow or Right Arrow to move the file",
				],
				title: null,
			},
		);
	});
});
