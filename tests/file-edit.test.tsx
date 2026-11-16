// @vitest-environment jsdom

import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {EditorView} from "@codemirror/view";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {FileView} from "../src/components/files/file-view";
import {FilesPaneView} from "../src/components/panes/files-pane";
import {FilesPaneShortcut} from "../src/components/panes/files-pane-shortcut";
import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {CDS_BUTTON_DISABLED, CDS_BUTTON_DISABLED_FILL} from "../src/components/ui/cds-button-disabled";
import {decodeFilePath} from "../src/lib/api/file";
import {EMPTY_EDIT_GUARD, editGuardReducer, editableMarkdownTarget, mtimeEtag} from "../src/lib/file-edit";
import type {FileTabsState} from "../src/lib/file-tabs";
import type {SessionFiles} from "../src/lib/session-files";
import {Route as PlanDetailRoute} from "../src/routes/api/plans.$filename";
import {Route as MemoryDetailRoute} from "../src/routes/api/projects.$id.memories.$filename";
import {installLocalStorage} from "./fake-storage";

const mockedHome = vi.hoisted(() => (
{
	path: "",
}));

vi.mock("node:os", async () => (
{
	...(await vi.importActual<typeof import("node:os")>("node:os")),
	homedir: () => mockedHome.path,
}));

vi.mock("../src/components/markdown-editor", () => (
{
	MarkdownEditor: ({markdown, onChange}: {markdown: string; onChange: (markdown: string) => void}) => (
		<textarea
			aria-label="Markdown editor"
			defaultValue={markdown}
			onChange={(event) =>
			{
				onChange(event.target.value);
			}}
		/>
	),
}));

vi.mock("../src/hooks/use-shiki", async (importOriginal) => (
{
	...(await importOriginal<typeof import("../src/hooks/use-shiki")>()),
	useHighlightedLines: () => null,
}));

const PLAN_PATH = "/home/alice/.claude/plans/alpha-plan.md";
const MEMORY_PATH = "/home/alice/.claude/projects/-home-alice-proj/memory/notes.md";
const README_PATH = "/home/alice/proj/README.md";
const SOURCE_PATH = "/home/alice/proj/src/app.ts";
const PLAN_MTIME = "2026-09-01T10:00:00.123Z";
const SAVED_MTIME = "2026-09-01T10:05:00.456Z";

describe("editableMarkdownTarget", () =>
{
	it("maps plan and memory markdown to their save APIs and leaves other files read-only", () =>
	{
		expect(
			[
				PLAN_PATH,
				MEMORY_PATH,
				"/home/alice/.claude/plans/nested/deep.md",
				"/home/alice/.claude/plans/notes.txt",
				"/home/alice/.claude/projects/-home-alice-proj/notes.md",
				README_PATH,
			].map((path) => editableMarkdownTarget(path)),
		).toStrictEqual([
			{
				kind: "plan",
				url: "/api/plans/alpha-plan",
			},
			{
				kind: "memory",
				url: "/api/projects/-home-alice-proj/memories/notes",
			},
			null,
			null,
			null,
			null,
		]);
	});
});

describe("editGuardReducer", () =>
{
	const tabs: FileTabsState =
	{
		tabs: [
			{
				path: PLAN_PATH,
				preview: false,
			},
			{
				path: README_PATH,
				preview: false,
			},
		],
		active: PLAN_PATH,
	};
	const dirty = editGuardReducer(
		EMPTY_EDIT_GUARD,
		{
			type: "dirty",
			path: PLAN_PATH,
			dirty: true,
		},
	).state;

	it("forwards every tab action while nothing is dirty", () =>
	{
		const action =
		{
			type: "reveal",
			path: README_PATH,
		} as const;
		expect(
			editGuardReducer(
				EMPTY_EDIT_GUARD,
				{
					type: "request",
					action,
					tabs,
				},
			),
		).toStrictEqual(
			{
				state: EMPTY_EDIT_GUARD,
				forward: action,
			},
		);
	});

	it("holds actions that leave or close the dirty tab and forwards the rest", () =>
	{
		const actions = [
			{
				type: "reveal",
				path: README_PATH,
			},
			{
				type: "open",
				path: "/home/alice/proj/other.ts",
				pin: false,
			},
			{
				type: "close",
				path: PLAN_PATH,
			},
			{
				type: "close",
				path: README_PATH,
			},
			{
				type: "pin",
				path: PLAN_PATH,
			},
			{
				type: "move",
				path: PLAN_PATH,
				delta: 1,
			},
			{
				type: "open",
				path: PLAN_PATH,
				pin: true,
			},
		] as const;
		expect(
			actions.map((action) =>
			{
				const result = editGuardReducer(
					dirty,
					{
						type: "request",
						action,
						tabs,
					},
				);
				return {
					held: result.state.pending !== null,
					forwarded: result.forward !== null,
				};
			}),
		).toStrictEqual([
			{
				held: true,
				forwarded: false,
			},
			{
				held: true,
				forwarded: false,
			},
			{
				held: true,
				forwarded: false,
			},
			{
				held: false,
				forwarded: true,
			},
			{
				held: false,
				forwarded: true,
			},
			{
				held: false,
				forwarded: true,
			},
			{
				held: false,
				forwarded: true,
			},
		]);
	});

	it("Discard forwards the held action and forgets the edits; Keep editing drops it", () =>
	{
		const action =
		{
			type: "reveal",
			path: README_PATH,
		} as const;
		const held = editGuardReducer(
			dirty,
			{
				type: "request",
				action,
				tabs,
			},
		).state;
		expect(
			{
				discard: editGuardReducer(
					held,
					{
						type: "discard",
					},
				),
				keep: editGuardReducer(
					held,
					{
						type: "keepEditing",
					},
				),
			},
		).toStrictEqual(
			{
				discard:
				{
					state: EMPTY_EDIT_GUARD,
					forward: action,
				},
				keep:
				{
					state:
					{
						dirtyPath: PLAN_PATH,
						pending: null,
					},
					forward: null,
				},
			},
		);
	});

	it("a clean report from another path leaves the dirty path alone", () =>
	{
		expect(
			{
				other: editGuardReducer(
					dirty,
					{
						type: "dirty",
						path: README_PATH,
						dirty: false,
					},
				).state,
				same: editGuardReducer(
					dirty,
					{
						type: "dirty",
						path: PLAN_PATH,
						dirty: false,
					},
				).state,
			},
		).toStrictEqual(
			{
				other:
				{
					dirtyPath: PLAN_PATH,
					pending: null,
				},
				same: EMPTY_EDIT_GUARD,
			},
		);
	});
});

describe("save API disk-conflict check", () =>
{
	type PutHandler = (context: {
		params:
		{
			filename: string;
			id?: string;
		};
		request: Request;
	}) => Promise<Response>;

	function putHandler(route: unknown): PutHandler
	{
		return (
			route as
			{
				options:
				{
					server:
					{
						handlers:
						{
							PUT: PutHandler;
						};
					};
				};
			}
		).options.server.handlers.PUT;
	}

	let fixture: string;
	let planFile: string;
	let memoryFile: string;

	beforeEach(() =>
	{
		fixture = mkdtempSync(join(tmpdir(), "file-edit-test-"));
		mockedHome.path = fixture;
		mkdirSync(
			join(fixture, ".claude", "plans"),
			{
				recursive: true,
			},
		);
		mkdirSync(
			join(fixture, ".claude", "projects", "alice-project", "memory"),
			{
				recursive: true,
			},
		);
		planFile = join(fixture, ".claude", "plans", "alpha.md");
		memoryFile = join(fixture, ".claude", "projects", "alice-project", "memory", "notes.md");
		writeFileSync(planFile, "# Alpha\n");
		writeFileSync(memoryFile, "# Notes\n");
	});

	afterEach(() =>
	{
		rmSync(
			fixture,
			{
				recursive: true,
				force: true,
			},
		);
	});

	function put(body: string, ifMatch?: string): Request
	{
		return new Request(
			"http://localhost/api/x",
			{
				method: "PUT",
				headers:
				{
					"Content-Type": "text/plain",
					Origin: "http://localhost",
					"Sec-Fetch-Site": "same-origin",
					...(ifMatch === undefined
						? {}
						:
							{
								"If-Match": ifMatch,
							}),
				},
				body,
			},
		);
	}

	it("refuses a plan save whose If-Match no longer matches the file's mtime", async () =>
	{
		const response = await putHandler(PlanDetailRoute)(
			{
				params:
				{
					filename: "alpha",
				},
				request: put("# Mine\n", '"1"'),
			},
		);
		expect(
			{
				status: response.status,
				body: await response.text(),
				disk: readFileSync(planFile, "utf8"),
			},
		).toStrictEqual(
			{
				status: 409,
				body: "This file changed on disk since you started editing.",
				disk: "# Alpha\n",
			},
		);
	});

	it("saves a plan when If-Match matches, and returns the new ETag", async () =>
	{
		const response = await putHandler(PlanDetailRoute)(
			{
				params:
				{
					filename: "alpha",
				},
				request: put("# Mine\n", mtimeEtag(statSync(planFile).mtime)),
			},
		);
		expect(
			{
				status: response.status,
				etag: response.headers.get("ETag"),
				disk: readFileSync(planFile, "utf8"),
			},
		).toStrictEqual(
			{
				status: 200,
				etag: mtimeEtag(statSync(planFile).mtime),
				disk: "# Mine\n",
			},
		);
	});

	it("overrides without If-Match", async () =>
	{
		const response = await putHandler(PlanDetailRoute)(
			{
				params:
				{
					filename: "alpha",
				},
				request: put("# Forced\n"),
			},
		);
		expect([response.status, readFileSync(planFile, "utf8")]).toStrictEqual([200, "# Forced\n"]);
	});

	it("refuses a stale memory save and accepts a current one", async () =>
	{
		const handler = putHandler(MemoryDetailRoute);
		const params =
		{
			id: "alice-project",
			filename: "notes",
		};
		const stale = await handler(
			{
				params,
				request: put("# Stale\n", '"1"'),
			},
		);
		const staleDisk = readFileSync(memoryFile, "utf8");
		const current = await handler(
			{
				params,
				request: put("# Fresh\n", mtimeEtag(statSync(memoryFile).mtime)),
			},
		);
		expect(
			{
				stale: [stale.status, staleDisk],
				current: [current.status, readFileSync(memoryFile, "utf8")],
				etag: current.headers.get("ETag"),
			},
		).toStrictEqual(
			{
				stale: [409, "# Notes\n"],
				current: [200, "# Fresh\n"],
				etag: mtimeEtag(statSync(memoryFile).mtime),
			},
		);
	});
});

interface Put
{
	url: string;
	ifMatch: string | null;
	body: string;
}

let fileContents: Map<string, string>;
let puts: Put[];
let putStatuses: number[];
/** Files the GET reports as writable by the source editor, and those whose decode was lossy. */
let writablePaths: Set<string>;
let lossyPaths: Set<string>;
const SOURCE_ETAG = '"1000"';
const SOURCE_SAVED_ETAG = '"2000"';

function stubFetch(): void
{
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string, init?: RequestInit) =>
		{
			const url = new URL(input, "http://localhost");
			if (url.pathname.startsWith("/api/file/"))
			{
				const path = decodeFilePath(url.pathname.slice("/api/file/".length)) ?? "";
				if (init?.method === "PUT")
				{
					puts.push(
						{
							url: path,
							ifMatch: new Headers(init.headers).get("If-Match"),
							body: String(init.body),
						},
					);
					fileContents.set(path, String(init.body));
					return Promise.resolve(
						new Response(
							null,
							{
								status: 204,
								headers:
								{
									ETag: SOURCE_SAVED_ETAG,
								},
							},
						),
					);
				}
				const content = fileContents.get(path);
				if (content === undefined)
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
							content,
							path,
							...(writablePaths.has(path)
								?
									{
										etag: SOURCE_ETAG,
										writable: true,
										lossy: lossyPaths.has(path),
									}
								: {}),
						},
					),
				);
			}
			if (url.pathname === "/api/plans/alpha-plan" && (init?.method ?? "GET") === "GET")
			{
				return Promise.resolve(
					Response.json(
						{
							markdown: fileContents.get(PLAN_PATH),
							mtime: PLAN_MTIME,
							title: "Alpha plan",
						},
					),
				);
			}
			if (url.pathname === "/api/plans/alpha-plan" && init?.method === "PUT")
			{
				const headers = new Headers(init.headers);
				puts.push(
					{
						url: url.pathname,
						ifMatch: headers.get("If-Match"),
						body: String(init.body),
					},
				);
				const status = putStatuses.shift() ?? 200;
				if (status === 409)
				{
					return Promise.resolve(
						new Response(
							"This file changed on disk since you started editing.",
							{
								status,
							},
						),
					);
				}
				return Promise.resolve(
					Response.json(
						{
							title: "Alpha plan",
						},
						{
							headers:
							{
								ETag: mtimeEtag(new Date(SAVED_MTIME)),
							},
						},
					),
				);
			}
			return Promise.resolve(
				Response.json(
					{
						error: "unexpected",
					},
					{
						status: 500,
					},
				),
			);
		}),
	);
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

beforeEach(() =>
{
	fileContents = new Map([
		[PLAN_PATH, "# Alpha plan\n\nFirst draft.\n"],
		[README_PATH, "# Readme\n"],
	]);
	puts = [];
	putStatuses = [];
	writablePaths = new Set();
	lossyPaths = new Set();
	stubFetch();
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

function renderView(props: Parameters<typeof FileView>[0])
{
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
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<FileView {...props} />
			</ToastProvider>
		</QueryClientProvider>,
	);
}

async function startEditing(): Promise<HTMLTextAreaElement>
{
	fireEvent.click(
		await screen.findByRole(
			"button",
			{
				name: "Edit",
			},
		),
	);
	return await screen.findByRole(
		"textbox",
		{
			name: "Markdown editor",
		},
	);
}

function pressSave(target: Element): void
{
	fireEvent.keyDown(
		target,
		{
			key: "s",
			code: "KeyS",
			metaKey: true,
		},
	);
}

describe("FileView editing", () =>
{
	beforeEach(() =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
		);
	});

	it("offers Edit only for plan and memory markdown", async () =>
	{
		renderView(
			{
				path: README_PATH,
			},
		);
		await screen.findByText("Readme");
		expect(
			screen.queryByRole(
				"button",
				{
					name: "Edit",
				},
			),
		).toBeNull();
	});

	it("Edit swaps in the editor, reports the start and dirtiness, and ⌘S saves with If-Match", async () =>
	{
		const onEditStart = vi.fn<() => void>();
		const onDirtyChange = vi.fn<(dirty: boolean) => void>();
		renderView(
			{
				path: PLAN_PATH,
				onEditStart,
				onDirtyChange,
			},
		);
		await screen.findByText("First draft.");
		const editor = await startEditing();
		const startedWith = editor.value;
		fireEvent.change(
			editor,
			{
				target:
				{
					value: "# Alpha plan\n\nSecond draft.\n",
				},
			},
		);
		pressSave(editor);
		await waitFor(() =>
		{
			expect(puts).toHaveLength(1);
		});
		await flush();

		expect(
			{
				startedWith,
				editStarts: onEditStart.mock.calls.length,
				dirty: onDirtyChange.mock.calls.map(([dirty]) => dirty),
				puts,
				stillEditing:
					screen.queryByRole(
						"textbox",
						{
							name: "Markdown editor",
						},
					) !== null,
			},
		).toStrictEqual(
			{
				startedWith: "# Alpha plan\n\nFirst draft.\n",
				editStarts: 1,
				dirty: [true, false],
				puts: [
					{
						url: "/api/plans/alpha-plan",
						ifMatch: mtimeEtag(new Date(PLAN_MTIME)),
						body: "# Alpha plan\n\nSecond draft.\n",
					},
				],
				stillEditing: true,
			},
		);
	});

	it("holds a clean Save disabled in upstream's cds Button disabled look and paint", async () =>
	{
		renderView(
			{
				path: PLAN_PATH,
			},
		);
		await startEditing();
		const save = screen.getByRole(
			"button",
			{
				name: "Save",
			},
		);

		expect(
			{
				disabled: save.hasAttribute("disabled"),
				disabledLook: save.className.split(" ").filter((name) => name.includes("disabled")),
			},
		).toStrictEqual(
			{
				disabled: true,
				disabledLook: [...CDS_BUTTON_DISABLED.split(" "), CDS_BUTTON_DISABLED_FILL],
			},
		);
	});

	it("a second save sends the ETag the first save returned", async () =>
	{
		renderView(
			{
				path: PLAN_PATH,
			},
		);
		const editor = await startEditing();
		fireEvent.change(
			editor,
			{
				target:
				{
					value: "one",
				},
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Save",
				},
			),
		);
		await waitFor(() =>
		{
			expect(puts).toHaveLength(1);
		});
		await flush();
		fireEvent.change(
			editor,
			{
				target:
				{
					value: "two",
				},
			},
		);
		pressSave(editor);
		await waitFor(() =>
		{
			expect(puts).toHaveLength(2);
		});
		expect(puts.map((put) => put.ifMatch)).toStrictEqual([
			mtimeEtag(new Date(PLAN_MTIME)),
			mtimeEtag(new Date(SAVED_MTIME)),
		]);
	});

	it("a 409 opens the conflict dialog; Override resaves without If-Match", async () =>
	{
		putStatuses = [409, 200];
		renderView(
			{
				path: PLAN_PATH,
			},
		);
		const editor = await startEditing();
		fireEvent.change(
			editor,
			{
				target:
				{
					value: "mine",
				},
			},
		);
		pressSave(editor);
		const dialog = await screen.findByRole("alertdialog");
		const text = dialog.textContent;
		fireEvent.click(
			within(dialog).getByRole(
				"button",
				{
					name: "Override",
				},
			),
		);
		await waitFor(() =>
		{
			expect(puts).toHaveLength(2);
		});
		expect(
			{
				text,
				ifMatch: puts.map((put) => put.ifMatch),
			},
		).toStrictEqual(
			{
				text: "This file changed on disk since you started editing.DiscardOverride",
				ifMatch: [mtimeEtag(new Date(PLAN_MTIME)), null],
			},
		);
	});

	it("Discard in the conflict dialog drops the edits and shows the file again", async () =>
	{
		putStatuses = [409];
		const onDirtyChange = vi.fn<(dirty: boolean) => void>();
		renderView(
			{
				path: PLAN_PATH,
				onDirtyChange,
			},
		);
		const editor = await startEditing();
		fireEvent.change(
			editor,
			{
				target:
				{
					value: "mine",
				},
			},
		);
		pressSave(editor);
		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(
			within(dialog).getByRole(
				"button",
				{
					name: "Discard",
				},
			),
		);
		await flush();
		expect(
			{
				editor: screen.queryByRole(
					"textbox",
					{
						name: "Markdown editor",
					},
				),
				preview: (await screen.findByText("First draft.")).tagName,
				dirty: onDirtyChange.mock.calls.at(-1),
				puts: puts.length,
			},
		).toStrictEqual(
			{
				editor: null,
				preview: "P",
				dirty: [false],
				puts: 1,
			},
		);
	});

	it("Cancel leaves the editor without saving", async () =>
	{
		renderView(
			{
				path: PLAN_PATH,
			},
		);
		await startEditing();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Cancel",
				},
			),
		);
		expect(
			{
				editor: screen.queryByRole(
					"textbox",
					{
						name: "Markdown editor",
					},
				),
				edit:
					screen.queryByRole(
						"button",
						{
							name: "Edit",
						},
					) !== null,
				puts: puts.length,
			},
		).toStrictEqual(
			{
				editor: null,
				edit: true,
				puts: 0,
			},
		);
	});
});

const SESSION_FILES =
{
	files: [
		{
			path: PLAN_PATH,
			absolutePath: PLAN_PATH,
			occurrences: [
				{
					source: "tool",
					anchorIndex: 10,
					role: "assistant",
					tool: "Read",
				},
			],
		},
		{
			path: README_PATH,
			absolutePath: README_PATH,
			occurrences: [
				{
					source: "tool",
					anchorIndex: 20,
					role: "assistant",
					tool: "Read",
				},
			],
		},
	],
	totalCount: 2,
	counts:
	{
		userMessage: 0,
		agentMessage: 0,
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

/** The mounted source editor, once the lazy CodeMirror chunk has replaced the static fallback. */
async function sourceView(): Promise<EditorView>
{
	let view: EditorView | null = null;
	await waitFor(() =>
	{
		const editor = document.querySelector<HTMLElement>(".cm-editor");
		view = editor === null ? null : EditorView.findFromDOM(editor);
		if (view === null) throw new Error("source editor not loaded");
	});
	return view as unknown as EditorView;
}

function typeInSource(view: EditorView, text: string): void
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

/** Advance the autosave idle timer, then let the save's fetch settle. */
async function idle(ms: number): Promise<void>
{
	act(() =>
	{
		vi.advanceTimersByTime(ms);
	});
	vi.useRealTimers();
	await flush();
	await flush();
}

function headerButtons(): string[]
{
	return [...document.querySelectorAll(".h-8 button")].map(
		(button) => button.getAttribute("aria-label") ?? button.textContent,
	);
}

describe("FileView source editing", () =>
{
	beforeEach(() =>
	{
		fileContents.set(SOURCE_PATH, "export const a = 1;\n");
		writablePaths.add(SOURCE_PATH);
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
		);
	});

	afterEach(() =>
	{
		vi.useRealTimers();
		localStorage.clear();
		vi.restoreAllMocks();
	});

	it("edits a writable file in place and autosaves 1000 ms after the last change, never arming the guard", async () =>
	{
		const onDirtyChange = vi.fn<(dirty: boolean) => void>();
		const onEditStart = vi.fn<() => void>();
		renderView(
			{
				path: SOURCE_PATH,
				onDirtyChange,
				onEditStart,
			},
		);
		const view = await sourceView();
		const content = view.contentDOM;
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout"],
			},
		);
		typeInSource(view, "// one\n");
		act(() =>
		{
			vi.advanceTimersByTime(400);
		});
		typeInSource(view, "// two\n");
		const whileTyping = headerButtons();
		act(() =>
		{
			vi.advanceTimersByTime(999);
		});
		const putsBeforeIdle = puts.length;
		await idle(1);

		expect(
			{
				readOnly: content.getAttribute("aria-readonly"),
				whileTyping,
				putsBeforeIdle,
				puts,
				editStarts: onEditStart.mock.calls.length,
				dirty: onDirtyChange.mock.calls.map(([dirty]) => dirty),
			},
		).toStrictEqual(
			{
				readOnly: null,
				whileTyping: [`Copy path ${SOURCE_PATH}`],
				putsBeforeIdle: 0,
				puts: [
					{
						url: SOURCE_PATH,
						ifMatch: SOURCE_ETAG,
						body: "export const a = 1;\n// one\n// two\n",
					},
				],
				editStarts: 1,
				dirty: [],
			},
		);
	});

	it("keeps an unwritable file read-only", async () =>
	{
		writablePaths.clear();
		renderView(
			{
				path: SOURCE_PATH,
			},
		);
		const view = await sourceView();
		expect(view.contentDOM.getAttribute("aria-readonly")).toBe("true");
	});

	it("drops the Edit button for a writable plan, which edits in source view", async () =>
	{
		writablePaths.add(PLAN_PATH);
		renderView(
			{
				path: PLAN_PATH,
			},
		);
		await screen.findByText("First draft.");
		expect(headerButtons()).toStrictEqual([`Copy path ${PLAN_PATH}`, "View source"]);
	});

	it("manual mode shows ghost Cancel and secondary Save only while dirty; Save keeps editor focus", async () =>
	{
		localStorage.setItem("epitaxy-thimble", "false");
		const onDirtyChange = vi.fn<(dirty: boolean) => void>();
		renderView(
			{
				path: SOURCE_PATH,
				onDirtyChange,
			},
		);
		const view = await sourceView();
		const clean = headerButtons();
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout"],
			},
		);
		typeInSource(view, "// draft\n");
		await idle(1000);
		const dirtyButtons = headerButtons();
		const putsAfterIdle = puts.length;
		const save = screen.getByRole(
			"button",
			{
				name: "Save",
			},
		);
		const cancel = screen.getByRole(
			"button",
			{
				name: "Cancel",
			},
		);
		const mouseDownAllowed = fireEvent.mouseDown(save);
		fireEvent.click(save);
		await flush();
		await flush();

		expect(
			{
				clean,
				dirtyButtons,
				classes:
				{
					cancel: cancel.className.includes("hover:bg-fill-ghost-hover"),
					save: save.className.includes("bg-fill-secondary"),
				},
				putsAfterIdle,
				mouseDownAllowed,
				puts,
				after: headerButtons(),
				dirty: onDirtyChange.mock.calls.map(([dirty]) => dirty),
			},
		).toStrictEqual(
			{
				clean: [`Copy path ${SOURCE_PATH}`],
				dirtyButtons: [`Copy path ${SOURCE_PATH}`, "Cancel", "Save"],
				classes:
				{
					cancel: true,
					save: true,
				},
				putsAfterIdle: 0,
				mouseDownAllowed: false,
				puts: [
					{
						url: SOURCE_PATH,
						ifMatch: SOURCE_ETAG,
						body: "export const a = 1;\n// draft\n",
					},
				],
				after: [`Copy path ${SOURCE_PATH}`],
				dirty: [true, false],
			},
		);
	});

	it("manual mode Cancel restores the disk text and hides both buttons", async () =>
	{
		localStorage.setItem("epitaxy-thimble", "false");
		renderView(
			{
				path: SOURCE_PATH,
			},
		);
		const view = await sourceView();
		typeInSource(view, "// draft\n");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Cancel",
				},
			),
		);
		expect(
			{
				text: view.state.doc.toString(),
				buttons: headerButtons(),
				puts,
			},
		).toStrictEqual(
			{
				text: "export const a = 1;\n",
				buttons: [`Copy path ${SOURCE_PATH}`],
				puts: [],
			},
		);
	});

	it.each([
		{
			pref: null,
			copy: "This file isn’t valid UTF-8, so it’s saved only when you press Save. A save writes each \uFFFD to the file, and the original characters are lost.",
		},
		{
			pref: "false",
			copy: "This file isn’t valid UTF-8. A save writes each \uFFFD to the file, and the original characters are lost.",
		},
	])("a lossy file shows upstream's notice (pref $pref) and saves only on Save", async ({pref, copy}) =>
	{
		if (pref !== null) localStorage.setItem("epitaxy-thimble", pref);
		lossyPaths.add(SOURCE_PATH);
		renderView(
			{
				path: SOURCE_PATH,
			},
		);
		const view = await sourceView();
		const notice = screen.getAllByRole("status").find((element) => element.classList.contains("bg-alpha-2"));
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout"],
			},
		);
		typeInSource(view, "x");
		await idle(1000);
		expect(
			{
				copy: notice?.textContent,
				className: notice?.className,
				puts,
				buttons: headerButtons(),
			},
		).toStrictEqual(
			{
				copy,
				className: "shrink-0 bg-alpha-2 px-md py-1.25 text-body text-primary",
				puts: [],
				buttons: [`Copy path ${SOURCE_PATH}`, "Cancel", "Save"],
			},
		);
	});
});

describe("Files pane editing", () =>
{
	let unregister: () => void = () =>
	{
	};

	beforeEach(() =>
	{
		installLocalStorage();
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
		vi.restoreAllMocks();
	});

	async function openPane(): Promise<HTMLElement>
	{
		unregister = registerPane(
			"files",
			{
				title: "Files",
				header: "custom",
				render: (chrome) => (
					<FilesPaneView chrome={chrome} sessionFiles={SESSION_FILES} unscannedRecordCount={0} />
				),
			},
		);
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
				<SettingsProvider>
					<ToastProvider>
						<TileHost
							sessionId="file-edit"
							onExpandWithoutPane={() =>
							{
							}}
						>
							<FilesPaneShortcut />
						</TileHost>
					</ToastProvider>
				</SettingsProvider>
			</QueryClientProvider>,
		);
		act(() =>
		{
			document.body.dispatchEvent(
				new KeyboardEvent(
					"keydown",
					{
						bubbles: true,
						cancelable: true,
						key: "f",
						code: "KeyF",
						metaKey: true,
						shiftKey: true,
					},
				),
			);
		});
		await flush();
		return screen.getByRole(
			"region",
			{
				name: "Files",
			},
		);
	}

	function tabs(pane: HTMLElement): Array<
	{
		name: string;
		italic: boolean;
		selected: boolean;
	}>
	{
		return within(pane)
			.queryAllByRole("tab")
			.map((tab) => (
			{
				name: tab.textContent,
				italic: tab.className.split(/\s+/).includes("italic"),
				selected: tab.getAttribute("aria-selected") === "true",
			}));
	}

	async function openPlanAndEdit(pane: HTMLElement): Promise<HTMLTextAreaElement>
	{
		fireEvent.click(
			within(pane).getByRole(
				"button",
				{
					name: PLAN_PATH,
				},
			),
		);
		await flush();
		fireEvent.click(
			await within(pane).findByRole(
				"button",
				{
					name: "Edit",
				},
			),
		);
		return await within(pane).findByRole(
			"textbox",
			{
				name: "Markdown editor",
			},
		);
	}

	it("starting an edit pins the preview tab", async () =>
	{
		const pane = await openPane();
		fireEvent.click(
			within(pane).getByRole(
				"button",
				{
					name: PLAN_PATH,
				},
			),
		);
		await flush();
		const before = tabs(pane);
		await openPlanAndEdit(pane);
		expect(
			{
				before,
				after: tabs(pane),
			},
		).toStrictEqual(
			{
				before: [
					{
						name: "alpha-plan.md, preview",
						italic: true,
						selected: true,
					},
				],
				after: [
					{
						name: "alpha-plan.md",
						italic: false,
						selected: true,
					},
				],
			},
		);
	});

	async function editReadmeSource(pane: HTMLElement): Promise<void>
	{
		writablePaths.add(README_PATH);
		fireEvent.click(
			within(pane).getByRole(
				"button",
				{
					name: README_PATH,
				},
			),
		);
		await flush();
		fireEvent.click(
			await within(pane).findByRole(
				"button",
				{
					name: "View source",
				},
			),
		);
		typeInSource(await sourceView(), "More.\n");
		await flush();
		fireEvent.click(
			within(pane).getByRole(
				"button",
				{
					name: PLAN_PATH,
				},
			),
		);
		await flush();
		await flush();
	}

	it("with autosave on, leaving an edited tab saves it on unmount instead of asking", async () =>
	{
		const pane = await openPane();
		await editReadmeSource(pane);
		expect(
			{
				dialog: screen.queryByRole("alertdialog") !== null,
				puts,
			},
		).toStrictEqual(
			{
				dialog: false,
				puts: [
					{
						url: README_PATH,
						ifMatch: SOURCE_ETAG,
						body: "# Readme\nMore.\n",
					},
				],
			},
		);
	});

	it("with autosave off, leaving an edited tab asks first", async () =>
	{
		localStorage.setItem("epitaxy-thimble", "false");
		const pane = await openPane();
		await editReadmeSource(pane);
		expect(
			{
				dialog: screen.queryByRole("alertdialog")?.textContent,
				puts,
			},
		).toStrictEqual(
			{
				dialog: "Discard unsaved changes?Your edits to README.md have not been saved. Leaving this tab discards them.Keep editingDiscard",
				puts: [],
			},
		);
	});

	it("leaving a dirty tab asks first; Keep editing stays and Discard leaves", async () =>
	{
		const pane = await openPane();
		const editor = await openPlanAndEdit(pane);
		fireEvent.change(
			editor,
			{
				target:
				{
					value: "unsaved",
				},
			},
		);
		await flush();
		fireEvent.click(
			within(pane).getByRole(
				"button",
				{
					name: README_PATH,
				},
			),
		);
		const dialog = await screen.findByRole("alertdialog");
		const text = dialog.textContent;
		fireEvent.click(
			within(dialog).getByRole(
				"button",
				{
					name: "Keep editing",
				},
			),
		);
		await flush();
		const kept =
		{
			tabs: tabs(pane),
			editor:
				within(pane).queryByRole(
					"textbox",
					{
						name: "Markdown editor",
					},
				) !== null,
		};

		fireEvent.click(
			within(pane).getByRole(
				"button",
				{
					name: `Close alpha-plan.md`,
				},
			),
		);
		fireEvent.click(
			within(await screen.findByRole("alertdialog")).getByRole(
				"button",
				{
					name: "Discard",
				},
			),
		);
		await flush();

		expect(
			{
				text,
				kept,
				left: tabs(pane),
			},
		).toStrictEqual(
			{
				text: "Discard unsaved changes?Your edits to alpha-plan.md have not been saved. Leaving this tab discards them.Keep editingDiscard",
				kept:
				{
					tabs: [
						{
							name: "alpha-plan.md",
							italic: false,
							selected: true,
						},
					],
					editor: true,
				},
				left: [],
			},
		);
	});
});
