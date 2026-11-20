// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ChangesPaneView} from "../src/components/changes/changes-pane";
import {FilesPaneView} from "../src/components/panes/files-pane";
import {TileHost} from "../src/components/panes/tile-host";
import {SettingsProvider} from "../src/components/settings-provider";
import type {SessionDiffFile, SessionDiffResponse, SessionDiffScopesResponse} from "../src/lib/api/session-diff";
import {installLocalStorage} from "./fake-storage";

const GREET_PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,4 @@
 export function greet(name: string) {
-  return "hi " + name;
+  const greeting = "hello";
+  return greeting + " " + name;
 }
`;

const GREET_FILE: SessionDiffFile =
{
	path: "src/greet.ts",
	status: "modified",
	additions: 2,
	deletions: 1,
	binary: false,
	patchLineCount: 10,
	patch: GREET_PATCH,
};

const SCOPES: SessionDiffScopesResponse =
{
	kind: "git",
	base: "main",
	baseRef: "origin/main",
	mergeBase: "abc1234",
	head: null,
	uncommittedAvailable: true,
	commits: [],
	totalCommits: 0,
};

function diffOf(files: SessionDiffFile[]): SessionDiffResponse
{
	return {
		scope: "branch",
		source: "git",
		root: "/repo",
		stats:
		{
			files: files.length,
			additions: files.reduce((sum, file) => sum + file.additions, 0),
			deletions: files.reduce((sum, file) => sum + file.deletions, 0),
		},
		files,
	};
}

let paneWidth = 800;
let bodyWidth = 800;
/** The diff column's observer callbacks, so a test can report a later width. */
let bodyCallbacks: Array<() => void> = [];

/**
 * Reports `paneWidth` as the pane header's content width and `bodyWidth` as the
 * diff column's border box as soon as each is observed. The diff library's own
 * observers get nothing, as with FakeObserver.
 */
class WidthObserver
{
	constructor(private readonly callback: ResizeObserverCallback)
	{
	}
	observe(target: Element)
	{
		if (target.matches("[data-diff-pane-body]"))
		{
			const report = () =>
			{
				this.callback(
					[
						{
							target,
							contentRect:
							{
								width: bodyWidth,
							},
							borderBoxSize: [
								{
									inlineSize: bodyWidth,
									blockSize: 600,
								},
							],
						} as unknown as ResizeObserverEntry,
					],
					this,
				);
			};
			bodyCallbacks.push(report);
			report();
			return;
		}
		if (target.querySelector('[aria-label="Changes settings"]') === null) return;
		this.callback(
			[
				{
					target,
					contentRect:
					{
						width: paneWidth,
					},
				} as unknown as ResizeObserverEntry,
			],
			this,
		);
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

beforeEach(() =>
{
	paneWidth = 800;
	bodyWidth = 800;
	bodyCallbacks = [];
	installLocalStorage();
	vi.stubGlobal("ResizeObserver", WidthObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

function renderPane()
{
	return render(
		<SettingsProvider>
			<ChangesPaneView
				diff={diffOf([GREET_FILE])}
				scopes={SCOPES}
				controls={null}
				onRefresh={() =>
				{
				}}
			/>
		</SettingsProvider>,
	);
}

async function openSettings()
{
	fireEvent.click(
		screen.getByRole(
			"button",
			{
				name: "Changes settings",
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
}

function menuRows(): Array<[string | null, string, string | null]>
{
	const menu = screen.getByRole("menu");
	return [...menu.querySelectorAll<HTMLElement>("[role^=menuitem]")].map((item) => [
		item.getAttribute("role"),
		item.textContent,
		item.getAttribute("aria-checked"),
	]);
}

async function settle()
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

function sideBySide(): HTMLElement
{
	return screen.getByRole(
		"menuitemcheckbox",
		{
			name: /^Side by side/,
		},
	);
}

/** The row's "Needs a wider pane" hint text and class, or null when it has none. */
function hintOf(row: HTMLElement): [string | null, string] | null
{
	const hint = row.querySelector("[data-menu-hint]");
	return hint === null ? null : [hint.textContent, hint.className];
}

/** The diff library's rendered layout: "split" side by side, "single" unified. */
async function renderedDiffType(container: HTMLElement): Promise<string | null>
{
	return waitFor(() =>
	{
		const pre = container.querySelector("diffs-container")?.shadowRoot?.querySelector("pre[data-diff]");
		if (!pre) throw new Error("diff not rendered yet");
		return pre.getAttribute("data-diff-type");
	});
}

describe("Changes settings menu", () =>
{
	it("lists upstream's items in order with their default checked state", async () =>
	{
		renderPane();
		await openSettings();

		expect(menuRows()).toStrictEqual([
			["menuitemcheckbox", "Show filesCtrl+Shift+Y", "false"],
			["menuitem", "File list positionAutomatic", null],
			["menuitemcheckbox", "Group files by folder", "true"],
			["menuitemcheckbox", "Separate test, build, and generated files", "false"],
			["menuitem", "Collapse all files", null],
			["menuitem", "Expand all files", null],
			["menuitemcheckbox", "Side by side", "false"],
			["menuitemcheckbox", "Word wrap", "true"],
			["menuitemcheckbox", "Highlight changed words", "true"],
			["menuitemcheckbox", "Hide whitespace changes", "false"],
			["menuitem", "Refresh", null],
		]);
	});

	it("keeps Side by side below 560px and explains why when it is on", async () =>
	{
		paneWidth = 559;
		bodyWidth = 559;
		const {container} = renderPane();
		await openSettings();
		const before = menuRows();
		const hintBefore = sideBySide().querySelector("[data-menu-hint]");
		fireEvent.click(sideBySide());
		await settle();

		expect(
			{
				before,
				hintBefore,
				stored: localStorage.getItem("ccp-diff-style"),
				checked: sideBySide().getAttribute("aria-checked"),
				hint: hintOf(sideBySide()),
				diffType: await renderedDiffType(container),
			},
		).toStrictEqual(
			{
				before: [
					["menuitemcheckbox", "Show filesCtrl+Shift+Y", "false"],
					["menuitem", "File list positionAutomatic", null],
					["menuitemcheckbox", "Group files by folder", "true"],
					["menuitemcheckbox", "Separate test, build, and generated files", "false"],
					["menuitem", "Collapse all files", null],
					["menuitem", "Expand all files", null],
					["menuitemcheckbox", "Side by side", "false"],
					["menuitemcheckbox", "Word wrap", "true"],
					["menuitemcheckbox", "Highlight changed words", "true"],
					["menuitemcheckbox", "Hide whitespace changes", "false"],
					["menuitem", "Refresh", null],
				],
				hintBefore: null,
				stored: "split",
				checked: "true",
				hint: [
					"Needs a wider pane",
					"max-w-[160px] shrink-0 truncate py-[0.125em] -my-[0.125em] text-footnote text-ink-muted",
				],
				diffType: "single",
			},
		);
	});

	it("renders split with no hint when the diff column is at least 560px", async () =>
	{
		localStorage.setItem("ccp-diff-style", "split");
		const {container} = renderPane();
		await settle();
		await openSettings();

		expect(
			{
				hint: hintOf(sideBySide()),
				diffType: await renderedDiffType(container),
			},
		).toStrictEqual(
			{
				hint: null,
				diffType: "split",
			},
		);
	});

	it("falls back to unified when the file list leaves the diff column under 560px", async () =>
	{
		localStorage.setItem("ccp-diff-style", "split");
		paneWidth = 800;
		bodyWidth = 459;
		const {container} = renderPane();
		await settle();
		await openSettings();

		expect(
			{
				hint: hintOf(sideBySide())?.[0] ?? null,
				diffType: await renderedDiffType(container),
			},
		).toStrictEqual(
			{
				hint: "Needs a wider pane",
				diffType: "single",
			},
		);
	});

	it("holds the last split fit while the diff column measures 0px wide", async () =>
	{
		localStorage.setItem("ccp-diff-style", "split");
		bodyWidth = 600;
		renderPane();
		await settle();
		bodyWidth = 0;
		act(() =>
		{
			for (const report of bodyCallbacks) report();
		});
		await openSettings();

		expect(hintOf(sideBySide())).toBeNull();
	});

	it("persists every toggle across remounts", async () =>
	{
		const first = renderPane();
		await openSettings();
		for (const label of [
			"Show files",
			"Group files by folder",
			"Separate test, build, and generated files",
			"Side by side",
			"Word wrap",
			"Highlight changed words",
			"Hide whitespace changes",
		])
		{
			fireEvent.click(
				screen.getByRole(
					"menuitemcheckbox",
					{
						name: new RegExp(`^${label}`),
					},
				),
			);
		}
		first.unmount();

		renderPane();
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});
		const showFilesPressed = screen
			.getByRole(
				"button",
				{
					name: "Hide files",
				},
			)
			.getAttribute("aria-pressed");
		await openSettings();

		expect(
			{
				showFilesPressed,
				rows: menuRows(),
				stored:
				{
					tree: localStorage.getItem("ccp-diff-show-tree"),
					folder: localStorage.getItem("ccp-diff-group-by-folder"),
					kind: localStorage.getItem("ccp-diff-group-by-kind"),
					style: localStorage.getItem("ccp-diff-style"),
					wrap: localStorage.getItem("ccp-diff-word-wrap"),
					words: localStorage.getItem("ccp-diff-word-diff"),
					whitespace: localStorage.getItem("ccp-diff-hide-whitespace"),
				},
			},
		).toStrictEqual(
			{
				showFilesPressed: "true",
				rows: [
					["menuitemcheckbox", "Show filesCtrl+Shift+Y", "true"],
					["menuitem", "File list positionAutomatic", null],
					["menuitemcheckbox", "Group files by folder", "false"],
					["menuitemcheckbox", "Separate test, build, and generated files", "true"],
					["menuitem", "Collapse all files", null],
					["menuitem", "Expand all files", null],
					["menuitemcheckbox", "Side by side", "true"],
					["menuitemcheckbox", "Word wrap", "false"],
					["menuitemcheckbox", "Highlight changed words", "false"],
					["menuitemcheckbox", "Hide whitespace changes", "true"],
					["menuitem", "Refresh", null],
				],
				stored:
				{
					tree: "true",
					folder: "false",
					kind: "true",
					style: "split",
					wrap: "false",
					words: "false",
					whitespace: "true",
				},
			},
		);
	});

	it("ignores a stored diff style outside the strict schema", async () =>
	{
		localStorage.setItem("ccp-diff-style", "side-by-side");
		renderPane();
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});
		await openSettings();

		expect(
			screen
				.getByRole(
					"menuitemcheckbox",
					{
						name: "Side by side",
					},
				)
				.getAttribute("aria-checked"),
		).toBe("false");
	});

	it("File list position writes the setting the Files pane's File tree position reads", async () =>
	{
		render(
			<SettingsProvider>
				<ChangesPaneView
					diff={diffOf([GREET_FILE])}
					scopes={SCOPES}
					controls={null}
					onRefresh={() =>
					{
					}}
				/>
				<TileHost sessionId="changes-position" onExpandWithoutPane={() => undefined}>
					<FilesPaneView
						chrome={
						{
							moveHandle: null,
							controls: null,
						}}
						sessionFiles={
						{
							files: [],
							totalCount: 0,
							counts:
							{
								userMessage: 0,
								agentMessage: 0,
								read: 0,
								editWrite: 0,
								bash: 0,
								grepGlob: 0,
								thinking: 0,
								other: 0,
							},
						}}
						unscannedRecordCount={0}
					/>
				</TileHost>
			</SettingsProvider>,
		);
		await openSettings();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: /^File list position/,
				},
			),
		);
		fireEvent.click(
			await screen.findByRole(
				"menuitemradio",
				{
					name: "Left",
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
		fireEvent.click(
			screen.getByRole(
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

		expect(
			{
				stored: localStorage.getItem("ccp-file-column-position"),
				filesHint: screen.getByRole(
					"menuitem",
					{
						name: /^File tree position/,
					},
				).textContent,
			},
		).toStrictEqual(
			{
				stored: "left",
				filesHint: "File tree positionLeft",
			},
		);
	});

	it("Right puts the file list on the right of the diff", async () =>
	{
		localStorage.setItem("ccp-diff-show-tree", "true");
		localStorage.setItem("ccp-file-column-position", "right");
		renderPane();
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});
		const column = document.querySelector<HTMLElement>("[data-changed-files-list]");

		expect(
			{
				reversed: column?.parentElement?.classList.contains("flex-row-reverse"),
				border: [...(column?.classList ?? [])].filter((name) => /^border-[se]$/.test(name)),
			},
		).toStrictEqual(
			{
				reversed: true,
				border: ["border-s"],
			},
		);
	});

	it("offers only Refresh when there are no changes", async () =>
	{
		render(
			<SettingsProvider>
				<ChangesPaneView
					diff={diffOf([])}
					scopes={SCOPES}
					controls={null}
					onRefresh={() =>
					{
					}}
				/>
			</SettingsProvider>,
		);
		await openSettings();

		expect(menuRows()).toStrictEqual([["menuitem", "Refresh", null]]);
	});
});
