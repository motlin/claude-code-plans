// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {type ComponentProps, type ComponentType, type ReactNode, useState} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {FileTypeIconSetContext} from "../src/components/file-type-icon-set-context";
import {FilesTree, FilesTreeColumn} from "../src/components/files/files-tree";
import
{
	FILES_TREE_WIDTH_STORAGE_KEY,
	clampFilesTreeWidth,
	goUpTarget,
	parseTreeQuery,
} from "../src/components/files/files-tree-layout";
import {SettingsProvider} from "../src/components/settings-provider";
import {RESIZE_GRIP_PILL, RESIZE_LINE_PILL, resizePillClass} from "../src/components/ui/resize-pill";
import type {SessionFilesResponse} from "../src/lib/api/session-files";
import {installLocalStorage} from "./fake-storage";
import {stubColumnLayout} from "./helpers/column-layout";
import {PanelsOff} from "./fizzy-lake-off";

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

const SESSION_ID = "tree-session";

function file(relPath: string)
{
	return {
		name: relPath.split("/").at(-1) ?? relPath,
		relPath,
		isDirectory: false,
	};
}

function folder(relPath: string)
{
	return {
		name: relPath.split("/").at(-1) ?? relPath,
		relPath,
		isDirectory: true,
	};
}

/** Responses keyed by the request's `dir` and `q` parameters. */
let responses: Map<string, SessionFilesResponse>;
let requests: string[];

function key(dir: string, query: string): string
{
	return `${dir}|${query}`;
}

function stubFetch(): void
{
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string) =>
		{
			const url = new URL(input, "http://localhost");
			const dir = url.searchParams.get("dir") ?? "";
			const query = url.searchParams.get("q") ?? "";
			requests.push(key(dir, query));
			const body = responses.get(key(dir, query));
			if (body === undefined)
				return Promise.resolve(
					Response.json(
						{
							error: "not found",
						},
						{
							status: 404,
						},
					),
				);
			return Promise.resolve(Response.json(body));
		}),
	);
}

function renderTree(
	onOpenFile = vi.fn<NonNullable<ComponentProps<typeof FilesTree>["onOpenFile"]>>(),
	wrapper?: ComponentType<
	{
		children: ReactNode;
	}>,
)
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
	render(
		<QueryClientProvider client={queryClient}>
			<SettingsProvider>
				<FileTypeIconSetContext value="pierre">
					<FilesTreeColumn>
						<FilesTree sessionId={SESSION_ID} onOpenFile={onOpenFile} />
					</FilesTreeColumn>
				</FileTypeIconSetContext>
			</SettingsProvider>
		</QueryClientProvider>,
		wrapper === undefined
			? {}
			:
				{
					wrapper,
				},
	);
	return onOpenFile;
}

function filterInput(): HTMLInputElement
{
	return screen.getByRole(
		"textbox",
		{
			name: "Filter files",
		},
	);
}

function rowNames(): string[]
{
	return screen.queryAllByRole("treeitem").map((row) => row.querySelector("[data-tree-name]")?.textContent ?? "");
}

let storage: ReturnType<typeof installLocalStorage>;
let restoreLayout: () => void;

beforeEach(() =>
{
	restoreLayout = stubColumnLayout();
	storage = installLocalStorage();
	responses = new Map();
	requests = [];
	stubFetch();
	vi.stubGlobal("ResizeObserver", FakeObserver);
});

afterEach(() =>
{
	cleanup();
	restoreLayout();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("parseTreeQuery", () =>
{
	it.each([
		[
			"",
			{
				dir: "",
				search: "",
			},
		],
		[
			"tst",
			{
				dir: "",
				search: "tst",
			},
		],
		[
			"src/",
			{
				dir: "src",
				search: "",
			},
		],
		[
			"src/components/",
			{
				dir: "src/components",
				search: "",
			},
		],
		[
			"src/comp",
			{
				dir: "src",
				search: "comp",
			},
		],
		[
			"  src/ ",
			{
				dir: "src",
				search: "",
			},
		],
	])("%j", (query, expected) =>
	{
		expect(parseTreeQuery(query)).toStrictEqual(expected);
	});
});

describe("goUpTarget", () =>
{
	it.each([
		[
			"src",
			{
				label: "Go up to project files",
				query: "",
			},
		],
		[
			"src/components",
			{
				label: "Go up to src",
				query: "src/",
			},
		],
		[
			"a/b/c",
			{
				label: "Go up to b",
				query: "a/b/",
			},
		],
	])("%s", (dir, expected) =>
	{
		expect(goUpTarget(dir)).toStrictEqual(expected);
	});
});

describe("clampFilesTreeWidth", () =>
{
	it.each([
		[240, 240],
		[100, 160],
		[9999, 640],
		[Number.NaN, 240],
	])("%d → %d", (width, expected) =>
	{
		expect(clampFilesTreeWidth(width)).toBe(expected);
	});
});

describe("FilesTree drill-in", () =>
{
	it("sets the query to the folder, lists it, and shows Go up", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [folder("src"), file("README.md")],
				partial: false,
			},
		);
		responses.set(
			key("src", ""),
			{
				kind: "listing",
				dir: "src",
				entries: [folder("src/components"), file("src/main.ts")],
				partial: false,
			},
		);
		responses.set(
			key("src/components", ""),
			{
				kind: "listing",
				dir: "src/components",
				entries: [file("src/components/app.tsx")],
				partial: false,
			},
		);
		renderTree();

		await screen.findByText("README.md");
		const rootState =
		{
			rows: rowNames(),
			goUp: screen.queryByRole(
				"button",
				{
					name: /^Go up/,
				},
			),
		};

		fireEvent.click(screen.getByText("src"));
		await screen.findByText("main.ts");
		const srcState =
		{
			query: filterInput().value,
			rows: rowNames(),
			goUp: screen.getByRole(
				"button",
				{
					name: /^Go up/,
				},
			).textContent,
		};

		fireEvent.click(screen.getByText("components"));
		await screen.findByText("app.tsx");
		const componentsState =
		{
			query: filterInput().value,
			goUp: screen.getByRole(
				"button",
				{
					name: /^Go up/,
				},
			).textContent,
		};

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Go up to src",
				},
			),
		);
		await screen.findByText("main.ts");
		const upState =
		{
			query: filterInput().value,
		};

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Go up to project files",
				},
			),
		);
		await screen.findByText("README.md");

		expect(
			{
				rootState,
				srcState,
				componentsState,
				upState,
				finalQuery: filterInput().value,
				finalGoUp: screen.queryByRole(
					"button",
					{
						name: /^Go up/,
					},
				),
			},
		).toStrictEqual(
			{
				rootState:
				{
					rows: ["src", "README.md"],
					goUp: null,
				},
				srcState:
				{
					query: "src/",
					rows: ["components", "main.ts"],
					goUp: "Go up to project files",
				},
				componentsState:
				{
					query: "src/components/",
					goUp: "Go up to src",
				},
				upState:
				{
					query: "src/",
				},
				finalQuery: "",
				finalGoUp: null,
			},
		);
	});

	it("Clear filter empties the query", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [folder("src")],
				partial: false,
			},
		);
		responses.set(
			key("src", ""),
			{
				kind: "listing",
				dir: "src",
				entries: [file("src/main.ts")],
				partial: false,
			},
		);
		renderTree();
		fireEvent.click(await screen.findByText("src"));
		await screen.findByText("main.ts");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Clear filter",
				},
			),
		);
		await screen.findByText("src");
		expect(
			{
				query: filterInput().value,
				clear: screen.queryByRole(
					"button",
					{
						name: "Clear filter",
					},
				),
			},
		).toStrictEqual(
			{
				query: "",
				clear: null,
			},
		);
	});
});

describe("FilesTree footers and states", () =>
{
	it("shows the partial-listing footer", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [file("a.ts")],
				partial: true,
			},
		);
		renderTree();
		expect(await screen.findByText("Some entries may not be listed. Keep typing to narrow.")).toBeTruthy();
	});

	it("shows the capped-results footer and dir suffixes for search results", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
			},
		);
		responses.set(
			key("", "tst"),
			{
				kind: "search",
				dir: "",
				query: "tst",
				results: [file("tslib.js"), folder("test"), file("node_modules/tslib/test-games.js")],
				partial: false,
				capped: true,
			},
		);
		renderTree();
		fireEvent.change(
			filterInput(),
			{
				target:
				{
					value: "tst",
				},
			},
		);
		await screen.findByText("Only the first 3 results are shown. Keep typing to narrow.");
		expect(
			{
				rows: screen
					.getAllByRole("treeitem")
					.map((row) => [
						row.querySelector("[data-tree-name]")?.textContent,
						row.querySelector("[data-tree-dir]")?.textContent ?? null,
					]),
				partialFooter: screen.queryByText("Some entries may not be listed. Keep typing to narrow."),
			},
		).toStrictEqual(
			{
				rows: [
					["tslib.js", null],
					["test", null],
					["test-games.js", "node_modules/tslib"],
				],
				partialFooter: null,
			},
		);
	});

	it("shows the partial footer for a search over a partial walk", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
			},
		);
		responses.set(
			key("", "x"),
			{
				kind: "search",
				dir: "",
				query: "x",
				results: [file("x.ts")],
				partial: true,
				capped: false,
			},
		);
		renderTree();
		fireEvent.change(
			filterInput(),
			{
				target:
				{
					value: "x",
				},
			},
		);
		expect(await screen.findByText("Some entries may not be listed. Keep typing to narrow.")).toBeTruthy();
	});

	it("shows Folder is empty for an empty listing", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
			},
		);
		renderTree();
		expect(await screen.findByText("Folder is empty")).toBeTruthy();
	});

	it("shows No matching files for an empty search", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
			},
		);
		responses.set(
			key("", "zzz"),
			{
				kind: "search",
				dir: "",
				query: "zzz",
				results: [],
				partial: false,
				capped: false,
			},
		);
		renderTree();
		fireEvent.change(
			filterInput(),
			{
				target:
				{
					value: "zzz",
				},
			},
		);
		expect(await screen.findByText("No matching files")).toBeTruthy();
	});

	it("shows No working directory for this session", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "no-cwd",
			},
		);
		renderTree();
		expect(await screen.findByText("No working directory for this session")).toBeTruthy();
	});

	it("shows an error when the folder cannot be read", async () =>
	{
		renderTree();
		expect(await screen.findByText("Couldn’t read this folder.")).toBeTruthy();
	});
});

describe("FilesTree keyboard and pointer", () =>
{
	beforeEach(() =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [file("a.ts"), file("b.ts")],
				partial: false,
			},
		);
	});

	it("moves between the input and the rows with Down/Up", async () =>
	{
		renderTree();
		await screen.findByText("b.ts");
		const input = filterInput();
		input.focus();
		fireEvent.keyDown(
			input,
			{
				key: "ArrowDown",
			},
		);
		const first = document.activeElement?.querySelector("[data-tree-name]")?.textContent;
		fireEvent.keyDown(
			document.activeElement!,
			{
				key: "ArrowDown",
			},
		);
		const second = document.activeElement?.querySelector("[data-tree-name]")?.textContent;
		fireEvent.keyDown(
			document.activeElement!,
			{
				key: "ArrowUp",
			},
		);
		fireEvent.keyDown(
			document.activeElement!,
			{
				key: "ArrowUp",
			},
		);
		expect(
			{
				first,
				second,
				back: document.activeElement === input,
			},
		).toStrictEqual(
			{
				first: "a.ts",
				second: "b.ts",
				back: true,
			},
		);
	});

	it("opens a file with Enter as a preview, and pins on double-click", async () =>
	{
		const onOpenFile = renderTree();
		await screen.findByText("b.ts");
		const input = filterInput();
		input.focus();
		fireEvent.keyDown(
			input,
			{
				key: "ArrowDown",
			},
		);
		fireEvent.keyDown(
			document.activeElement!,
			{
				key: "Enter",
			},
		);
		fireEvent.click(screen.getByText("b.ts"));
		fireEvent.doubleClick(screen.getByText("b.ts"));
		expect(onOpenFile.mock.calls).toStrictEqual([
			[
				"a.ts",
				{
					pin: false,
				},
			],
			[
				"b.ts",
				{
					pin: false,
				},
			],
			[
				"b.ts",
				{
					pin: true,
				},
			],
		]);
	});
});

describe("FilesTree density", () =>
{
	it("draws 13px rows 19px tall on upstream's 24px pitch with 12px icons 4px before the name, a full-width Go up row and upstream's filter", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [folder("src")],
				partial: false,
			},
		);
		responses.set(
			key("src", ""),
			{
				kind: "listing",
				dir: "src",
				entries: [file("src/main.ts"), file("src/util.ts")],
				partial: false,
			},
		);
		renderTree();
		fireEvent.click(await screen.findByText("src"));
		await screen.findByText("main.ts");

		const [row, next] = screen.getAllByRole("treeitem");
		if (row === undefined || next === undefined) throw new Error("Expected two tree rows");
		const icon = row.querySelector("svg");
		const rowClasses = row.className.split(" ");
		const goUp = screen.getByRole(
			"button",
			{
				name: "Go up to project files",
			},
		);
		const goUpClasses = goUp.className.split(" ");
		const input = filterInput();
		const inputClasses = input.className.split(" ");
		expect(
			{
				rowText: rowClasses.includes("text-pane"),
				rowHeight: rowClasses.includes("h-[19px]") && rowClasses.includes("rounded-r3"),
				pitch: Number.parseFloat(next.style.top) - Number.parseFloat(row.style.top),
				icon:
				{
					fileTypeIcon: icon?.hasAttribute("data-file-type-icon"),
					width: icon?.style.width,
					className: icon?.getAttribute("class"),
					fill: icon?.querySelector("path")?.getAttribute("fill"),
				},
				nameGap: row.querySelector("[data-tree-primary]")?.className.split(" ").includes("gap-1"),
				goUpFullWidth: goUpClasses.includes("w-full"),
				goUpText: goUpClasses.includes("text-pane"),
				goUpFill: goUpClasses.includes("bg-fill-control"),
				goUpFirstChild: goUp.firstElementChild?.getAttribute("class")?.split(" ").includes("lucide-arrow-up"),
				placeholder: input.placeholder,
				inputText: inputClasses.includes("text-pane"),
				inputFocusRing: inputClasses.includes(
					"focus:shadow-[0_0_0_1px_rgb(37,125,224),0_0_6px_1px_rgb(205,226,251)]",
				),
				clearSize: screen
					.getByRole(
						"button",
						{
							name: "Clear filter",
						},
					)
					.className.split(" ")
					.includes("size-[18px]"),
			},
		).toStrictEqual(
			{
				rowText: true,
				rowHeight: true,
				pitch: 24,
				icon:
				{
					fileTypeIcon: true,
					width: "12px",
					className: "shrink-0 self-center text-ink-muted",
					fill: "var(--fti-typescript)",
				},
				nameGap: true,
				goUpFullWidth: true,
				goUpText: true,
				goUpFill: true,
				goUpFirstChild: true,
				placeholder: "Search files…",
				inputText: true,
				inputFocusRing: true,
				clearSize: true,
			},
		);
	});
});

describe("FilesTree virtualization", () =>
{
	it("renders only a window of a long listing", async () =>
	{
		const entries = Array.from(
			{
				length: 500,
			},
			(_, index) => file(`f${index}.ts`),
		);
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries,
				partial: false,
			},
		);
		renderTree();
		await screen.findByText("f0.ts");
		const rows = screen.getAllByRole("treeitem");
		expect(
			{
				windowed: rows.length < 100,
				firstIndex: rows[0]?.getAttribute("data-row-index"),
			},
		).toStrictEqual(
			{
				windowed: true,
				firstIndex: "0",
			},
		);
	});
});

describe("FilesTree name tooltips", () =>
{
	it("shows the full name only on rows whose name overflows", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [file("a-very-long-file-name-that-truncates.ts"), file("short.ts")],
				partial: false,
			},
		);
		renderTree();
		const long = await screen.findByText("a-very-long-file-name-that-truncates.ts");
		Object.defineProperty(
			long,
			"scrollWidth",
			{
				configurable: true,
				value: 300,
			},
		);
		Object.defineProperty(
			long,
			"clientWidth",
			{
				configurable: true,
				value: 120,
			},
		);

		fireEvent.pointerEnter(screen.getByText("short.ts"));
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 400);
		});
		const shortTooltip = screen.queryByRole("tooltip");
		fireEvent.pointerLeave(screen.getByText("short.ts"));
		fireEvent.pointerEnter(long);
		const longTooltip = await waitFor(() => screen.getByRole("tooltip"));

		expect(
			{
				short: shortTooltip,
				long: longTooltip.textContent,
			},
		).toStrictEqual(
			{
				short: null,
				long: "a-very-long-file-name-that-truncates.ts",
			},
		);
	});
});

describe("FilesTreeColumn resize", () =>
{
	function separator(): HTMLElement
	{
		return screen.getByRole(
			"separator",
			{
				name: "Resize file tree",
			},
		);
	}

	it("defaults to 240 and clamps keyboard resizing to 160–640", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
			},
		);
		renderTree();
		const initial = separator().getAttribute("aria-valuenow");
		fireEvent.keyDown(
			separator(),
			{
				key: "ArrowRight",
			},
		);
		const stepped = separator().getAttribute("aria-valuenow");
		fireEvent.keyDown(
			separator(),
			{
				key: "End",
			},
		);
		fireEvent.keyDown(
			separator(),
			{
				key: "ArrowRight",
			},
		);
		const max = separator().getAttribute("aria-valuenow");
		fireEvent.keyDown(
			separator(),
			{
				key: "Home",
			},
		);
		fireEvent.keyDown(
			separator(),
			{
				key: "ArrowLeft",
			},
		);
		const min = separator().getAttribute("aria-valuenow");
		await waitFor(() =>
		{
			expect(storage.getItem(FILES_TREE_WIDTH_STORAGE_KEY)).toBe("160");
		});
		expect(
			{
				initial,
				stepped,
				max,
				min,
			},
		).toStrictEqual(
			{
				initial: "240",
				stepped: "248",
				max: "640",
				min: "160",
			},
		);
	});

	it("is upstream's cds ResizeHandle on the column's border, half-clipped at rest, with the panels line pill", () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
			},
		);
		renderTree();
		const pill = separator().querySelector("[data-cds-part=resize-pill]");

		expect(
			{
				cds: separator().dataset["cds"],
				classes: [...separator().classList].toSorted(),
				ringOuter: separator().style.getPropertyValue("--cds-ring-outer"),
				zIndex: separator().style.zIndex,
				ring: separator().firstElementChild?.classList.contains("group-focus-visible/resize:shadow-focus"),
				pill: pill?.getAttribute("class"),
				tabIndex: separator().tabIndex,
			},
		).toStrictEqual(
			{
				cds: "ResizeHandle",
				classes: [
					"cds-reset group/resize outline-none focus-visible:outline-hidden w-3 cursor-col-resize absolute",
					"inset-y-0 end-[calc(-6px_-_(var(--cds-ring-outer,0px)_-_var(--cds-ring-inner,0px))_/_2)]",
					"[clip-path:inset(0_0_0_37.5%)] [&:where(:root[dir=rtl]_:dir(rtl))]:[clip-path:inset(0_37.5%_0_0)] focus-visible:[clip-path:none]",
				]
					.join(" ")
					.split(" ")
					.toSorted(),
				ringOuter: "1px",
				zIndex: "5",
				ring: true,
				pill: resizePillClass(RESIZE_LINE_PILL, "vertical", false),
				tabIndex: 0,
			},
		);
	});

	it("uses upstream's grip pill when panels is off", () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
			},
		);
		renderTree(undefined, PanelsOff);
		const pill = separator().querySelector("[data-cds-part=resize-pill]");

		expect(pill?.getAttribute("class")).toBe(resizePillClass(RESIZE_GRIP_PILL, "vertical", false));
	});

	it("shows no tooltip on hover or focus", async () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
			},
		);
		renderTree();

		fireEvent.pointerEnter(separator());
		fireEvent.focus(separator());
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 600);
		});

		expect(
			{
				tooltip: screen.queryByRole("tooltip"),
				describedBy: separator().getAttribute("aria-describedby"),
			},
		).toStrictEqual(
			{
				tooltip: null,
				describedBy: null,
			},
		);
	});

	it("hides the tree on a click that stays within the drag threshold, but not on a drag", () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
			},
		);
		const onShownChange = vi.fn<(shown: boolean) => void>();
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
					<FilesTreeColumn onShownChange={onShownChange}>
						<FilesTree sessionId={SESSION_ID} />
					</FilesTreeColumn>
				</SettingsProvider>
			</QueryClientProvider>,
		);
		const handle = separator();

		fireEvent.pointerDown(
			handle,
			{
				button: 0,
				clientX: 240,
			},
		);
		fireEvent.pointerMove(
			handle,
			{
				clientX: 280,
			},
		);
		fireEvent.pointerUp(
			handle,
			{
				clientX: 280,
			},
		);
		const afterDrag = onShownChange.mock.calls.length;
		fireEvent.pointerDown(
			handle,
			{
				button: 0,
				clientX: 280,
			},
		);
		fireEvent.pointerUp(
			handle,
			{
				clientX: 281,
			},
		);

		expect(
			{
				afterDrag,
				afterClick: onShownChange.mock.calls,
			},
		).toStrictEqual(
			{
				afterDrag: 0,
				afterClick: [[false]],
			},
		);
	});

	it("hides the tree on Enter and Space, like a click", () =>
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
			},
		);
		const onShownChange = vi.fn<(shown: boolean) => void>();
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
					<FilesTreeColumn onShownChange={onShownChange}>
						<FilesTree sessionId={SESSION_ID} />
					</FilesTreeColumn>
				</SettingsProvider>
			</QueryClientProvider>,
		);

		fireEvent.keyDown(
			separator(),
			{
				key: "Enter",
			},
		);
		fireEvent.keyDown(
			separator(),
			{
				key: " ",
			},
		);

		expect(onShownChange.mock.calls).toStrictEqual([[false], [false]]);
	});

	it("restores a persisted width, clamped", async () =>
	{
		storage.setItem(FILES_TREE_WIDTH_STORAGE_KEY, "9000");
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
			},
		);
		renderTree();
		await waitFor(() =>
		{
			expect(separator().getAttribute("aria-valuenow")).toBe("640");
		});
	});
});

describe("FilesTreeColumn hide and edge handle", () =>
{
	function ShownHarness()
	{
		const [shown, setShown] = useState(true);
		return (
			<FilesTreeColumn shown={shown} onShownChange={setShown}>
				<FilesTree sessionId={SESSION_ID} />
			</FilesTreeColumn>
		);
	}

	function renderShown()
	{
		responses.set(
			key("", ""),
			{
				kind: "listing",
				dir: "",
				entries: [],
				partial: false,
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
					<ShownHarness />
				</SettingsProvider>
			</QueryClientProvider>,
		);
	}

	function separators(): HTMLElement[]
	{
		return screen.queryAllByRole(
			"separator",
			{
				name: "Resize file tree",
			},
		);
	}

	function treeColumn(): HTMLElement
	{
		const column = document.querySelector<HTMLElement>("[data-files-tree]");
		if (column === null) throw new Error("no tree column");
		return column;
	}

	it("(a) a click hides the tree and focuses upstream's 3px edge handle", () =>
	{
		renderShown();
		const [handle] = separators();
		handle?.focus();
		if (handle !== undefined)
		{
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
		}
		const edge = screen.getByRole(
			"separator",
			{
				name: "Resize file tree",
			},
		);

		expect(
			{
				hidden: treeColumn().hidden,
				count: separators().length,
				valuenow: edge.getAttribute("aria-valuenow"),
				valuemin: edge.getAttribute("aria-valuemin"),
				wrapper: edge.parentElement?.getAttribute("class"),
				wrapperFollowsColumn: edge.parentElement?.previousElementSibling === treeColumn(),
				classes: [...edge.classList].toSorted(),
				zIndex: edge.style.zIndex,
				ringOuter: edge.style.getPropertyValue("--cds-ring-outer"),
				focused: document.activeElement === edge,
			},
		).toStrictEqual(
			{
				hidden: true,
				count: 1,
				valuenow: "0",
				valuemin: "0",
				wrapper: "relative w-0 shrink-0",
				wrapperFollowsColumn: true,
				classes: [
					"cds-reset group/resize outline-none focus-visible:outline-hidden cursor-col-resize absolute inset-y-0",
					"w-[3px] [&>*]:pointer-events-none start-0 end-auto",
				]
					.join(" ")
					.split(" ")
					.toSorted(),
				zIndex: "5",
				ringOuter: "",
				focused: true,
			},
		);
	});

	it("(b) clicking the edge handle shows the tree and focuses the main handle", () =>
	{
		renderShown();
		fireEvent.keyDown(
			screen.getByRole(
				"separator",
				{
					name: "Resize file tree",
				},
			),
			{
				key: "Enter",
			},
		);
		const edge = screen.getByRole(
			"separator",
			{
				name: "Resize file tree",
			},
		);
		edge.focus();
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
		const handle = screen.getByRole(
			"separator",
			{
				name: "Resize file tree",
			},
		);

		expect(
			{
				hidden: treeColumn().hidden,
				count: separators().length,
				inColumn: treeColumn().contains(handle),
				focused: document.activeElement === handle,
			},
		).toStrictEqual(
			{
				hidden: false,
				count: 1,
				inColumn: true,
				focused: true,
			},
		);
	});

	it("(c) a drag of -170px hides the column live", () =>
	{
		renderShown();
		const [handle] = separators();
		if (handle !== undefined)
			fireEvent.pointerDown(
				handle,
				{
					button: 0,
					clientX: 300,
				},
			);
		fireEvent.pointerMove(
			document,
			{
				clientX: 130,
			},
		);
		const display = treeColumn().style.display;
		fireEvent.pointerUp(
			document,
			{
				clientX: 130,
			},
		);

		expect(
			{
				display,
				hiddenAfter: treeColumn().hidden,
			},
		).toStrictEqual(
			{
				display: "none",
				hiddenAfter: true,
			},
		);
	});

	it("(d) keeps the filter text across hide and show", () =>
	{
		renderShown();
		fireEvent.change(
			filterInput(),
			{
				target:
				{
					value: "src/",
				},
			},
		);
		fireEvent.keyDown(
			screen.getByRole(
				"separator",
				{
					name: "Resize file tree",
				},
			),
			{
				key: "Enter",
			},
		);
		fireEvent.keyDown(
			screen.getByRole(
				"separator",
				{
					name: "Resize file tree",
				},
			),
			{
				key: "Enter",
			},
		);

		expect(
			{
				hidden: treeColumn().hidden,
				filter: filterInput().value,
			},
		).toStrictEqual(
			{
				hidden: false,
				filter: "src/",
			},
		);
	});

	it("(e) mounts upstream's drag shield only while dragging", () =>
	{
		renderShown();
		const [handle] = separators();
		if (handle !== undefined)
			fireEvent.pointerDown(
				handle,
				{
					button: 0,
					clientX: 300,
				},
			);
		const during = document.querySelector("[data-file-tree-resize-shield]")?.parentElement === document.body;
		fireEvent.pointerUp(
			document,
			{
				clientX: 300,
			},
		);

		expect(
			{
				during,
				after: document.querySelector("[data-file-tree-resize-shield]"),
			},
		).toStrictEqual(
			{
				during: true,
				after: null,
			},
		);
	});
});
