// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {type ComponentProps} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {FileActionsMenuItems, isEditableText} from "../src/components/files/file-actions-menu";
import {ToastProvider} from "../src/components/toast";
import {ContextMenu, ContextMenuTrigger, MenuContent} from "../src/components/ui/menu";
import {writeClipboardText} from "../src/lib/clipboard";
import type {AttachContextHandler} from "../src/lib/context-attach";

vi.mock("../src/lib/clipboard", () => ({
	writeClipboardText: vi.fn<typeof writeClipboardText>(async () => Promise.resolve(true)),
}));

const CWD = "/home/alice/project";

type Props = ComponentProps<typeof FileActionsMenuItems>;

function renderMenu(props: Partial<Props> & {path: string}): void {
	render(
		<ToastProvider>
			<ContextMenu>
				<ContextMenuTrigger>target</ContextMenuTrigger>
				<MenuContent>
					<FileActionsMenuItems
						cwd={CWD}
						surface="transcript"
						onOpenInFilesPane={vi.fn<() => void>()}
						onOpenInDefaultApp={vi.fn<() => void>()}
						{...props}
					/>
				</MenuContent>
			</ContextMenu>
		</ToastProvider>,
	);
	fireEvent.contextMenu(screen.getByText("target"), {clientX: 10, clientY: 10});
}

/** The newest open menu's rows, top to bottom: item labels, with "─" for separators. */
function menuRows(): string[] {
	const menu = screen.getAllByRole("menu").at(-1);
	if (menu === undefined) throw new Error("no menu open");
	return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
		row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? row.textContent),
	);
}

function item(label: string): HTMLElement {
	const found = screen.getAllByRole("menuitem").find((row) => row.firstElementChild?.textContent === label);
	if (found === undefined) throw new Error(`no item ${label}`);
	return found;
}

async function openedRows(): Promise<string[]> {
	return waitFor(() => menuRows());
}

async function submenuRows(label: string): Promise<string[]> {
	await openedRows();
	fireEvent.click(item(label));
	return waitFor(() => {
		const rows = menuRows();
		if (rows.includes(label)) throw new Error(`${label} ▸ not open`);
		return rows;
	});
}

beforeEach(() => {
	vi.mocked(writeClipboardText).mockClear();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Promise.resolve(Response.json({ok: true}))),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("isEditableText (upstream p3)", () => {
	it.each([
		["src/a.ts", true],
		["README.md", true],
		["Makefile", true],
		["icon.svg", true],
		["docs/x.pdf", false],
		["photo.PNG", false],
		["pic.avif", false],
		["archive.tar", false],
		["lib.so.1.2", false],
		["clip.mp4", false],
	])("%s → %s", (path, expected) => {
		expect(isEditableText(path)).toBe(expected);
	});
});

describe("FileActionsMenuItems", () => {
	it("a file inside the cwd: Attach · Copy ▸ · ─ · Open in ▸ · Show in Finder", async () => {
		renderMenu({path: `${CWD}/src/a.ts`, onAttachContext: vi.fn<AttachContextHandler>()});
		const rows = await openedRows();
		const copyRows = await submenuRows("Copy");
		cleanup();
		renderMenu({path: `${CWD}/src/a.ts`, onAttachContext: vi.fn<AttachContextHandler>()});
		const openInRows = await submenuRows("Open in");

		expect({rows, copyRows, openInRows}).toStrictEqual({
			rows: ["Attach as context", "Copy", "─", "Open in", "Show in Finder"],
			copyRows: ["Absolute path", "Relative path", "Filename"],
			openInRows: ["VS Code", "─", "Default app"],
		});
	});

	it("a file outside the cwd hides Relative path and attaches the absolute path", async () => {
		const onAttachContext = vi.fn<AttachContextHandler>();
		renderMenu({path: "/etc/hosts", onAttachContext});
		const copyRows = await submenuRows("Copy");
		cleanup();
		renderMenu({path: "/etc/hosts", onAttachContext});
		await openedRows();
		fireEvent.click(item("Attach as context"));

		expect({copyRows, attached: onAttachContext.mock.calls}).toStrictEqual({
			copyRows: ["Absolute path", "Filename"],
			attached: [[{kind: "file", path: "/etc/hosts"}]],
		});
	});

	it("a pdf in the transcript opens in the Files pane or the default app, not VS Code", async () => {
		renderMenu({path: `${CWD}/docs/x.pdf`});

		expect(await submenuRows("Open in")).toStrictEqual(["Files pane", "Default app"]);
	});

	it("a directory opens in VS Code only and attaches with a trailing slash", async () => {
		const onAttachContext = vi.fn<AttachContextHandler>();
		renderMenu({path: `${CWD}/src`, isDirectory: true, onAttachContext});
		const openInRows = await submenuRows("Open in");
		cleanup();
		renderMenu({path: `${CWD}/src`, isDirectory: true, onAttachContext});
		await openedRows();
		fireEvent.click(item("Attach as context"));

		expect({openInRows, attached: onAttachContext.mock.calls}).toStrictEqual({
			openInRows: ["VS Code"],
			attached: [[{kind: "file", path: "src/"}]],
		});
	});

	it("outside the transcript there is no Files pane or Default app", async () => {
		renderMenu({path: `${CWD}/docs/x.pdf`, surface: "file_browser"});

		expect(await openedRows()).toStrictEqual(["Copy", "─", "Show in Finder"]);
	});

	it("attach: false drops Attach as context", async () => {
		renderMenu({path: `${CWD}/src/a.ts`, attach: false, onAttachContext: vi.fn<AttachContextHandler>()});

		expect(await openedRows()).toStrictEqual(["Copy", "─", "Open in", "Show in Finder"]);
	});

	it("gone hides Open in ▸ and Show in Finder", async () => {
		renderMenu({path: `${CWD}/src/a.ts`, gone: true, onAttachContext: vi.fn<AttachContextHandler>()});

		expect(await openedRows()).toStrictEqual(["Attach as context", "Copy"]);
	});

	it("separatorBefore leads with a separator", async () => {
		renderMenu({path: `${CWD}/src/a.ts`, separatorBefore: true, gone: true});

		expect(await openedRows()).toStrictEqual(["─", "Copy"]);
	});

	it("every Copy row toasts upstream's one message", async () => {
		renderMenu({path: `${CWD}/src/a.ts`});
		await submenuRows("Copy");
		fireEvent.click(item("Relative path"));
		const toast = await screen.findByText("Copied to clipboard.");

		expect({copied: vi.mocked(writeClipboardText).mock.calls, toast: toast.textContent}).toStrictEqual({
			copied: [["src/a.ts"]],
			toast: "Copied to clipboard.",
		});
	});

	it("Default app and Files pane call their handlers", async () => {
		const onOpenInDefaultApp = vi.fn<() => void>();
		const onOpenInFilesPane = vi.fn<() => void>();
		renderMenu({path: `${CWD}/docs/x.pdf`, onOpenInDefaultApp, onOpenInFilesPane});
		await submenuRows("Open in");
		fireEvent.click(item("Default app"));
		cleanup();
		renderMenu({path: `${CWD}/docs/x.pdf`, onOpenInDefaultApp, onOpenInFilesPane});
		await submenuRows("Open in");
		fireEvent.click(item("Files pane"));

		expect({
			defaultApp: onOpenInDefaultApp.mock.calls.length,
			filesPane: onOpenInFilesPane.mock.calls.length,
		}).toStrictEqual({defaultApp: 1, filesPane: 1});
	});

	it("Show in Finder reveals the path", async () => {
		renderMenu({path: `${CWD}/src/a.ts`});
		await openedRows();
		fireEvent.click(item("Show in Finder"));

		await waitFor(() => {
			expect(vi.mocked(fetch).mock.calls).toStrictEqual([
				[
					"/api/reveal-in-finder",
					{
						credentials: "same-origin",
						method: "POST",
						headers: {"Content-Type": "application/json"},
						body: JSON.stringify({path: `${CWD}/src/a.ts`}),
					},
				],
			]);
		});
	});
});
