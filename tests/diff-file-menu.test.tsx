// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {type ComponentProps} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {DiffFileMenuItems} from "../src/components/changes/diff-file-menu";
import type {DiffFileMark} from "../src/components/changes/diff-file-menu-gate";
import {OpenInSubmenu, ShowInFinderItem} from "../src/components/files/file-actions-menu";
import {ToastProvider} from "../src/components/toast";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuSeparator} from "../src/components/ui/menu";
import {writeClipboardText} from "../src/lib/clipboard";

vi.mock("../src/lib/clipboard", () => (
{
	writeClipboardText: vi.fn<typeof writeClipboardText>(async () => Promise.resolve(true)),
}));

const PATH = "src/a.ts";
const ABSOLUTE = "/repo/src/a.ts";

type Props = ComponentProps<typeof DiffFileMenuItems>;

function renderFileMenuItems({separatorBefore}: {separatorBefore: boolean})
{
	return (
		<>
			{separatorBefore && <MenuSeparator />}
			<OpenInSubmenu path={ABSOLUTE} />
			<ShowInFinderItem path={ABSOLUTE} />
		</>
	);
}

function renderMenu(props: Partial<Props>): void
{
	render(
		<ToastProvider>
			<ContextMenu>
				<ContextMenuTrigger>target</ContextMenuTrigger>
				<MenuContent>
					<DiffFileMenuItems path={PATH} {...props} />
				</MenuContent>
			</ContextMenu>
		</ToastProvider>,
	);
	fireEvent.contextMenu(
		screen.getByText("target"),
		{
			clientX: 10,
			clientY: 10,
		},
	);
}

const ALL_PROPS: Partial<Props> =
{
	absolutePath: ABSOLUTE,
	onAttachFile: () =>
	{
	},
	onOpenFile: () =>
	{
	},
	wholeFile: "folded",
	onShowWholeFile: () =>
	{
	},
	renderFileMenuItems,
};

/** The newest open menu's rows, top to bottom: item labels, with "─" for separators. */
function menuRows(): string[]
{
	const menu = screen.getAllByRole("menu").at(-1);
	if (menu === undefined) throw new Error("no menu open");
	return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
		row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? row.textContent),
	);
}

function item(label: string): HTMLElement
{
	const found = screen.getAllByRole("menuitem").find((row) => row.firstElementChild?.textContent === label);
	if (found === undefined) throw new Error(`no item ${label}`);
	return found;
}

async function openedRows(): Promise<string[]>
{
	return waitFor(() => menuRows());
}

async function submenuRows(label: string): Promise<string[]>
{
	await openedRows();
	fireEvent.click(item(label));
	return waitFor(() =>
	{
		const rows = menuRows();
		if (rows.includes(label)) throw new Error(`${label} ▸ not open`);
		return rows;
	});
}

/** The row's disabled state and its reason text (from aria-describedby). */
function disabledState(label: string):
{
	disabled: string | null;
	reason: string | null;
}
{
	const row = item(label);
	const reasonId = row.getAttribute("aria-describedby");
	return {
		disabled: row.getAttribute("aria-disabled"),
		reason: reasonId === null ? null : (document.getElementById(reasonId)?.textContent ?? null),
	};
}

beforeEach(() =>
{
	vi.mocked(writeClipboardText).mockClear();
});

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

describe("DiffFileMenuItems (upstream c44d00c7f ac/oc)", () =>
{
	it("all props: Attach · Copy ▸ · ─ · [Show whole file] · ─ · Open file · Open in ▸ · Show in Finder", async () =>
	{
		renderMenu(ALL_PROPS);
		const rows = await openedRows();
		const grouped = [...screen.getByRole("group").querySelectorAll('[role="menuitem"]')].map(
			(row) => row.firstElementChild?.textContent,
		);

		expect(
			{
				rows,
				grouped,
			},
		).toStrictEqual(
			{
				rows: [
					"Attach as context",
					"Copy",
					"─",
					"Show whole file",
					"─",
					"Open file",
					"Open in",
					"Show in Finder",
				],
				grouped: ["Show whole file"],
			},
		);
	});

	it("passes separatorBefore true only when there is no Open file row", async () =>
	{
		const renderItems = vi.fn<NonNullable<Props["renderFileMenuItems"]>>(renderFileMenuItems);
		renderMenu(
			{
				...ALL_PROPS,
				wholeFile: undefined,
				onOpenFile: undefined,
				renderFileMenuItems: renderItems,
			},
		);
		const withoutOpen = await openedRows();
		const withoutOpenCalls = renderItems.mock.calls.map(([options]) => options);
		cleanup();
		renderItems.mockClear();
		renderMenu(
			{
				...ALL_PROPS,
				wholeFile: undefined,
				renderFileMenuItems: renderItems,
				isDirectory: false,
			},
		);
		await openedRows();

		expect(
			{
				withoutOpen,
				withoutOpenCalls: [...new Set(withoutOpenCalls.map((options) => JSON.stringify(options)))],
				withOpenCalls: [...new Set(renderItems.mock.calls.map(([options]) => JSON.stringify(options)))],
			},
		).toStrictEqual(
			{
				withoutOpen: ["Attach as context", "Copy", "─", "Open in", "Show in Finder"],
				withoutOpenCalls: [
					JSON.stringify(
						{
							separatorBefore: true,
							isDirectory: false,
						},
					),
				],
				withOpenCalls: [
					JSON.stringify(
						{
							separatorBefore: false,
							isDirectory: false,
						},
					),
				],
			},
		);
	});

	it("without onAttachFile or wholeFile: Copy leads and no group sits before Open file", async () =>
	{
		renderMenu(
			{
				...ALL_PROPS,
				onAttachFile: undefined,
				wholeFile: undefined,
			},
		);

		expect(await openedRows()).toStrictEqual(["Copy", "─", "Open file", "Open in", "Show in Finder"]);
	});

	it("Copy ▸ offers Absolute path only when it resolves, and Relative path copies the diff path verbatim", async () =>
	{
		renderMenu(ALL_PROPS);
		const withAbsolute = await submenuRows("Copy");
		fireEvent.click(item("Relative path"));
		cleanup();
		renderMenu(
			{
				...ALL_PROPS,
				absolutePath: undefined,
			},
		);
		const withoutAbsolute = await submenuRows("Copy");
		fireEvent.click(item("Relative path"));

		expect(
			{
				withAbsolute,
				withoutAbsolute,
				copied: vi.mocked(writeClipboardText).mock.calls,
			},
		).toStrictEqual(
			{
				withAbsolute: ["Absolute path", "Relative path", "Filename"],
				withoutAbsolute: ["Relative path", "Filename"],
				copied: [[PATH], [PATH]],
			},
		);
	});

	it("labels the whole-file row by state", async () =>
	{
		const labels: Record<string, string | undefined> = {};
		for (const state of ["folded", "unread", "shown", "locked"] as const)
		{
			renderMenu(
				{
					...ALL_PROPS,
					wholeFile: state,
				},
			);
			await openedRows();
			labels[state] = screen
				.getByRole("group")
				.querySelector('[role="menuitem"]')?.firstElementChild?.textContent;
			cleanup();
		}

		expect(labels).toStrictEqual(
			{
				folded: "Show whole file",
				unread: "Show whole file",
				shown: "Show changes only",
				locked: "Show changes only",
			},
		);
	});

	it("disables unread and locked rows with upstream's reasons", async () =>
	{
		renderMenu(
			{
				...ALL_PROPS,
				wholeFile: "unread",
			},
		);
		await openedRows();
		const unreadCanOpen = disabledState("Show whole file");
		cleanup();
		renderMenu(
			{
				...ALL_PROPS,
				wholeFile: "unread",
				onOpenFile: undefined,
			},
		);
		await openedRows();
		const unread = disabledState("Show whole file");
		cleanup();
		renderMenu(
			{
				...ALL_PROPS,
				wholeFile: "locked",
			},
		);
		await openedRows();
		const locked = disabledState("Show changes only");

		expect(
			{
				unreadCanOpen,
				unread,
				locked,
			},
		).toStrictEqual(
			{
				unreadCanOpen:
				{
					disabled: "true",
					reason: "This file’s unmodified lines couldn’t be read. Open the file to see all of it.",
				},
				unread:
				{
					disabled: "true",
					reason: "This file’s unmodified lines couldn’t be read.",
				},
				locked:
				{
					disabled: "true",
					reason: "This file has a review finding, or a comment on an unmodified line. Dismiss the finding or delete the comment to show changes only.",
				},
			},
		);
	});

	it("folded shows the whole file and shown goes back to changes only", async () =>
	{
		const onShowWholeFile = vi.fn<NonNullable<Props["onShowWholeFile"]>>();
		renderMenu(
			{
				...ALL_PROPS,
				wholeFile: "folded",
				onShowWholeFile,
			},
		);
		await openedRows();
		fireEvent.click(item("Show whole file"));
		cleanup();
		renderMenu(
			{
				...ALL_PROPS,
				wholeFile: "shown",
				onShowWholeFile,
			},
		);
		await openedRows();
		fireEvent.click(item("Show changes only"));

		expect(onShowWholeFile.mock.calls).toStrictEqual([
			[PATH, true],
			[PATH, false],
		]);
	});

	it("labels the mark row by status, toggles it, and disables it when the file can't be marked", async () =>
	{
		const setMarked = vi.fn<DiffFileMark["setMarked"]>();
		const labels: Record<string, string | undefined> = {};
		for (const status of ["marked", "stale", "none"] as const)
		{
			renderMenu(
				{
					...ALL_PROPS,
					wholeFile: undefined,
					mark:
					{
						status,
						canMark: true,
						setMarked,
					},
				},
			);
			await openedRows();
			const row = screen.getByRole("group").querySelector<HTMLElement>('[role="menuitem"]');
			labels[status] = row?.firstElementChild?.textContent ?? undefined;
			if (row !== null) fireEvent.click(row);
			cleanup();
		}
		renderMenu(
			{
				...ALL_PROPS,
				mark:
				{
					status: "none",
					canMark: false,
					setMarked,
				},
			},
		);
		await openedRows();
		const grouped = [...screen.getByRole("group").querySelectorAll('[role="menuitem"]')].map(
			(row) => row.firstElementChild?.textContent,
		);
		const cannotMark = disabledState("Mark as viewed");

		expect(
			{
				labels,
				calls: setMarked.mock.calls,
				grouped,
				cannotMark,
			},
		).toStrictEqual(
			{
				labels:
				{
					marked: "Mark as not viewed",
					stale: "Mark as viewed",
					none: "Mark as viewed",
				},
				calls: [[false], [true], [true]],
				grouped: ["Show whole file", "Mark as viewed"],
				cannotMark:
				{
					disabled: "true",
					reason: "This file can’t be marked as viewed. Later changes to it wouldn’t be detected.",
				},
			},
		);
	});

	it("shows the cmd+enter keycap on Open file only when given the shortcut", async () =>
	{
		renderMenu(ALL_PROPS);
		await openedRows();
		const without = item("Open file").getAttribute("aria-keyshortcuts");
		cleanup();
		renderMenu(
			{
				...ALL_PROPS,
				openFileShortcut: "cmd+enter",
			},
		);
		await openedRows();

		// jsdom isn't a Mac, so cmd renders as Control.
		expect(
			{
				without,
				with: item("Open file").getAttribute("aria-keyshortcuts"),
			},
		).toStrictEqual(
			{
				without: null,
				with: "Control+Enter",
			},
		);
	});
});
