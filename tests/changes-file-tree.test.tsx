// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {type ComponentType, type ReactNode, useState} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {FileTypeIconSetContext} from "../src/components/file-type-icon-set-context";
import {ChangedFilesSidebar} from "../src/components/changes/changes-file-tree";
import {DiffMarksContext} from "../src/components/changes/diff-marks-context";
import {type DiffMarkScope, fileMarkStatus, setFileMarked} from "../src/lib/diff-file-marks";
import {settingStorageKey} from "../src/components/settings-context";
import {SettingsProvider} from "../src/components/settings-provider";
import {RESIZE_GRIP_PILL, RESIZE_LINE_PILL, resizePillClass} from "../src/components/ui/resize-pill";
import {installLocalStorage} from "./fake-storage";
import {PanelsOff} from "./fizzy-lake-off";
import {stubColumnLayout} from "./helpers/column-layout";

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
	const result = render(
		<SettingsProvider>
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
			</FileTypeIconSetContext>
		</SettingsProvider>,
		wrapper === undefined ? {} : {wrapper},
	);
	return {...handlers, unmount: result.unmount};
}

function treeRows(): string[] {
	return within(screen.getByRole("tree", {name: "Changed files"}))
		.getAllByRole("treeitem")
		.map((row) => `${row.getAttribute("aria-level")} ${row.textContent}`);
}

let storage: ReturnType<typeof installLocalStorage>;
let restoreLayout: () => void;

beforeEach(() => {
	storage = installLocalStorage();
	restoreLayout = stubColumnLayout();
});

afterEach(() => {
	cleanup();
	restoreLayout();
	vi.unstubAllGlobals();
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
			zIndex: handle.style.zIndex,
			ring: handle.firstElementChild?.classList.contains("group-focus-visible/resize:shadow-focus"),
			pill: pill?.getAttribute("class"),
			tabIndex: handle.tabIndex,
		}).toStrictEqual({
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

	it("steps 32px with Shift+Arrow, and Enter resets to 240 when the list cannot hide", () => {
		renderSidebar();
		const handle = screen.getByRole("separator", {name: "Resize file list"});
		fireEvent.keyDown(handle, {key: "ArrowRight", shiftKey: true});
		const stepped = handle.getAttribute("aria-valuenow");
		fireEvent.keyDown(handle, {key: "Enter"});
		expect({stepped, reset: handle.getAttribute("aria-valuenow")}).toStrictEqual({stepped: "272", reset: "240"});
	});

	it("(c) persists the width across a remount", () => {
		const {unmount} = renderSidebar();
		const handle = screen.getByRole("separator", {name: "Resize file list"});
		fireEvent.keyDown(handle, {key: "ArrowRight"});
		fireEvent.keyDown(handle, {key: "ArrowRight"});
		unmount();
		renderSidebar();

		expect({
			stored: storage.getItem(settingStorageKey("diffTreeWidth")),
			width: screen.getByRole("separator", {name: "Resize file list"}).getAttribute("aria-valuenow"),
		}).toStrictEqual({stored: "256", width: "256"});
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

describe("ChangedFilesSidebar hide and edge handle", () => {
	function Harness({onShown}: {onShown: (shown: boolean) => void}) {
		const [shown, setShown] = useState(true);
		return (
			<SettingsProvider>
				<ChangedFilesSidebar
					files={FILES}
					groupByFolder
					groupByKind={false}
					activePath={null}
					commits={COMMITS}
					selectedCommitSha={null}
					onSelectFile={vi.fn<(path: string) => void>()}
					onSelectCommit={vi.fn<(sha: string | null) => void>()}
					onCopyCommitSha={vi.fn<(sha: string) => void>()}
					shown={shown}
					onShownChange={(next) => {
						onShown(next);
						setShown(next);
					}}
				/>
			</SettingsProvider>
		);
	}

	function list(): HTMLElement {
		const element = document.querySelector<HTMLElement>("[data-changed-files-list]");
		if (element === null) throw new Error("no file list");
		return element;
	}

	it("(a, b) a click hides the list and focuses the edge handle, whose click restores it", () => {
		const onShown = vi.fn<(shown: boolean) => void>();
		render(<Harness onShown={onShown} />);
		const handle = screen.getByRole("separator", {name: "Resize file list"});
		handle.focus();
		fireEvent.pointerDown(handle, {button: 0, clientX: 240});
		fireEvent.pointerUp(handle, {clientX: 240});
		const edge = screen.getByRole("separator", {name: "Resize file list"});
		const hidden = {
			list: list().hidden,
			focused: document.activeElement === edge,
			valuenow: edge.getAttribute("aria-valuenow"),
			wrapper: edge.parentElement?.getAttribute("class"),
			edgeWidth: edge.classList.contains("w-[3px]"),
		};
		fireEvent.pointerDown(edge, {button: 0, clientX: 0});
		fireEvent.pointerUp(edge, {clientX: 0});

		expect({
			hidden,
			shown: list().hidden,
			focused: document.activeElement === screen.getByRole("separator", {name: "Resize file list"}),
			calls: onShown.mock.calls,
		}).toStrictEqual({
			hidden: {list: true, focused: true, valuenow: "0", wrapper: "relative w-0 shrink-0", edgeWidth: true},
			shown: false,
			focused: true,
			calls: [[false], [true]],
		});
	});

	it("(d) a -170px drag hides the list live, behind upstream's drag shield", () => {
		render(<Harness onShown={vi.fn<(shown: boolean) => void>()} />);
		const handle = screen.getByRole("separator", {name: "Resize file list"});
		fireEvent.pointerDown(handle, {button: 0, clientX: 300});
		fireEvent.pointerMove(document, {clientX: 130});
		const during = {
			display: list().style.display,
			shield: document.querySelector("[data-file-tree-resize-shield]") !== null,
		};
		fireEvent.pointerUp(document, {clientX: 130});

		expect({
			during,
			hidden: list().hidden,
			shield: document.querySelector("[data-file-tree-resize-shield]"),
		}).toStrictEqual({during: {display: "none", shield: true}, hidden: true, shield: null});
	});
});

describe("ChangedFilesSidebar viewed marks (upstream Cc/Dc/Ec/Oc/Tc)", () => {
	const SCOPE: DiffMarkScope = {
		sessionId: "session-tree",
		repo: "/repo",
		diff: JSON.stringify(["branch", "main", null]),
	};
	const patchOf = (path: string) =>
		`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
	const PATCHES = new Map<string, string | null>([
		["src/app.ts", patchOf("src/app.ts")],
		["tests/app.test.ts", patchOf("tests/app.test.ts")],
		[".github/workflows/push.yml", null],
	]);

	function MarksWrapper({children}: {children: ReactNode}) {
		return <DiffMarksContext value={{scope: SCOPE, patches: PATCHES}}>{children}</DiffMarksContext>;
	}

	function row(name: RegExp): HTMLElement {
		return screen.getByRole("treeitem", {name});
	}

	function markSlot(element: HTMLElement): Element | null {
		return element.querySelector("[data-diff-tree-mark]");
	}

	it("swaps a markable row's icon for a hover check and toggles the mark from it without selecting", () => {
		const props = renderSidebar({}, MarksWrapper);
		const slot = markSlot(row(/^app\.ts/));
		const before = {
			slot: slot?.className,
			size: slot instanceof HTMLElement ? [slot.style.width, slot.style.height] : null,
			children: [...(slot?.children ?? [])].map((child) => [
				child.className,
				child.querySelector("svg")?.getAttribute("class"),
			]),
		};
		fireEvent.click(slot?.firstElementChild ?? row(/^app\.ts/));
		expect({
			before,
			status: fileMarkStatus(SCOPE, "src/app.ts", PATCHES.get("src/app.ts")),
			selected: props.onSelectFile.mock.calls,
		}).toStrictEqual({
			before: {
				slot: "group/mark grid shrink-0 place-items-center",
				size: ["12px", "12px"],
				children: [
					["contents group-hover/mark:hidden", "shrink-0 text-muted-control"],
					["hidden group-hover/mark:contents", expect.stringMatching(/ text-secondary$/)],
				],
			},
			status: "marked",
			selected: [],
		});
	});

	it("selects instead of toggling on a modified, touch, text-selected or off-icon click", () => {
		const props = renderSidebar({}, MarksWrapper);
		const icon = () => markSlot(row(/^app\.ts/))?.firstElementChild ?? row(/^app\.ts/);
		fireEvent.click(icon(), {metaKey: true});
		fireEvent.click(icon(), {ctrlKey: true});
		icon().dispatchEvent(new PointerEvent("click", {bubbles: true, pointerType: "touch"}));
		const label = row(/^app\.ts/).querySelector("span.truncate, span.min-w-0");
		const range = document.createRange();
		range.selectNodeContents(label ?? row(/^app\.ts/));
		window.getSelection()?.addRange(range);
		fireEvent.click(icon());
		window.getSelection()?.removeAllRanges();
		fireEvent.click(label ?? row(/^app\.ts/));
		expect({
			status: fileMarkStatus(SCOPE, "src/app.ts", PATCHES.get("src/app.ts")),
			selected: props.onSelectFile.mock.calls.length,
		}).toStrictEqual({status: "none", selected: 3});
	});

	it("shows a marked row's filled check, mutes its name unless active, and unmarks from the check", () => {
		setFileMarked(SCOPE, "src/app.ts", PATCHES.get("src/app.ts"), true);
		setFileMarked(SCOPE, "tests/app.test.ts", PATCHES.get("tests/app.test.ts"), true);
		renderSidebar({activePath: "tests/app.test.ts"}, MarksWrapper);
		const check = markSlot(row(/^app\.ts/));
		const inactiveName = row(/^app\.ts/).querySelector("span.flex-1")?.className;
		const activeName = row(/^app\.test\.ts/).querySelector("span.flex-1")?.className;
		const before = {
			check: [check?.tagName.toLowerCase(), check?.getAttribute("aria-label"), check?.getAttribute("class")],
			inactiveName,
			activeName,
			fileTypeIcon: row(/^app\.ts/).querySelector("[data-file-type-icon]"),
		};
		fireEvent.click(check ?? row(/^app\.ts/));
		expect({before, status: fileMarkStatus(SCOPE, "src/app.ts", PATCHES.get("src/app.ts"))}).toStrictEqual({
			before: {
				check: ["svg", "Viewed", "order-first shrink-0 text-secondary hover:text-primary"],
				inactiveName: "flex min-w-0 flex-1 items-baseline gap-1 text-muted-as-secondary",
				activeName: "flex min-w-0 flex-1 items-baseline gap-1",
				fileTypeIcon: null,
			},
			status: "none",
		});
	});

	it("shows a stale row's accent dot with a hover check, labelled Changed since you viewed it", () => {
		setFileMarked(SCOPE, "src/app.ts", PATCHES.get("src/app.ts")?.replace("+new", "+newer"), true);
		renderSidebar({}, MarksWrapper);
		const stale = markSlot(row(/^app\.ts/));
		expect({
			role: stale?.getAttribute("role"),
			label: stale?.getAttribute("aria-label"),
			className: stale?.className,
			children: [...(stale?.children ?? [])].map((child) => [
				child.getAttribute("data-cds"),
				child.getAttribute("class"),
			]),
		}).toStrictEqual({
			role: "img",
			label: "Changed since you viewed it",
			className: "group/mark order-first grid shrink-0 place-items-center",
			children: [
				["Pulse", expect.stringMatching(/ group-hover\/mark:hidden$/)],
				[null, "hidden group-hover/mark:contents"],
			],
		});
	});

	it("keeps the plain icon on a row whose patch can't be marked, and on every row without marks", () => {
		renderSidebar({}, MarksWrapper);
		const unmarkable = markSlot(row(/^push\.yml/));
		cleanup();
		renderSidebar();
		expect({unmarkable, withoutMarks: document.querySelector("[data-diff-tree-mark]")}).toStrictEqual({
			unmarkable: null,
			withoutMarks: null,
		});
	});
});
