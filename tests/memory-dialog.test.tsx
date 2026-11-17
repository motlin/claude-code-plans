// @vitest-environment jsdom

import {EditorView} from "@codemirror/view";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {MemoryDialog, type MemoryDialogLoad} from "../src/components/memory-dialog";
import {ToastProvider} from "../src/components/toast";

const HOME = "/Users/alice";
const CWD = "/Users/alice/proj";
const USER_FILE = `${HOME}/.claude/CLAUDE.md`;
const LOCAL_FILE = `${CWD}/CLAUDE.local.md`;
const ETAG = '"1000"';

const MEMORY_FILES = [
	{
		path: USER_FILE,
		type: "User",
	},
	{
		path: LOCAL_FILE,
		type: "Local",
	},
	{
		path: `${HOME}/.claude/projects/-proj/memory/MEMORY.md`,
		type: "AutoMem",
	},
];

let files: Map<
	string,
	{
		content: string;
		writable: boolean;
	}
>;
let puts:
{
	path: string | null;
	ifMatch: string | null;
	body: string;
}[];
let putReplies: (() => Response)[];
let opened: string[];
let wide: boolean;

beforeEach(() =>
{
	files = new Map([
		[
			USER_FILE,
			{
				content: "# User\n",
				writable: true,
			},
		],
		[
			LOCAL_FILE,
			{
				content: "local\nnotes\n",
				writable: false,
			},
		],
	]);
	puts = [];
	putReplies = [];
	opened = [];
	wide = true;
	vi.stubGlobal("matchMedia", (query: string) => (
	{
		matches: query === "(min-width: 640px)" && wide,
		media: query,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	}));
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string, init?: RequestInit) =>
		{
			const url = new URL(input, "http://localhost");
			if (url.pathname === "/api/open-file")
			{
				opened.push(String(JSON.parse(String(init?.body)).path));
				return Promise.resolve(
					Response.json(
						{
							ok: true,
						},
					),
				);
			}
			const path = url.searchParams.get("path");
			if (init?.method === "PUT")
			{
				puts.push(
					{
						path,
						ifMatch: new Headers(init.headers).get("If-Match"),
						body: String(init.body),
					},
				);
				const reply = putReplies.shift();
				if (reply) return Promise.resolve(reply());
				return Promise.resolve(
					new Response(
						null,
						{
							status: 204,
							headers:
							{
								ETag: '"2000"',
							},
						},
					),
				);
			}
			const file = path === null ? undefined : files.get(path);
			if (file === undefined)
				return Promise.resolve(
					Response.json(
						{
							error: "missing",
						},
						{
							status: 404,
						},
					),
				);
			return Promise.resolve(
				Response.json(
					{
						...file,
						etag: ETAG,
					},
				),
			);
		}),
	);
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	localStorage.clear();
});

function renderDialog(
	options:
	{
		memoryFiles:
			|
			  {
					path: string;
					type: string;
			  }[]
			| undefined;
		load: MemoryDialogLoad;
	} =
	{
		memoryFiles: MEMORY_FILES,
		load: "ready",
	},
)
{
	const {memoryFiles, load} = options;
	const onClose = vi.fn<() => void>();
	const queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryDialog
					sessionId="abc"
					cwd={CWD}
					home={HOME}
					memoryFiles={memoryFiles}
					load={load}
					onClose={onClose}
				/>
			</ToastProvider>
		</QueryClientProvider>,
	);
	return {
		onClose,
	};
}

function listbox(): HTMLElement
{
	return screen.getByRole(
		"listbox",
		{
			name: "Memory files",
			hidden: true,
		},
	);
}

function rows()
{
	return within(listbox())
		.queryAllByRole("option")
		.map((row) => (
		{
			id: row.id,
			selected: row.getAttribute("aria-selected"),
			title: row.getAttribute("title"),
			text: row.textContent,
			className: row.className,
		}));
}

async function editorView(): Promise<EditorView>
{
	let view: EditorView | null = null;
	await waitFor(() =>
	{
		const editor = document.querySelector<HTMLElement>("[data-memory-file] .cm-editor");
		view = editor === null ? null : EditorView.findFromDOM(editor);
		if (view === null) throw new Error("editor not loaded");
	});
	return view as unknown as EditorView;
}

function type(view: EditorView, text: string): void
{
	act(() =>
	{
		view.dispatch(
			{
				changes:
				{
					from: view.state.doc.length,
					insert: text,
				},
				userEvent: "input.type",
			},
		);
	});
}

async function flush(): Promise<void>
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

/** Type, then let the 1 s autosave fire and its PUT settle. */
async function typeAndAutosave(view: EditorView, text: string): Promise<void>
{
	vi.useFakeTimers(
		{
			toFake: ["setTimeout", "clearTimeout"],
		},
	);
	type(view, text);
	act(() =>
	{
		vi.advanceTimersByTime(1000);
	});
	vi.useRealTimers();
	await flush();
	await flush();
}

function facts(): string | null | undefined
{
	return document.querySelector("h3")?.parentElement?.querySelector("p:last-child")?.textContent;
}

describe("MemoryDialog list", () =>
{
	it("lists the session's CLAUDE files with upstream's row classes, ARIA and notes", async () =>
	{
		renderDialog();
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(listbox());
		});
		const base = "hit-row hit-row-main flex h-8 shrink-0 cursor-interactive items-center gap-sm rounded-r4 px-sm";
		expect(
			{
				dialog: screen.getByRole("dialog").getAttribute("aria-label"),
				activedescendant: listbox().getAttribute("aria-activedescendant"),
				focused: document.activeElement === listbox(),
				rows: rows(),
			},
		).toStrictEqual(
			{
				dialog: "Memory",
				activedescendant: "memory-opt-0",
				focused: true,
				rows: [
					{
						id: "memory-opt-0",
						selected: "true",
						title: USER_FILE,
						text: "User instructions",
						className: `${base} bg-fill-ghost-selected hover:layers-1-fill-ghost-hover text-primary`,
					},
					{
						id: "memory-opt-1",
						selected: "false",
						title: `${CWD}/CLAUDE.md · not created yet`,
						text: "Project instructions (not created yet)",
						className: `${base} text-muted-as-secondary hover:bg-fill-ghost-hover`,
					},
					{
						id: "memory-opt-2",
						selected: "false",
						title: LOCAL_FILE,
						text: "CLAUDE.local.md",
						className: `${base} text-secondary-control hover:bg-fill-ghost-hover`,
					},
				],
			},
		);
		await editorView();
	});

	it("moves the selection with ↓/↑, and Enter opens the file in the default app and closes", async () =>
	{
		const {onClose} = renderDialog();
		fireEvent.keyDown(
			listbox(),
			{
				key: "ArrowDown",
			},
		);
		fireEvent.keyDown(
			listbox(),
			{
				key: "ArrowDown",
			},
		);
		fireEvent.keyDown(
			listbox(),
			{
				key: "ArrowDown",
			},
		);
		const afterDown = listbox().getAttribute("aria-activedescendant");
		fireEvent.keyDown(
			listbox(),
			{
				key: "ArrowUp",
			},
		);
		fireEvent.keyDown(
			listbox(),
			{
				key: "Enter",
			},
		);
		await flush();
		expect(
			{
				afterDown,
				selected: rows().map((row) => row.selected),
				opened,
				closed: onClose.mock.calls.length,
			},
		).toStrictEqual(
			{
				afterDown: "memory-opt-2",
				selected: ["false", "true", "false"],
				opened: [`${CWD}/CLAUDE.md`],
				closed: 1,
			},
		);
	});

	it("disables Open on a not-created file with that reason", () =>
	{
		renderDialog();
		fireEvent.click(
			screen.getByRole(
				"option",
				{
					name: /Project instructions/,
				},
			),
		);
		const open = screen.getByRole(
			"button",
			{
				name: "Open",
			},
		);
		const describedBy = open.closest("[aria-describedby]")?.getAttribute("aria-describedby");
		expect(
			{
				heading: document.querySelector("h3")?.textContent,
				facts: facts(),
				disabled: open.hasAttribute("disabled"),
				reason: describedBy == null ? null : document.getElementById(describedBy)?.textContent,
			},
		).toStrictEqual(
			{
				heading: "Project instructions",
				facts: "not created yet",
				disabled: true,
				reason: "not created yet",
			},
		);
	});

	it("shows upstream's empty states", () =>
	{
		const states = (["loading", "waiting", "unavailable"] as const).map((load) =>
		{
			renderDialog(
				{
					memoryFiles: undefined,
					load,
				},
			);
			const item = listbox().querySelector("li[role=presentation]");
			if (item === null) throw new Error("no empty state");
			const state =
			{
				text: item.textContent,
				alert: item.querySelector("[role=alert]") !== null,
				busy: listbox().getAttribute("aria-busy"),
				className: item.className,
			};
			cleanup();
			return state;
		});
		const className = "px-sm py-1.25 text-body text-muted-as-secondary italic";
		expect(states).toStrictEqual([
			{
				text: "Loading memory files…",
				alert: false,
				busy: "true",
				className,
			},
			{
				text: "Memory files load once Claude finishes responding.",
				alert: false,
				busy: "true",
				className,
			},
			{
				text: "Couldn’t load this session’s memory files.",
				alert: true,
				busy: "false",
				className,
			},
		]);
	});

	it("drops the detail column below 640px, where a tap opens the file", async () =>
	{
		wide = false;
		const {onClose} = renderDialog();
		const detail = document.querySelector(".border-s.ps-lg");
		fireEvent.click(
			screen.getByRole(
				"option",
				{
					name: "CLAUDE.local.md",
				},
			),
		);
		await flush();
		expect(
			{
				detail,
				opened,
				closed: onClose.mock.calls.length,
			},
		).toStrictEqual(
			{
				detail: null,
				opened: [LOCAL_FILE],
				closed: 1,
			},
		);
	});
});

describe("MemoryDialog editor", () =>
{
	it("autosaves a writable file with If-Match and never arms the guard", async () =>
	{
		const {onClose} = renderDialog();
		const view = await editorView();
		await waitFor(() =>
		{
			expect(facts()).toBe("1 line · read at session start");
		});
		await typeAndAutosave(view, "more\n");
		fireEvent.click(
			screen.getByRole(
				"option",
				{
					name: "CLAUDE.local.md",
				},
			),
		);
		await waitFor(() =>
		{
			expect(facts()).toBe("2 lines · read at session start · view only");
		});
		const local = await editorView();
		expect(
			{
				puts,
				confirm: screen.queryByRole("alertdialog"),
				selected: listbox().getAttribute("aria-activedescendant"),
				readOnly: local.contentDOM.getAttribute("aria-readonly"),
				closed: onClose.mock.calls.length,
			},
		).toStrictEqual(
			{
				puts: [
					{
						path: USER_FILE,
						ifMatch: ETAG,
						body: "# User\nmore\n",
					},
				],
				confirm: null,
				selected: "memory-opt-2",
				readOnly: "true",
				closed: 0,
			},
		);
	});

	it("shows the conflict banner after a failed save and guards leaving the file", async () =>
	{
		putReplies.push(() =>
			Response.json(
				{
					reason: "conflict",
					etag: '"9"',
				},
				{
					status: 409,
				},
			),
		);
		renderDialog();
		const view = await editorView();
		await typeAndAutosave(view, "more\n");
		const alert = document.querySelector<HTMLElement>("[data-save-error]");
		const banner =
		{
			text: alert?.querySelector("span")?.textContent,
			buttons: [...(alert?.querySelectorAll("button") ?? [])].map((button) => button.textContent),
		};
		fireEvent.click(
			screen.getByRole(
				"option",
				{
					name: "CLAUDE.local.md",
				},
			),
		);
		const confirm = await screen.findByRole("alertdialog");
		// The alert dialog moves focus to Keep editing after it mounts, which can trail findByRole under load.
		await waitFor(() =>
		{
			expect(document.activeElement?.textContent).toBe("Keep editing");
		});
		const guarded =
		{
			title: confirm.querySelector("h2")?.textContent,
			body: confirm.querySelector("p")?.textContent,
			focused: document.activeElement?.textContent,
			selected: listbox().getAttribute("aria-activedescendant"),
		};
		fireEvent.click(
			within(confirm).getByRole(
				"button",
				{
					name: "Discard",
				},
			),
		);
		await waitFor(() =>
		{
			expect(listbox().getAttribute("aria-activedescendant")).toBe("memory-opt-2");
		});
		expect(
			{
				banner,
				guarded,
			},
		).toStrictEqual(
			{
				banner:
				{
					text: "This file changed on disk since you started editing.",
					buttons: ["Discard", "Override"],
				},
				guarded:
				{
					title: "Discard unsaved changes?",
					body: "Your edits to CLAUDE.md haven’t been saved. Leaving now discards them.",
					focused: "Keep editing",
					selected: "memory-opt-0",
				},
			},
		);
	});

	it("guards a plain Escape in a dirty editor, swallows a modified one, and closes on Escape when clean", async () =>
	{
		putReplies.push(() =>
			Response.json(
				{
					error: "boom",
				},
				{
					status: 500,
				},
			),
		);
		const {onClose} = renderDialog();
		const view = await editorView();
		await typeAndAutosave(view, "more\n");
		fireEvent.keyDown(
			view.contentDOM,
			{
				key: "Escape",
				shiftKey: true,
			},
		);
		const afterShift = screen.queryByRole("alertdialog");
		fireEvent.keyDown(
			view.contentDOM,
			{
				key: "ArrowDown",
			},
		);
		const afterArrow = listbox().getAttribute("aria-activedescendant");
		fireEvent.keyDown(
			view.contentDOM,
			{
				key: "Escape",
			},
		);
		const confirm = await screen.findByRole("alertdialog");
		fireEvent.click(
			within(confirm).getByRole(
				"button",
				{
					name: "Keep editing",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});
		const draft = view.state.doc.toString();
		const closedWhileDirty = onClose.mock.calls.length;
		fireEvent.click(
			within(document.querySelector<HTMLElement>("[data-save-error]")!).getByRole(
				"button",
				{
					name: "Discard",
				},
			),
		);
		fireEvent.keyDown(
			view.contentDOM,
			{
				key: "Escape",
			},
		);
		expect(
			{
				afterShift,
				afterArrow,
				draft,
				closedWhileDirty,
				closed: onClose.mock.calls.length,
			},
		).toStrictEqual(
			{
				afterShift: null,
				afterArrow: "memory-opt-0",
				draft: "# User\nmore\n",
				closedWhileDirty: 0,
				closed: 1,
			},
		);
	});
});
