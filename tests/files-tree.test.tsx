// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {
	FILES_TREE_WIDTH_STORAGE_KEY,
	FilesTree,
	FilesTreeColumn,
	clampFilesTreeWidth,
	goUpTarget,
	parseTreeQuery,
} from "../src/components/files/files-tree";
import {SettingsProvider} from "../src/components/settings-provider";
import type {SessionFilesResponse} from "../src/lib/api/session-files";
import {installLocalStorage} from "./fake-storage";

class FakeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

const SESSION_ID = "tree-session";

function file(relPath: string) {
	return {name: relPath.split("/").at(-1) ?? relPath, relPath, isDirectory: false};
}

function folder(relPath: string) {
	return {name: relPath.split("/").at(-1) ?? relPath, relPath, isDirectory: true};
}

/** Responses keyed by the request's `dir` and `q` parameters. */
let responses: Map<string, SessionFilesResponse>;
let requests: string[];

function key(dir: string, query: string): string {
	return `${dir}|${query}`;
}

function stubFetch(): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string) => {
			const url = new URL(input, "http://localhost");
			const dir = url.searchParams.get("dir") ?? "";
			const query = url.searchParams.get("q") ?? "";
			requests.push(key(dir, query));
			const body = responses.get(key(dir, query));
			if (body === undefined) return Response.json({error: "not found"}, {status: 404});
			return Response.json(body);
		}),
	);
}

function renderTree(onOpenFile = vi.fn()) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	render(
		<QueryClientProvider client={queryClient}>
			<SettingsProvider>
				<FilesTreeColumn>
					<FilesTree sessionId={SESSION_ID} onOpenFile={onOpenFile} />
				</FilesTreeColumn>
			</SettingsProvider>
		</QueryClientProvider>,
	);
	return onOpenFile;
}

function filterInput(): HTMLInputElement {
	return screen.getByRole("textbox", {name: "Filter files"}) as HTMLInputElement;
}

function rowNames(): string[] {
	return screen.queryAllByRole("treeitem").map((row) => row.querySelector("[data-tree-name]")?.textContent ?? "");
}

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
	storage = installLocalStorage();
	responses = new Map();
	requests = [];
	stubFetch();
	vi.stubGlobal("ResizeObserver", FakeObserver);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("parseTreeQuery", () => {
	it.each([
		["", {dir: "", search: ""}],
		["tst", {dir: "", search: "tst"}],
		["src/", {dir: "src", search: ""}],
		["src/components/", {dir: "src/components", search: ""}],
		["src/comp", {dir: "src", search: "comp"}],
		["  src/ ", {dir: "src", search: ""}],
	])("%j", (query, expected) => {
		expect(parseTreeQuery(query)).toStrictEqual(expected);
	});
});

describe("goUpTarget", () => {
	it.each([
		["src", {label: "Go up to project files", query: ""}],
		["src/components", {label: "Go up to src", query: "src/"}],
		["a/b/c", {label: "Go up to b", query: "a/b/"}],
	])("%s", (dir, expected) => {
		expect(goUpTarget(dir)).toStrictEqual(expected);
	});
});

describe("clampFilesTreeWidth", () => {
	it.each([
		[240, 240],
		[100, 160],
		[9999, 640],
		[Number.NaN, 240],
	])("%d → %d", (width, expected) => {
		expect(clampFilesTreeWidth(width)).toBe(expected);
	});
});

describe("FilesTree drill-in", () => {
	it("sets the query to the folder, lists it, and shows Go up", async () => {
		responses.set(key("", ""), {
			kind: "listing",
			dir: "",
			entries: [folder("src"), file("README.md")],
			partial: false,
		});
		responses.set(key("src", ""), {
			kind: "listing",
			dir: "src",
			entries: [folder("src/components"), file("src/main.ts")],
			partial: false,
		});
		responses.set(key("src/components", ""), {
			kind: "listing",
			dir: "src/components",
			entries: [file("src/components/app.tsx")],
			partial: false,
		});
		renderTree();

		await screen.findByText("README.md");
		const rootState = {
			rows: rowNames(),
			goUp: screen.queryByRole("button", {name: /^Go up/}),
		};

		fireEvent.click(screen.getByText("src"));
		await screen.findByText("main.ts");
		const srcState = {
			query: filterInput().value,
			rows: rowNames(),
			goUp: screen.getByRole("button", {name: /^Go up/}).textContent,
		};

		fireEvent.click(screen.getByText("components"));
		await screen.findByText("app.tsx");
		const componentsState = {
			query: filterInput().value,
			goUp: screen.getByRole("button", {name: /^Go up/}).textContent,
		};

		fireEvent.click(screen.getByRole("button", {name: "Go up to src"}));
		await screen.findByText("main.ts");
		const upState = {query: filterInput().value};

		fireEvent.click(screen.getByRole("button", {name: "Go up to project files"}));
		await screen.findByText("README.md");

		expect({
			rootState,
			srcState,
			componentsState,
			upState,
			finalQuery: filterInput().value,
			finalGoUp: screen.queryByRole("button", {name: /^Go up/}),
		}).toStrictEqual({
			rootState: {rows: ["src", "README.md"], goUp: null},
			srcState: {
				query: "src/",
				rows: ["components", "main.ts"],
				goUp: "Go up to project files",
			},
			componentsState: {query: "src/components/", goUp: "Go up to src"},
			upState: {query: "src/"},
			finalQuery: "",
			finalGoUp: null,
		});
	});

	it("Clear filter empties the query", async () => {
		responses.set(key("", ""), {
			kind: "listing",
			dir: "",
			entries: [folder("src")],
			partial: false,
		});
		responses.set(key("src", ""), {
			kind: "listing",
			dir: "src",
			entries: [file("src/main.ts")],
			partial: false,
		});
		renderTree();
		fireEvent.click(await screen.findByText("src"));
		await screen.findByText("main.ts");
		fireEvent.click(screen.getByRole("button", {name: "Clear filter"}));
		await screen.findByText("src");
		expect({
			query: filterInput().value,
			clear: screen.queryByRole("button", {name: "Clear filter"}),
		}).toStrictEqual({query: "", clear: null});
	});
});

describe("FilesTree footers and states", () => {
	it("shows the partial-listing footer", async () => {
		responses.set(key("", ""), {
			kind: "listing",
			dir: "",
			entries: [file("a.ts")],
			partial: true,
		});
		renderTree();
		expect(await screen.findByText("Some entries may not be listed. Keep typing to narrow.")).toBeTruthy();
	});

	it("shows the capped-results footer and dir suffixes for search results", async () => {
		responses.set(key("", ""), {kind: "listing", dir: "", entries: [], partial: false});
		responses.set(key("", "tst"), {
			kind: "search",
			dir: "",
			query: "tst",
			results: [file("tslib.js"), folder("test"), file("node_modules/tslib/test-games.js")],
			partial: false,
			capped: true,
		});
		renderTree();
		fireEvent.change(filterInput(), {target: {value: "tst"}});
		await screen.findByText("Only the first 3 results are shown. Keep typing to narrow.");
		expect({
			rows: screen
				.getAllByRole("treeitem")
				.map((row) => [
					row.querySelector("[data-tree-name]")?.textContent,
					row.querySelector("[data-tree-dir]")?.textContent ?? null,
				]),
			partialFooter: screen.queryByText("Some entries may not be listed. Keep typing to narrow."),
		}).toStrictEqual({
			rows: [
				["tslib.js", null],
				["test", null],
				["test-games.js", "node_modules/tslib"],
			],
			partialFooter: null,
		});
	});

	it("shows the partial footer for a search over a partial walk", async () => {
		responses.set(key("", ""), {kind: "listing", dir: "", entries: [], partial: false});
		responses.set(key("", "x"), {
			kind: "search",
			dir: "",
			query: "x",
			results: [file("x.ts")],
			partial: true,
			capped: false,
		});
		renderTree();
		fireEvent.change(filterInput(), {target: {value: "x"}});
		expect(await screen.findByText("Some entries may not be listed. Keep typing to narrow.")).toBeTruthy();
	});

	it("shows Folder is empty for an empty listing", async () => {
		responses.set(key("", ""), {kind: "listing", dir: "", entries: [], partial: false});
		renderTree();
		expect(await screen.findByText("Folder is empty")).toBeTruthy();
	});

	it("shows No matching files for an empty search", async () => {
		responses.set(key("", ""), {kind: "listing", dir: "", entries: [], partial: false});
		responses.set(key("", "zzz"), {
			kind: "search",
			dir: "",
			query: "zzz",
			results: [],
			partial: false,
			capped: false,
		});
		renderTree();
		fireEvent.change(filterInput(), {target: {value: "zzz"}});
		expect(await screen.findByText("No matching files")).toBeTruthy();
	});

	it("shows No working directory for this session", async () => {
		responses.set(key("", ""), {kind: "no-cwd"});
		renderTree();
		expect(await screen.findByText("No working directory for this session")).toBeTruthy();
	});

	it("shows an error when the folder cannot be read", async () => {
		renderTree();
		expect(await screen.findByText("Couldn’t read this folder.")).toBeTruthy();
	});
});

describe("FilesTree keyboard and pointer", () => {
	beforeEach(() => {
		responses.set(key("", ""), {
			kind: "listing",
			dir: "",
			entries: [file("a.ts"), file("b.ts")],
			partial: false,
		});
	});

	it("moves between the input and the rows with Down/Up", async () => {
		renderTree();
		await screen.findByText("b.ts");
		const input = filterInput();
		input.focus();
		fireEvent.keyDown(input, {key: "ArrowDown"});
		const first = document.activeElement?.querySelector("[data-tree-name]")?.textContent;
		fireEvent.keyDown(document.activeElement as Element, {key: "ArrowDown"});
		const second = document.activeElement?.querySelector("[data-tree-name]")?.textContent;
		fireEvent.keyDown(document.activeElement as Element, {key: "ArrowUp"});
		fireEvent.keyDown(document.activeElement as Element, {key: "ArrowUp"});
		expect({first, second, back: document.activeElement === input}).toStrictEqual({
			first: "a.ts",
			second: "b.ts",
			back: true,
		});
	});

	it("opens a file with Enter as a preview, and pins on double-click", async () => {
		const onOpenFile = renderTree();
		await screen.findByText("b.ts");
		const input = filterInput();
		input.focus();
		fireEvent.keyDown(input, {key: "ArrowDown"});
		fireEvent.keyDown(document.activeElement as Element, {key: "Enter"});
		fireEvent.click(screen.getByText("b.ts"));
		fireEvent.doubleClick(screen.getByText("b.ts"));
		expect(onOpenFile.mock.calls).toStrictEqual([
			["a.ts", {pin: false}],
			["b.ts", {pin: false}],
			["b.ts", {pin: true}],
		]);
	});
});

describe("FilesTree density", () => {
	it("draws 13px rows 21.33px tall with 16px icons, a full-width Go up row and upstream's filter", async () => {
		responses.set(key("", ""), {kind: "listing", dir: "", entries: [folder("src")], partial: false});
		responses.set(key("src", ""), {kind: "listing", dir: "src", entries: [file("src/main.ts")], partial: false});
		renderTree();
		fireEvent.click(await screen.findByText("src"));
		await screen.findByText("main.ts");

		const row = screen.getByRole("treeitem");
		const rowClasses = row.className.split(" ");
		const goUp = screen.getByRole("button", {name: "Go up to project files"});
		const goUpClasses = goUp.className.split(" ");
		const input = filterInput();
		const inputClasses = input.className.split(" ");
		expect({
			rowText: rowClasses.includes("text-pane"),
			rowHeight: rowClasses.includes("h-[21.33px]"),
			icon: row.querySelector("svg")?.getAttribute("class")?.split(" ").includes("size-4"),
			goUpFullWidth: goUpClasses.includes("w-full"),
			goUpText: goUpClasses.includes("text-pane"),
			goUpFill: goUpClasses.includes("bg-fill-control"),
			goUpFirstChild: goUp.firstElementChild?.getAttribute("class")?.split(" ").includes("lucide-arrow-up"),
			placeholder: input.placeholder,
			inputText: inputClasses.includes("text-pane"),
			inputFocusRing: inputClasses.includes(
				"focus:shadow-[0_0_0_1px_rgb(42,120,214),0_0_6px_1px_rgb(205,226,251)]",
			),
			clearSize: screen.getByRole("button", {name: "Clear filter"}).className.split(" ").includes("size-[18px]"),
		}).toStrictEqual({
			rowText: true,
			rowHeight: true,
			icon: true,
			goUpFullWidth: true,
			goUpText: true,
			goUpFill: true,
			goUpFirstChild: true,
			placeholder: "Search files…",
			inputText: true,
			inputFocusRing: true,
			clearSize: true,
		});
	});
});

describe("FilesTree virtualization", () => {
	it("renders only a window of a long listing", async () => {
		const entries = Array.from({length: 500}, (_, index) => file(`f${index}.ts`));
		responses.set(key("", ""), {kind: "listing", dir: "", entries, partial: false});
		renderTree();
		await screen.findByText("f0.ts");
		const rows = screen.getAllByRole("treeitem");
		expect({
			windowed: rows.length < 100,
			firstIndex: rows[0]?.getAttribute("data-row-index"),
		}).toStrictEqual({windowed: true, firstIndex: "0"});
	});
});

describe("FilesTreeColumn resize", () => {
	function separator(): HTMLElement {
		return screen.getByRole("separator", {name: "Resize file tree"});
	}

	it("defaults to 240 and clamps keyboard resizing to 160–640", async () => {
		responses.set(key("", ""), {kind: "listing", dir: "", entries: [], partial: false});
		renderTree();
		const initial = separator().getAttribute("aria-valuenow");
		fireEvent.keyDown(separator(), {key: "ArrowRight"});
		const stepped = separator().getAttribute("aria-valuenow");
		fireEvent.keyDown(separator(), {key: "End"});
		fireEvent.keyDown(separator(), {key: "ArrowRight"});
		const max = separator().getAttribute("aria-valuenow");
		fireEvent.keyDown(separator(), {key: "Home"});
		fireEvent.keyDown(separator(), {key: "ArrowLeft"});
		const min = separator().getAttribute("aria-valuenow");
		await waitFor(() => expect(storage.getItem(FILES_TREE_WIDTH_STORAGE_KEY)).toBe("160"));
		expect({initial, stepped, max, min}).toStrictEqual({
			initial: "240",
			stepped: "248",
			max: "640",
			min: "160",
		});
	});

	it("explains itself on hover: Hide file tree ⌃⇧Y, then Drag to resize", async () => {
		responses.set(key("", ""), {kind: "listing", dir: "", entries: [], partial: false});
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
		);
		renderTree();

		fireEvent.pointerEnter(separator());
		const tooltip = await waitFor(() => screen.getByRole("tooltip"));

		expect({
			lines: [...tooltip.children].map((line) => line.textContent),
			describedBy: separator().getAttribute("aria-describedby") === tooltip.id,
		}).toStrictEqual({lines: ["Hide file tree⌃Control⇧ShiftY", "Drag to resize"], describedBy: true});
	});

	it("hides the tree on a click that stays within the drag threshold, but not on a drag", () => {
		responses.set(key("", ""), {kind: "listing", dir: "", entries: [], partial: false});
		const onHide = vi.fn();
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
		render(
			<QueryClientProvider client={queryClient}>
				<SettingsProvider>
					<FilesTreeColumn onHide={onHide}>
						<FilesTree sessionId={SESSION_ID} />
					</FilesTreeColumn>
				</SettingsProvider>
			</QueryClientProvider>,
		);
		const handle = separator();
		const captured = new Set<number>();
		Object.assign(handle, {
			setPointerCapture: vi.fn((pointerId: number) => captured.add(pointerId)),
			releasePointerCapture: vi.fn((pointerId: number) => captured.delete(pointerId)),
			hasPointerCapture: vi.fn((pointerId: number) => captured.has(pointerId)),
		});

		fireEvent.pointerDown(handle, {clientX: 240, pointerId: 1});
		fireEvent.pointerMove(handle, {clientX: 280, pointerId: 1});
		fireEvent.pointerUp(handle, {clientX: 280, pointerId: 1});
		const afterDrag = onHide.mock.calls.length;
		fireEvent.pointerDown(handle, {clientX: 280, pointerId: 2});
		fireEvent.pointerUp(handle, {clientX: 281, pointerId: 2});

		expect({afterDrag, afterClick: onHide.mock.calls.length}).toStrictEqual({afterDrag: 0, afterClick: 1});
	});

	it("restores a persisted width, clamped", async () => {
		storage.setItem(FILES_TREE_WIDTH_STORAGE_KEY, "9000");
		responses.set(key("", ""), {kind: "listing", dir: "", entries: [], partial: false});
		renderTree();
		await waitFor(() => expect(separator().getAttribute("aria-valuenow")).toBe("640"));
	});
});
