// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import type {ComponentType, ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {FileTypeIconSetContext} from "../src/components/file-type-icon-set-context";
import {ChangedFilesSidebar} from "../src/components/changes/changes-file-tree";
import {RESIZE_GRIP_PILL, RESIZE_LINE_PILL, resizePillClass} from "../src/components/ui/resize-pill";
import {PanelsOff} from "./fizzy-lake-off";

const FILES = [
	{path: ".github/workflows/push.yml", additions: 3, deletions: 1},
	{path: "src/app.ts", additions: 158, deletions: 0},
	{path: "tests/app.test.ts", additions: 0, deletions: 21},
];

const COMMITS = [
	{
		sha: "07bc05d1111111111111111111111111111111111",
		shortSha: "07bc05d",
		subject: "Fetch logs from both servers",
		author: "Craig P. Motlin",
		date: "2026-09-14T20:29:26.000Z",
	},
];

type SidebarOverrides = Partial<
	Omit<Parameters<typeof ChangedFilesSidebar>[0], "onSelectFile" | "onSelectCommit" | "onCopyCommitSha">
>;

function renderSidebar(overrides: SidebarOverrides = {}, wrapper?: ComponentType<{children: ReactNode}>) {
	const handlers = {
		onSelectFile: vi.fn<(path: string) => void>(),
		onSelectCommit: vi.fn<(sha: string | null) => void>(),
		onCopyCommitSha: vi.fn<(sha: string) => void>(),
	};
	render(
		<FileTypeIconSetContext value="pierre">
			<ChangedFilesSidebar
				files={FILES}
				groupByFolder
				groupByKind={false}
				activePath={null}
				commits={COMMITS}
				selectedCommitSha={null}
				{...handlers}
				{...overrides}
			/>
		</FileTypeIconSetContext>,
		wrapper === undefined ? {} : {wrapper},
	);
	return handlers;
}

function treeRows(): string[] {
	return within(screen.getByRole("tree", {name: "Changed files"}))
		.getAllByRole("treeitem")
		.map((row) => `${row.getAttribute("aria-level")} ${row.textContent}`);
}

afterEach(() => {
	cleanup();
});

function fileIcon(element: Element | null | undefined) {
	const svg = element?.querySelector("svg");
	return {
		fileTypeIcon: svg?.hasAttribute("data-file-type-icon") ?? false,
		width: svg?.style.width,
		className: svg?.getAttribute("class"),
		fill: svg?.querySelector("path")?.getAttribute("fill"),
	};
}

describe("ChangedFilesSidebar", () => {
	it("renders compacted directories and ± counts with no status letters", () => {
		renderSidebar();

		expect(treeRows()).toEqual([
			"1 .github/workflows",
			"2 push.yml+3−1",
			"1 src",
			"2 app.ts+158−0",
			"1 tests",
			"2 app.test.ts+0−21",
		]);
	});

	it("collapses a directory when its row is clicked", () => {
		renderSidebar();

		const dir = screen.getByRole("treeitem", {name: /^\.github\/workflows/});
		fireEvent.click(dir);

		expect({expanded: dir.getAttribute("aria-expanded"), rows: treeRows()}).toEqual({
			expanded: "false",
			rows: ["1 .github/workflows", "1 src", "2 app.ts+158−0", "1 tests", "2 app.test.ts+0−21"],
		});
	});

	it("renders trailing kind sections when separating test, build, and generated files", () => {
		renderSidebar({groupByFolder: false});
		expect(screen.queryByText("Test files")).toBeNull();
		cleanup();

		renderSidebar({groupByFolder: false, groupByKind: true});
		const tree = screen.getByRole("tree", {name: "Changed files"});
		expect(
			[...tree.querySelectorAll("[data-diff-tree-section-label], [data-diff-tree-row]")].map(
				(element) => element.textContent,
			),
		).toEqual([
			"app.tssrc+158−0",
			"Test files",
			"app.test.tstests+0−21",
			"Build files",
			"push.yml.github/workflows+3−1",
		]);
	});

	it("draws upstream's 12px file-type icon on file rows and none on folder rows", () => {
		renderSidebar();

		expect({
			file: fileIcon(screen.getByRole("treeitem", {name: /^app\.ts/})),
			folder: screen.getByRole("treeitem", {name: /^src$/}).querySelector("[data-file-type-icon]"),
		}).toStrictEqual({
			file: {
				fileTypeIcon: true,
				width: "12px",
				className: "shrink-0 text-muted-control",
				fill: "var(--fti-typescript)",
			},
			folder: null,
		});
	});

	it("marks the active file with aria-current and selects files on click", () => {
		const props = renderSidebar({activePath: "src/app.ts"});

		const current = screen
			.getAllByRole("treeitem")
			.filter((row) => row.getAttribute("aria-current") === "true")
			.map((row) => row.textContent);
		fireEvent.click(screen.getByRole("treeitem", {name: /^push\.yml/}));
		fireEvent.click(screen.getByRole("treeitem", {name: /^app\.test\.ts/}), {metaKey: true});

		expect({
			current,
			selected: props.onSelectFile.mock.calls,
		}).toEqual({current: ["app.ts+158−0"], selected: [[".github/workflows/push.yml"]]});
	});

	it("opens instead of jumping on Cmd/Ctrl+click when an open handler is given", () => {
		const onOpenFile = vi.fn<(path: string) => void>();
		const props = renderSidebar({onOpenFile});

		fireEvent.click(screen.getByRole("treeitem", {name: /^app\.test\.ts/}), {ctrlKey: true});

		expect({opened: onOpenFile.mock.calls, selected: props.onSelectFile.mock.calls}).toEqual({
			opened: [["tests/app.test.ts"]],
			selected: [],
		});
	});

	it("is upstream's cds ResizeHandle on the file list's border, half-clipped at rest, with the panels line pill", () => {
		renderSidebar();
		const handle = screen.getByRole("separator", {name: "Resize file list"});
		const pill = handle.querySelector("[data-cds-part=resize-pill]");

		expect({
			cds: handle.dataset["cds"],
			classes: [...handle.classList].toSorted(),
			ringOuter: handle.style.getPropertyValue("--cds-ring-outer"),
			ring: handle.firstElementChild?.classList.contains("group-focus-visible/resize:shadow-focus"),
			pill: pill?.getAttribute("class"),
			tabIndex: handle.tabIndex,
		}).toStrictEqual({
			cds: "ResizeHandle",
			classes: [
				"cds-reset group/resize outline-none focus-visible:outline-hidden w-3 cursor-col-resize absolute z-10",
				"inset-y-0 end-[calc(-6px_-_(var(--cds-ring-outer,0px)_-_var(--cds-ring-inner,0px))_/_2)]",
				"[clip-path:inset(0_0_0_37.5%)] [&:where(:root[dir=rtl]_:dir(rtl))]:[clip-path:inset(0_37.5%_0_0)] focus-visible:[clip-path:none]",
			]
				.join(" ")
				.split(" ")
				.toSorted(),
			ringOuter: "1px",
			ring: true,
			pill: resizePillClass(RESIZE_LINE_PILL, "vertical", false),
			tabIndex: 0,
		});
	});

	it("uses upstream's grip pill on the file list resize handle when panels is off", () => {
		renderSidebar({}, PanelsOff);
		const pill = screen
			.getByRole("separator", {name: "Resize file list"})
			.querySelector("[data-cds-part=resize-pill]");

		expect(pill?.getAttribute("class")).toBe(resizePillClass(RESIZE_GRIP_PILL, "vertical", false));
	});

	it("marks the file list handle data-dragging while a drag runs", () => {
		renderSidebar();
		const handle = screen.getByRole("separator", {name: "Resize file list"});

		fireEvent.pointerDown(handle, {clientX: 240, pointerId: 1});
		const during = handle.dataset["dragging"];
		fireEvent.pointerMove(handle, {clientX: 280, pointerId: 1});
		fireEvent.pointerUp(handle, {clientX: 280, pointerId: 1});

		expect({during, after: handle.dataset["dragging"], width: handle.getAttribute("aria-valuenow")}).toStrictEqual({
			during: "",
			after: undefined,
			width: "280",
		});
	});

	it("steps 32px with Shift+Arrow and does nothing on Enter", () => {
		renderSidebar();
		const handle = screen.getByRole("separator", {name: "Resize file list"});
		fireEvent.keyDown(handle, {key: "ArrowRight", shiftKey: true});
		fireEvent.keyDown(handle, {key: "Enter"});
		expect(handle.getAttribute("aria-valuenow")).toBe("272");
	});

	it("resizes the file list with the keyboard between 160 and 640 pixels", () => {
		renderSidebar();
		const handle = screen.getByRole("separator", {name: "Resize file list"});
		const widths: Array<string | null> = [handle.getAttribute("aria-valuenow")];

		fireEvent.keyDown(handle, {key: "ArrowRight"});
		widths.push(handle.getAttribute("aria-valuenow"));
		fireEvent.keyDown(handle, {key: "End"});
		widths.push(handle.getAttribute("aria-valuenow"));
		fireEvent.keyDown(handle, {key: "ArrowRight"});
		widths.push(handle.getAttribute("aria-valuenow"));
		fireEvent.keyDown(handle, {key: "Home"});
		widths.push(handle.getAttribute("aria-valuenow"));
		fireEvent.keyDown(handle, {key: "ArrowLeft"});
		widths.push(handle.getAttribute("aria-valuenow"));

		expect({
			widths,
			min: handle.getAttribute("aria-valuemin"),
			max: handle.getAttribute("aria-valuemax"),
			style: handle.parentElement?.style.width,
		}).toEqual({
			widths: ["240", "248", "640", "640", "160", "160"],
			min: "160",
			max: "640",
			style: "160px",
		});
	});

	it("lists All changes and each commit, selecting and copying commits", () => {
		const props = renderSidebar();
		const toolbar = screen.getByRole("toolbar", {name: "Commits"});
		const rows = within(toolbar)
			.getAllByRole("button")
			.map((button) => [
				button.getAttribute("aria-label") ?? button.textContent,
				button.getAttribute("aria-pressed"),
			]);

		fireEvent.click(within(toolbar).getByRole("button", {name: /^Fetch logs/}));
		fireEvent.click(within(toolbar).getByRole("button", {name: "Copy commit SHA"}));
		fireEvent.click(within(toolbar).getByRole("button", {name: "All changes"}));

		expect({
			rows: rows.map(([label, pressed]) => [label?.replace(/·[^·]*ago$/, "· <time>"), pressed]),
			selected: props.onSelectCommit.mock.calls,
			copied: props.onCopyCommitSha.mock.calls,
			time: toolbar.querySelector("time")?.getAttribute("datetime"),
		}).toEqual({
			rows: [
				["All changes", "true"],
				["Fetch logs from both servers07bc05d·Craig P. Motlin· <time>", "false"],
				["Copy commit SHA", null],
			],
			selected: [["07bc05d1111111111111111111111111111111111"], [null]],
			copied: [["07bc05d1111111111111111111111111111111111"]],
			time: "2026-09-14T20:29:26.000Z",
		});
	});

	it("presses the selected commit and hides the commit list when there are no commits", () => {
		renderSidebar({selectedCommitSha: COMMITS[0]?.sha ?? null});
		const pressed = within(screen.getByRole("toolbar", {name: "Commits"}))
			.getAllByRole("button", {pressed: true})
			.map((button) => button.textContent.slice(0, 10));
		cleanup();

		renderSidebar({commits: []});

		expect({pressed, toolbar: screen.queryByRole("toolbar", {name: "Commits"})}).toEqual({
			pressed: ["Fetch logs"],
			toolbar: null,
		});
	});
});
