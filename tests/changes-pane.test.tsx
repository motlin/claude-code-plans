// @vitest-environment jsdom

import type {ComponentProps} from "react";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {ChangesPane, ChangesPaneView} from "../src/components/changes/changes-pane";
import {GoToFile} from "../src/components/changes/go-to-file";
import {isLargeDiff, LARGE_DIFF_MAX_FILES, LARGE_DIFF_MAX_LINES} from "../src/components/changes/large-diff";
import {SettingsProvider} from "../src/components/settings-provider";
import {DEFAULTS} from "../src/components/settings-context";
import {ToastProvider} from "../src/components/toast";
import
{
	sessionDiffFileQueryOptions,
	sessionDiffQueryOptions,
	sessionDiffScopesQueryOptions,
	type SessionDiffFile,
	type SessionDiffResponse,
	type SessionDiffScopesResponse,
} from "../src/lib/api/session-diff";
import type {FileRef} from "../src/lib/file-refs";
import {onFileOpenRequest} from "../src/lib/file-open-requests";
import {registerComposer, takeContextChips} from "../src/lib/context-attach";
import {installLocalStorage} from "./fake-storage";
import {sessionDetailQueryOptions, type SessionDetailData} from "../src/lib/api/sessions";
import type {PrStatus} from "../src/lib/pr-status";
import {type DiffMarkScope, fileMarkStatus, setFileMarked} from "../src/lib/diff-file-marks";
import {clearDiffComments, openDiffCommentDraft, saveDiffComment} from "../src/lib/diff-comments";
import {clearDiffScrollTarget, diffScrollTarget, scrollToDiffLine} from "../src/lib/diff-scroll-target";
import type {ReviewFinding} from "../src/lib/review-diff";
import {reviewQueryOptions, type ReviewBundle} from "../src/lib/api/reviews";
import {formatApplyFindingsPrompt, openReviewInChanges} from "../src/lib/changes-review";
import {clearReviewFindingCursor} from "../src/lib/review-finding-cursor";
import {parseReportFindings} from "../src/lib/report-findings";
import
{
	clearReviewFindings,
	reviewFindingsSnapshot,
	setReviewFindings,
	toStoreFindings,
	unanchoredFindingIds,
} from "../src/lib/review-findings-store";

const reviewApi = vi.hoisted(() => (
{
	replace: vi.fn<(reviewId: string, findings: readonly unknown[]) => Promise<unknown>>(),
}));

vi.mock("../src/lib/api/reviews", async (importOriginal) => (
{
	...(await importOriginal<typeof import("../src/lib/api/reviews")>()),
	replaceReviewFindings: reviewApi.replace,
}));

const clipboard = vi.hoisted(() => (
{
	write: vi.fn<(text: string) => Promise<boolean>>(),
}));

vi.mock("../src/lib/clipboard", async (importOriginal) =>
{
	const actual = await importOriginal<typeof import("../src/lib/clipboard")>();
	clipboard.write.mockImplementation(async (text) => actual.writeClipboardText(text));
	return {
		...actual,
		writeClipboardText: clipboard.write,
	};
});

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

const LOGO_FILE: SessionDiffFile =
{
	path: "assets/logo.png",
	status: "added",
	additions: 0,
	deletions: 0,
	binary: true,
	patchLineCount: 0,
	patch: null,
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

function renderPane(files: SessionDiffFile[])
{
	return render(
		<SettingsProvider>
			<ChangesPaneView
				diff={diffOf(files)}
				scopes={SCOPES}
				controls={<button type="button">Close</button>}
				onRefresh={() =>
				{
				}}
			/>
		</SettingsProvider>,
	);
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
	installLocalStorage();
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("ChangesPaneView occurrence highlight", () =>
{
	// Upstream c6e73333a `A`: `--code-theme-selection-match-bg` from the loaded code theme pair (c5d464fa3 `B`).
	it("sets the code themes' selection-match colour on the pane body", async () =>
	{
		renderPane([GREET_FILE]);
		await waitFor(() =>
		{
			expect(
				document
					.querySelector<HTMLElement>("[data-diff-pane-body]")
					?.style.getPropertyValue("--code-theme-selection-match-bg"),
			).toBe("light-dark(#0073e61a, #0099ff24)");
		});
	});

	// Upstream c44d00c7f `um` calls `jl(Ut, dn)` on the pane body: a selection in one row paints the others.
	it("paints other occurrences of a diff selection across the pane", async () =>
	{
		const registry = new Map<string, Set<AbstractRange>>();
		vi.stubGlobal(
			"Highlight",
			class extends Set<AbstractRange>
			{
				priority = 0;
			},
		);
		Object.defineProperty(
			CSS,
			"highlights",
			{
				configurable: true,
				value: registry,
			},
		);
		renderPane([GREET_FILE]);
		const row = await waitFor(() =>
		{
			const found = [
				...(document.querySelector("diffs-container")?.shadowRoot?.querySelectorAll("[data-line]") ?? []),
			].find((line) => line.textContent.includes("const greeting"));
			if (!found) throw new Error("no greeting row");
			return found;
		});
		const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
		{
			if (node instanceof Text) nodes.push(node);
		}
		const text = nodes.find((node) => node.data.includes("greeting"));
		if (!text) throw new Error("no greeting text");
		const own = document.createRange();
		own.setStart(text, text.data.indexOf("greeting"));
		own.setEnd(text, text.data.indexOf("greeting") + 8);
		vi.spyOn(window, "getSelection").mockReturnValue(
			{
				getComposedRanges: () => [own],
				toString: () => own.toString(),
			} as unknown as Selection,
		);
		document.dispatchEvent(new Event("selectionchange"));
		await waitFor(() =>
		{
			expect(
				[...(registry.get("epitaxy-diff-occurrence") ?? [])].map((range) =>
				{
					const node = range.startContainer;
					return (node instanceof Element ? node : node.parentElement)?.closest("[data-line]")?.textContent;
				}),
			).toStrictEqual(['  return greeting + " " + name;']);
		});
		vi.restoreAllMocks();
	});
});

function headerButton(path: string): HTMLElement
{
	const header = document.querySelector(`[data-diff-file-header="${path}"] button[aria-expanded]`);
	if (!(header instanceof HTMLElement)) throw new Error(`No header for ${path}`);
	return header;
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

describe("isLargeDiff", () =>
{
	it("is large past 100 files or 10k changed lines", () =>
	{
		const manyFiles = Array.from(
			{
				length: LARGE_DIFF_MAX_FILES + 1,
			},
			(_, index) => (
			{
				...GREET_FILE,
				path: `f${index}.ts`,
			}),
		);
		expect(
			{
				maxFiles: LARGE_DIFF_MAX_FILES,
				maxLines: LARGE_DIFF_MAX_LINES,
				small: isLargeDiff([GREET_FILE]),
				atFileLimit: isLargeDiff(manyFiles.slice(0, LARGE_DIFF_MAX_FILES)),
				overFileLimit: isLargeDiff(manyFiles),
				atLineLimit: isLargeDiff([
					{
						...GREET_FILE,
						additions: 6000,
						deletions: 4000,
					},
				]),
				overLineLimit: isLargeDiff([
					{
						...GREET_FILE,
						additions: 6000,
						deletions: 4001,
					},
				]),
			},
		).toEqual(
			{
				maxFiles: 100,
				maxLines: 10_000,
				small: false,
				atFileLimit: false,
				overFileLimit: true,
				atLineLimit: false,
				overLineLimit: true,
			},
		);
	});
});

describe("ChangesPaneView", () =>
{
	it("shows the empty copy and hides the file controls when there are no changes", () =>
	{
		renderPane([]);

		expect(
			{
				empty: screen.getByText("No changes to show").tagName,
				scope: screen.getByRole(
					"button",
					{
						name: "Diff scope: main → working tree",
					},
				).textContent,
				scopeGhost: screen
					.getByRole(
						"button",
						{
							name: "Diff scope: main → working tree",
						},
					)
					.hasAttribute("data-cds-ghost"),
				// Upstream `sP`: the button-led title row, which drops its 4px step when a ghost button leads it.
				titleRow: screen
					.getByRole(
						"button",
						{
							name: "Diff scope: main → working tree",
						},
					)
					.parentElement?.className.split(" "),
				showFiles: screen.queryByRole(
					"button",
					{
						name: "Show files",
					},
				),
				goToFile: screen.queryByRole(
					"button",
					{
						name: "Go to file",
					},
				),
				settings: screen.getByRole(
					"button",
					{
						name: "Changes settings",
					},
				).tagName,
				close: screen.getByRole(
					"button",
					{
						name: "Close",
					},
				).tagName,
			},
		).toEqual(
			{
				empty: "P",
				scope: "mainworking tree",
				scopeGhost: true,
				titleRow: [
					"relative",
					"z-[1]",
					"flex",
					"min-w-0",
					"items-center",
					"gap-1",
					"ps-[4px]",
					"has-[>[data-cds-ghost]:nth-child(1_of_:not([data-base-ui-focus-guard]))]:ps-0",
				],
				showFiles: null,
				goToFile: null,
				settings: "BUTTON",
				close: "BUTTON",
			},
		);
	});

	function renderState(props: Partial<ComponentProps<typeof ChangesPaneView>>)
	{
		return render(
			<SettingsProvider>
				<ChangesPaneView
					diff={undefined}
					scopes={SCOPES}
					controls={<button type="button">Close</button>}
					onRefresh={() =>
					{
					}}
					{...props}
				/>
			</SettingsProvider>,
		);
	}

	it("shows upstream's large Loading changes spinner, not text, while the diff loads", () =>
	{
		renderState({});
		const status = screen.getByRole(
			"status",
			{
				name: "Loading changes",
			},
		);
		expect(
			{
				spinner: status.querySelector("svg")?.getAttribute("class")?.split(" ").includes("animate-spin"),
				text: status.textContent,
			},
		).toStrictEqual(
			{
				spinner: true,
				text: "",
			},
		);
	});

	it("says it will try again on its own while the load is retrying", () =>
	{
		renderState(
			{
				failure:
				{
					retrying: true,
					onRetry: () =>
					{
					},
				},
			},
		);
		const alert = screen.getByRole("alert");
		expect(
			{
				text: alert.textContent,
				retry: within(alert).queryByRole(
					"button",
					{
						name: "Try again",
					},
				),
				icon: alert.querySelector("svg") !== null,
			},
		).toStrictEqual(
			{
				text: "Couldn’t load the changesIt will try again on its own.",
				retry: null,
				icon: true,
			},
		);
	});

	it("offers Try again once retrying stops", () =>
	{
		const onRetry = vi.fn<() => void>();
		renderState(
			{
				failure:
				{
					retrying: false,
					onRetry,
				},
			},
		);
		fireEvent.click(
			within(screen.getByRole("alert")).getByRole(
				"button",
				{
					name: "Try again",
				},
			),
		);
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("explains a missing repository when no git checkout and no session edits are found", () =>
	{
		renderState(
			{
				diff:
				{
					...diffOf([]),
					scope: "session",
					source: "session-edits",
				},
				scopes:
				{
					kind: "no-git",
				},
			},
		);
		expect(screen.getByText("Changes need a Git repository").nextElementSibling?.textContent).toBe(
			"None was found for this session, or its folder couldn’t be reached.",
		);
	});

	it("says No uncommitted changes for an empty uncommitted scope", () =>
	{
		renderState(
			{
				diff:
				{
					...diffOf([]),
					scope: "uncommitted",
				},
				scope: "uncommitted",
			},
		);
		expect(screen.getByText("No uncommitted changes").tagName).toBe("P");
	});

	it("shows the file controls when there are changes", () =>
	{
		renderPane([GREET_FILE]);

		expect(
			{
				showFiles: screen
					.getByRole(
						"button",
						{
							name: "Show files",
						},
					)
					.getAttribute("aria-pressed"),
				goToFile: screen.getByRole(
					"button",
					{
						name: "Go to file",
					},
				).tagName,
				empty: screen.queryByText("No changes to show"),
			},
		).toEqual(
			{
				showFiles: "false",
				goToFile: "BUTTON",
				empty: null,
			},
		);
	});

	it("toggles a file's aria-expanded when its header is clicked", async () =>
	{
		renderPane([GREET_FILE]);

		await waitFor(() =>
		{
			expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("true");
		});
		fireEvent.click(headerButton("src/greet.ts"));
		expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(headerButton("src/greet.ts"));
		expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("true");
	});

	it("flips the Show files toggle label when pressed", () =>
	{
		renderPane([GREET_FILE]);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show files",
				},
			),
		);
		expect(
			screen
				.getByRole(
					"button",
					{
						name: "Hide files",
					},
				)
				.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("keeps the Show files toggle and the file list's resize and edge handles in step", () =>
	{
		renderPane([GREET_FILE]);
		const hiddenAtStart =
		{
			edge: screen
				.getByRole(
					"separator",
					{
						name: "Resize file list",
					},
				)
				.getAttribute("aria-valuenow"),
			list: document.querySelector<HTMLElement>("[data-changed-files-list]")?.hidden,
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show files",
				},
			),
		);
		const handle = screen.getByRole(
			"separator",
			{
				name: "Resize file list",
			},
		);
		const shown =
		{
			toggle: screen
				.getByRole(
					"button",
					{
						name: "Hide files",
					},
				)
				.getAttribute("aria-pressed"),
			valuenow: handle.getAttribute("aria-valuenow"),
		};
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

		expect(
			{
				hiddenAtStart,
				shown,
				toggle: screen
					.getByRole(
						"button",
						{
							name: "Show files",
						},
					)
					.getAttribute("aria-pressed"),
				edge: screen
					.getByRole(
						"separator",
						{
							name: "Resize file list",
						},
					)
					.getAttribute("aria-valuenow"),
			},
		).toStrictEqual(
			{
				hiddenAtStart:
				{
					edge: "0",
					list: true,
				},
				shown:
				{
					toggle: "true",
					valuenow: "240",
				},
				toggle: "false",
				edge: "0",
			},
		);
	});

	it("paints the pressed Hide files toggle with accent ink on a transparent background", () =>
	{
		renderPane([GREET_FILE]);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show files",
				},
			),
		);
		const classes = screen
			.getByRole(
				"button",
				{
					name: "Hide files",
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

	describe("bodyless file headers (upstream c44d00c7f of, Vs, Ji)", () =>
	{
		function headerState(path: string)
		{
			const root = document.querySelector(`[data-diff-file-header="${path}"]`);
			const button = root?.querySelector(":scope > button");
			if (!(button instanceof HTMLElement)) throw new Error(`No header for ${path}`);
			return {
				text: button.textContent,
				name: button.querySelector('[dir="ltr"]')?.parentElement?.className,
				disabled: button.getAttribute("aria-disabled"),
				expanded: button.getAttribute("aria-expanded"),
				body: root?.closest("[data-cds=FileDiff]") !== null,
			};
		}

		it("shows a binary file as a disabled header with its notes and no +0 −0", () =>
		{
			renderPane([
				{
					...LOGO_FILE,
					patchLineCount: 4,
					patch: "diff --git a/assets/logo.png b/assets/logo.png\nnew file mode 100644\nindex 0000000..7777777\nBinary files /dev/null and b/assets/logo.png differ\n",
				},
			]);

			expect(headerState("assets/logo.png")).toStrictEqual(
				{
					text: "logo.pngassetsNew fileBinary file",
					name: "flex min-w-0 text-body text-success",
					disabled: "true",
					expanded: null,
					body: false,
				},
			);
		});

		it("shows a mode-only file as a disabled Made executable header with no diff body", () =>
		{
			renderPane([
				{
					path: "run.sh",
					status: "modified",
					additions: 0,
					deletions: 0,
					binary: false,
					modeChange:
					{
						previous: "100644",
						next: "100755",
					},
					patchLineCount: 3,
					patch: "diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n",
				},
			]);

			expect(
				{
					header: headerState("run.sh"),
					containers: document.querySelectorAll("diffs-container").length,
				},
			).toStrictEqual(
				{
					header:
					{
						text: "run.shMade executable",
						name: "flex min-w-0 text-body text-secondary",
						disabled: "true",
						expanded: null,
						body: false,
					},
					containers: 0,
				},
			);
		});

		it("keeps a whitespace-only file's unfolded counts beside a disabled Whitespace only header", () =>
		{
			renderPane([
				{
					path: "ws.txt",
					status: "modified",
					additions: 1,
					deletions: 1,
					binary: false,
					whitespaceOnly: true,
					patchLineCount: 0,
					patch: "",
				},
			]);

			expect(headerState("ws.txt")).toStrictEqual(
				{
					text: "ws.txtWhitespace only+1−11 added, 1 removed",
					name: "flex min-w-0 text-body text-secondary",
					disabled: "true",
					expanded: null,
					body: false,
				},
			);
		});

		it("says Too large to show for a patch with no hunks despite non-zero counts", () =>
		{
			renderPane([
				{
					path: "big.txt",
					status: "modified",
					additions: 3,
					deletions: 2,
					binary: false,
					patchLineCount: 2,
					patch: "diff --git a/big.txt b/big.txt\nindex 1111111..2222222 100644\n",
				},
			]);

			expect(headerState("big.txt")).toStrictEqual(
				{
					text: "big.txtToo large to show+3−23 added, 2 removed",
					name: "flex min-w-0 text-body text-secondary",
					disabled: "true",
					expanded: null,
					body: false,
				},
			);
		});

		it("adds the mode note to a file that also has hunks, keeping it expandable", () =>
		{
			renderPane([
				{
					...GREET_FILE,
					modeChange:
					{
						previous: "100755",
						next: "100644",
					},
				},
			]);

			expect(
				{
					text: headerButton("src/greet.ts").textContent,
					disabled: headerButton("src/greet.ts").getAttribute("aria-disabled"),
				},
			).toStrictEqual(
				{
					text: "greet.tssrcNo longer executable+2−12 added, 1 removed",
					disabled: null,
				},
			);
		});
	});

	it("counts files whose diff content is unavailable", () =>
	{
		renderPane([GREET_FILE, LOGO_FILE]);

		expect(screen.getByText("Diff content unavailable for 1 file.").tagName).toBe("P");
	});

	it("collapses every file, shows the banner and disables Expand all with a tooltip when large", async () =>
	{
		renderPane([
			{
				...GREET_FILE,
				additions: 10_001,
			},
		]);

		await waitFor(() =>
		{
			expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("false");
		});
		expect(
			screen.getByText("Files are collapsed for large diffs. Select a file to expand it.").parentElement?.tagName,
		).toBe("P");

		await openSettings();
		const expandAll = screen.getByRole(
			"menuitem",
			{
				name: "Expand all files",
			},
		);
		expect(
			{
				parentRole: expandAll.parentElement?.getAttribute("role"),
				description: document.getElementById(expandAll.getAttribute("aria-describedby") ?? "")?.textContent,
				disabled: expandAll.getAttribute("aria-disabled"),
				collapseDisabled: screen
					.getByRole(
						"menuitem",
						{
							name: "Collapse all files",
						},
					)
					.getAttribute("aria-disabled"),
			},
		).toEqual(
			{
				parentRole: "none",
				description: "This diff is too large to expand at once. Select a file to expand it.",
				disabled: "true",
				collapseDisabled: null,
			},
		);

		vi.useFakeTimers();
		fireEvent.pointerEnter(expandAll.parentElement ?? expandAll);
		act(() =>
		{
			vi.advanceTimersByTime(300);
		});
		expect(screen.getByRole("tooltip").textContent).toBe(
			"This diff is too large to expand at once. Select a file to expand it.",
		);
	});

	it("collapses and expands every file from the settings menu", async () =>
	{
		renderPane([GREET_FILE]);
		await waitFor(() =>
		{
			expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("true");
		});

		await openSettings();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Collapse all files",
				},
			),
		);
		expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("false");

		await openSettings();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Expand all files",
				},
			),
		);
		expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("true");
	});
});

describe("ChangesPaneView file list", () =>
{
	const COMMIT =
	{
		sha: "07bc05d1111111111111111111111111111111111",
		shortSha: "07bc05d",
		subject: "Fetch logs",
		author: "Craig",
		date: "2026-09-14T20:29:26.000Z",
	};

	it("shows the Changed files tree and commit list, marking the selected file active", () =>
	{
		Element.prototype.scrollIntoView = vi.fn<Element["scrollIntoView"]>();
		const onSelectScope = vi.fn<(scope: string) => void>();
		render(
			<SettingsProvider>
				<ChangesPaneView
					diff={diffOf([GREET_FILE, LOGO_FILE])}
					scopes={
					{
						...SCOPES,
						commits: [COMMIT],
						totalCommits: 1,
					}}
					controls={null}
					onRefresh={() =>
					{
					}}
					scope="branch"
					onSelectScope={onSelectScope}
				/>
			</SettingsProvider>,
		);
		expect(
			screen.queryByRole(
				"tree",
				{
					name: "Changed files",
				},
			),
		).toBeNull();

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show files",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"treeitem",
				{
					name: /^greet\.ts/,
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Fetch logs/,
				},
			),
		);

		expect(
			{
				rows: screen.getAllByRole("treeitem").map((row) => [row.textContent, row.getAttribute("aria-current")]),
				selectedScopes: onSelectScope.mock.calls,
			},
		).toEqual(
			{
				rows: [
					["assets", null],
					["logo.png+0−0", null],
					["src", null],
					["greet.ts+2−1", "true"],
				],
				selectedScopes: [["commit:07bc05d1111111111111111111111111111111111"]],
			},
		);
	});

	describe("Go to file", () =>
	{
		function openGoToFile()
		{
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Go to file",
					},
				),
			);
			return screen.getByRole(
				"combobox",
				{
					name: "Search changed files",
				},
			);
		}

		function optionTexts()
		{
			return screen.queryAllByRole("option").map((option) => option.textContent);
		}

		it("highlights matched characters and hides non-matching files", () =>
		{
			renderPane([GREET_FILE, LOGO_FILE]);
			fireEvent.change(
				openGoToFile(),
				{
					target:
					{
						value: "grt",
					},
				},
			);

			expect(
				{
					options: optionTexts(),
					lit: [...document.querySelectorAll("[role=option] span[data-lit]")].map((span) => [
						span.textContent,
						span.className,
					]),
				},
			).toEqual(
				{
					options: ["greet.tssrc+2−1"],
					lit: [
						["gr", "font-semibold text-primary"],
						["t", "font-semibold text-primary"],
					],
				},
			);
		});

		it("draws upstream's 12px file-type icon on each result under a non-Claude code theme", () =>
		{
			localStorage.setItem("ccp-code-theme-light", "github-light");
			renderPane([GREET_FILE]);
			openGoToFile();
			const svg = screen.getByRole("option").querySelector("svg");

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
					fill: "var(--fti-typescript)",
				},
			);
		});

		it("draws the monochrome glyph on each result under the default Claude Light code theme", () =>
		{
			renderPane([GREET_FILE]);
			openGoToFile();
			const option = screen.getByRole("option");

			expect(
				{
					coloured: option.querySelector("[data-file-type-icon]") !== null,
					className: option.querySelector("svg")?.getAttribute("class"),
				},
			).toStrictEqual(
				{
					coloured: false,
					className: "lucide lucide-code-xml lucide-code-2 shrink-0 text-ink-muted",
				},
			);
		});
		it("shows No matching files when nothing matches", () =>
		{
			renderPane([GREET_FILE]);
			fireEvent.change(
				openGoToFile(),
				{
					target:
					{
						value: "zzz",
					},
				},
			);

			expect(
				{
					options: optionTexts(),
					empty: screen.getByText("No matching files").tagName,
				},
			).toEqual(
				{
					options: [],
					empty: "P",
				},
			);
		});

		it("caps the list at 100 files with a keep-typing footer", () =>
		{
			// GoToFile alone: the full pane would mount 103 collapsed diffs that the cap never touches.
			const files = Array.from(
				{
					length: 103,
				},
				(_, index) => (
				{
					path: `src/f${index}.ts`,
					additions: 2,
					deletions: 1,
				}),
			);
			render(
				<SettingsProvider>
					<GoToFile
						files={files}
						onSelectFile={() =>
						{
						}}
					/>
				</SettingsProvider>,
			);
			openGoToFile();

			expect(
				{
					count: optionTexts().length,
					footer: screen.getByText("3 more files. Keep typing to narrow.").tagName,
				},
			).toEqual(
				{
					count: 100,
					footer: "P",
				},
			);
		});

		it("scrolls to the file, marks it active and closes on Enter", () =>
		{
			const scrollIntoView = vi.fn<Element["scrollIntoView"]>();
			Element.prototype.scrollIntoView = scrollIntoView;
			renderPane([LOGO_FILE, GREET_FILE]);
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Show files",
					},
				),
			);
			const input = openGoToFile();
			fireEvent.change(
				input,
				{
					target:
					{
						value: "greet",
					},
				},
			);
			fireEvent.keyDown(
				input,
				{
					key: "Enter",
				},
			);

			expect(
				{
					scrolled: scrollIntoView.mock.contexts.map((element) =>
						(element as HTMLElement)
							.closest("[data-diff-file-header]")
							?.getAttribute("data-diff-file-header"),
					),
					active: screen
						.getAllByRole("treeitem")
						.filter((row) => row.getAttribute("aria-current") === "true")
						.map((row) => row.textContent),
					open: screen.queryByRole(
						"combobox",
						{
							name: "Search changed files",
						},
					),
				},
			).toEqual(
				{
					scrolled: ["src/greet.ts"],
					active: ["greet.ts+2−1"],
					open: null,
				},
			);
		});

		it("moves the highlighted row with the arrow keys", () =>
		{
			renderPane([GREET_FILE, LOGO_FILE]);
			const input = openGoToFile();
			fireEvent.keyDown(
				input,
				{
					key: "ArrowDown",
				},
			);

			expect(
				screen
					.getAllByRole("option")
					.map((option) => [option.textContent, option.getAttribute("aria-selected")]),
			).toEqual([
				["greet.tssrc+2−1", "false"],
				["logo.pngassets+0−0", "true"],
			]);
		});

		it("opens on Ctrl+P (⌘P on mac) and prevents the print dialog", () =>
		{
			renderPane([GREET_FILE]);
			const event = new KeyboardEvent(
				"keydown",
				{
					key: "p",
					code: "KeyP",
					ctrlKey: true,
					bubbles: true,
					cancelable: true,
				},
			);
			act(() =>
			{
				document.body.dispatchEvent(event);
			});

			expect(
				{
					prevented: event.defaultPrevented,
					open: screen.getByRole(
						"combobox",
						{
							name: "Search changed files",
						},
					).tagName,
				},
			).toEqual(
				{
					prevented: true,
					open: "INPUT",
				},
			);
		});
	});
});

describe("ChangesPane file actions", () =>
{
	const SESSION = "session-file-actions";
	const DELETED_FILE: SessionDiffFile =
	{
		path: "src/old.ts",
		status: "deleted",
		additions: 0,
		deletions: 1,
		binary: false,
		patchLineCount: 7,
		patch: `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 3333333..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const old = 1;
`,
	};

	function renderChangesPane(files: SessionDiffFile[])
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
		queryClient.setQueryData(
			sessionDiffQueryOptions(
				SESSION,
				"branch",
				{
					hideWhitespace: DEFAULTS.diffHideWhitespace,
				},
			).queryKey,
			diffOf(files),
		);
		queryClient.setQueryData(sessionDiffScopesQueryOptions(SESSION).queryKey, SCOPES);
		return render(
			<QueryClientProvider client={queryClient}>
				<SettingsProvider>
					<ToastProvider>
						<ChangesPane
							sessionId={SESSION}
							cwd="/repo"
							chrome={
							{
								moveHandle: null,
								controls: null,
							}}
						/>
					</ToastProvider>
				</SettingsProvider>
			</QueryClientProvider>,
		);
	}

	function openButton(path: string): HTMLElement | null
	{
		return document.querySelector(`[data-diff-file-header="${path}"] button[aria-label="Open file"]`);
	}

	async function headerMenuRows(path: string): Promise<string[]>
	{
		fireEvent.contextMenu(
			headerButton(path),
			{
				clientX: 10,
				clientY: 10,
			},
		);
		const menu = await screen.findByRole("menu");
		return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
			row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? row.textContent),
		);
	}

	it("opens the file's absolute path in the Files pane from the header button and the menu", async () =>
	{
		const opened: FileRef[] = [];
		const stop = onFileOpenRequest(SESSION, (ref) =>
		{
			opened.push(ref);
		});
		renderChangesPane([GREET_FILE]);
		const button = openButton("src/greet.ts");
		button?.click();
		const rows = await headerMenuRows("src/greet.ts");
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Open file",
				},
			),
		);
		stop();

		expect(
			{
				rows,
				opened,
			},
		).toStrictEqual(
			{
				rows: [
					"Attach as context",
					"Copy",
					"─",
					"Show whole file",
					"Mark as viewed",
					"─",
					"Open file",
					"Open in",
					"Show in Finder",
				],
				opened: [
					{
						path: "/repo/src/greet.ts",
					},
					{
						path: "/repo/src/greet.ts",
					},
				],
			},
		);
	});

	it("offers no Open file, Open in or Show in Finder for a deleted file", async () =>
	{
		renderChangesPane([DELETED_FILE]);

		expect(
			{
				button: openButton("src/old.ts"),
				rows: await headerMenuRows("src/old.ts"),
			},
		).toStrictEqual(
			{
				button: null,
				rows: ["Attach as context", "Copy", "─", "Mark as viewed"],
			},
		);
	});

	function treeRow(path: string): HTMLElement
	{
		const row = document.querySelector(`[data-diff-tree-row][title="${path}"]`);
		if (!(row instanceof HTMLElement)) throw new Error(`no tree row ${path}`);
		return row;
	}

	async function treeMenuRows(path: string): Promise<string[]>
	{
		fireEvent.contextMenu(
			treeRow(path),
			{
				clientX: 10,
				clientY: 10,
			},
		);
		const menu = await screen.findByRole("menu");
		return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
			row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? row.textContent),
		);
	}

	it("gives a tree file row upstream's fp menu, with Open file on cmd+enter", async () =>
	{
		const opened: FileRef[] = [];
		const stop = onFileOpenRequest(SESSION, (ref) =>
		{
			opened.push(ref);
		});
		renderChangesPane([GREET_FILE]);
		const rows = await treeMenuRows("src/greet.ts");
		const openFile = screen.getByRole(
			"menuitem",
			{
				name: /^Open file/,
			},
		);
		const shortcut = openFile.getAttribute("aria-keyshortcuts");
		fireEvent.click(openFile);
		stop();

		expect(
			{
				rows,
				shortcut,
				opened,
			},
		).toStrictEqual(
			{
				rows: [
					"Attach as context",
					"Copy",
					"─",
					"Mark as viewed",
					"─",
					"Open file",
					"Open in",
					"Show in Finder",
				],
				shortcut: "Control+Enter",
				opened: [
					{
						path: "/repo/src/greet.ts",
					},
				],
			},
		);
	});

	it("gives a tree folder row the folder menu: no Open file, VS Code, and a trailing-slash attach", async () =>
	{
		const stopComposer = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		renderChangesPane([GREET_FILE]);
		const rows = await treeMenuRows("src");
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Open in",
				},
			),
		);
		const openIn = await waitFor(() =>
		{
			const menus = screen.getAllByRole("menu");
			if (menus.length < 2) throw new Error("Open in ▸ not open");
			return [...(menus.at(-1)?.querySelectorAll('[role="menuitem"]') ?? [])].map(
				(row) => row.firstElementChild?.textContent ?? row.textContent,
			);
		});
		cleanup();
		renderChangesPane([GREET_FILE]);
		await treeMenuRows("src");
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Attach as context",
				},
			),
		);
		stopComposer();

		expect(
			{
				rows,
				openIn,
				attached: takeContextChips(SESSION).map(({id: _id, ...chip}) => chip),
			},
		).toStrictEqual(
			{
				rows: ["Attach as context", "Copy", "─", "Open in", "Show in Finder"],
				openIn: ["VS Code"],
				attached: [
					{
						kind: "file",
						path: "src/",
					},
				],
			},
		);
	});

	it("opens the absolute path in VS Code and reveals it in Finder", async () =>
	{
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
			Promise.resolve(
				Response.json(
					{
						ok: true,
					},
				),
			),
		);
		vi.stubGlobal("fetch", fetchMock);
		renderChangesPane([GREET_FILE]);
		await headerMenuRows("src/greet.ts");
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Open in",
				},
			),
		);
		fireEvent.click(
			await screen.findByRole(
				"menuitem",
				{
					name: "VS Code",
				},
			),
		);
		cleanup();
		renderChangesPane([GREET_FILE]);
		await headerMenuRows("src/greet.ts");
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Show in Finder",
				},
			),
		);

		await waitFor(() =>
		{
			expect(
				{
					opened: open.mock.calls,
					revealed: fetchMock.mock.calls
						.filter(([url]) => url === "/api/reveal-in-finder")
						.map(([, init]) => init?.body),
				},
			).toStrictEqual(
				{
					opened: [["vscode://file/repo/src/greet.ts", "_self"]],
					revealed: [
						JSON.stringify(
							{
								path: "/repo/src/greet.ts",
							},
						),
					],
				},
			);
		});
	});
});

describe("ChangesPaneView viewed marks (upstream mm/gs/Ms/Is/vp)", () =>
{
	const SESSION = "session-marks";
	const BRANCH_MARKS: DiffMarkScope =
	{
		sessionId: SESSION,
		repo: "/repo",
		diff: JSON.stringify(["branch", "main", null]),
	};
	const OTHER_FILE: SessionDiffFile =
	{
		...GREET_FILE,
		path: "src/other.ts",
		patch: GREET_PATCH.replaceAll("greet.ts", "other.ts"),
	};

	function paneProps(
		files: SessionDiffFile[],
		{
			scope = "branch",
			source = "git",
			sessionId = SESSION,
		}:
		{
			scope?: string;
			source?: "git" | "session-edits";
			sessionId?: string | null;
		} = {},
	): ComponentProps<typeof ChangesPaneView>
	{
		return {
			diff:
			{
				...diffOf(files),
				scope,
				source,
			},
			scopes: SCOPES,
			controls: null,
			onRefresh: () =>
			{
			},
			scope,
			...(sessionId === null
				? {}
				:
					{
						sessionId,
					}),
		};
	}

	function renderMarks(...args: Parameters<typeof paneProps>)
	{
		const view = render(
			<SettingsProvider>
				<ToastProvider>
					<ChangesPaneView {...paneProps(...args)} />
				</ToastProvider>
			</SettingsProvider>,
		);
		return {
			rerender: (...next: Parameters<typeof paneProps>) =>
			{
				view.rerender(
					<SettingsProvider>
						<ToastProvider>
							<ChangesPaneView {...paneProps(...next)} />
						</ToastProvider>
					</SettingsProvider>,
				);
			},
		};
	}

	function viewedButton(path: string): HTMLButtonElement | null
	{
		return document.querySelector(`[data-diff-file-header="${path}"] button[aria-label="Viewed"]`);
	}

	function viewedButtons(): string[]
	{
		return [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Viewed"]')].map(
			(button) =>
				`${button.closest("[data-diff-file-header]")?.getAttribute("data-diff-file-header") ?? "?"}${button.disabled ? " (disabled)" : ""}`,
		);
	}

	function expanded(path: string): string | null
	{
		return headerButton(path).getAttribute("aria-expanded");
	}

	it("gives each file header a Viewed check in a local git scope, disabled for a file it can't mark", () =>
	{
		const shown: Record<string, string[]> = {};
		for (const scope of ["branch", "uncommitted", "commit:07bc05d1111111111111111111111111111111111"])
		{
			renderMarks(
				[GREET_FILE, LOGO_FILE],
				{
					scope,
				},
			);
			shown[scope] = viewedButtons();
			cleanup();
		}
		expect(shown).toStrictEqual(
			{
				branch: ["src/greet.ts", "assets/logo.png (disabled)"],
				uncommitted: ["src/greet.ts", "assets/logo.png (disabled)"],
				"commit:07bc05d1111111111111111111111111111111111": ["src/greet.ts", "assets/logo.png (disabled)"],
			},
		);
	});

	it("shows no Viewed check for session edits, a turn, a diff with nothing markable, or no session", () =>
	{
		const shown: string[][] = [];
		for (const args of [
			[
				[GREET_FILE],
				{
					scope: "session",
					source: "session-edits",
				},
			],
			[
				[GREET_FILE],
				{
					scope: "turn:turn-uuid",
					source: "session-edits",
				},
			],
			[
				[
					{
						...GREET_FILE,
						patch: null,
					},
					LOGO_FILE,
				],
				{},
			],
			[
				[GREET_FILE],
				{
					sessionId: null,
				},
			],
		] as const)
		{
			renderMarks(...(args as unknown as Parameters<typeof paneProps>));
			shown.push(viewedButtons());
			cleanup();
		}
		expect(shown).toStrictEqual([[], [], [], []]);
	});

	it("starts a marked file collapsed, collapses on Viewed and expands on a second click", async () =>
	{
		setFileMarked(BRANCH_MARKS, "src/greet.ts", GREET_PATCH, true);
		renderMarks([GREET_FILE, OTHER_FILE]);
		await waitFor(() =>
		{
			expect(expanded("src/other.ts")).toBe("true");
		});
		const initial =
		{
			greet: expanded("src/greet.ts"),
			other: expanded("src/other.ts"),
		};
		fireEvent.click(viewedButton("src/other.ts") ?? document.body);
		const afterMark =
		{
			other: expanded("src/other.ts"),
			pressed: viewedButton("src/other.ts")?.getAttribute("aria-pressed"),
		};
		fireEvent.click(viewedButton("src/other.ts") ?? document.body);
		expect(
			{
				initial,
				afterMark,
				afterUnmark:
				{
					other: expanded("src/other.ts"),
					status: fileMarkStatus(BRANCH_MARKS, "src/other.ts", OTHER_FILE.patch),
				},
			},
		).toStrictEqual(
			{
				initial:
				{
					greet: "false",
					other: "true",
				},
				afterMark:
				{
					other: "false",
					pressed: "true",
				},
				afterUnmark:
				{
					other: "true",
					status: "none",
				},
			},
		);
	});

	it("expands a marked file whose patch changed, and reads it stale", async () =>
	{
		const view = renderMarks([GREET_FILE]);
		fireEvent.click(viewedButton("src/greet.ts") ?? document.body);
		const collapsed = expanded("src/greet.ts");
		view.rerender([
			{
				...GREET_FILE,
				patch: `${GREET_PATCH}+export const later = 1;\n`,
			},
		]);
		await waitFor(() =>
		{
			expect(expanded("src/greet.ts")).toBe("true");
		});
		const button = viewedButton("src/greet.ts");
		expect(
			{
				collapsed,
				described: document.getElementById(button?.getAttribute("aria-describedby") ?? "")?.textContent,
			},
		).toStrictEqual(
			{
				collapsed: "false",
				described: "Changed since you viewed it",
			},
		);
	});

	it("still expands marked files with Expand all files", async () =>
	{
		setFileMarked(BRANCH_MARKS, "src/greet.ts", GREET_PATCH, true);
		renderMarks([GREET_FILE]);
		await openSettings();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Expand all files",
				},
			),
		);
		expect(expanded("src/greet.ts")).toBe("true");
	});

	it("offers Mark as viewed in the header menu and shows the More button", async () =>
	{
		renderMarks([GREET_FILE]);
		const more = document.querySelector('[data-diff-file-header="src/greet.ts"] button[aria-label="More actions"]');
		fireEvent.contextMenu(
			headerButton("src/greet.ts"),
			{
				clientX: 10,
				clientY: 10,
			},
		);
		fireEvent.click(
			await screen.findByRole(
				"menuitem",
				{
					name: "Mark as viewed",
				},
			),
		);
		expect(
			{
				more: more !== null,
				status: fileMarkStatus(BRANCH_MARKS, "src/greet.ts", GREET_PATCH),
			},
		).toStrictEqual(
			{
				more: true,
				status: "marked",
			},
		);
	});

	it("adds the can't-be-marked sentence to the large-diff note only when nothing in a git diff is markable", () =>
	{
		const note = () =>
		{
			const paragraph = screen
				.getByText("Files are collapsed for large diffs. Select a file to expand it.")
				.closest("p");
			return [...(paragraph?.childNodes ?? [])].map((node) =>
				node.nodeType === Node.TEXT_NODE ? `text:${node.textContent ?? ""}` : node.textContent,
			);
		};
		const large =
		{
			...GREET_FILE,
			additions: 10_001,
		};
		const notes: (string | null)[][] = [];
		for (const args of [
			[
				[
					{
						...large,
						patch: null,
					},
				],
				{},
			],
			[[large], {}],
			[
				[
					{
						...large,
						patch: null,
					},
				],
				{
					scope: "session",
					source: "session-edits",
				},
			],
		] as const)
		{
			renderMarks(...(args as unknown as Parameters<typeof paneProps>));
			notes.push(note());
			cleanup();
		}
		expect(notes).toStrictEqual([
			[
				"Files are collapsed for large diffs. Select a file to expand it.",
				"text: ",
				"Files in a diff this large can’t be marked as viewed.",
			],
			["Files are collapsed for large diffs. Select a file to expand it."],
			["Files are collapsed for large diffs. Select a file to expand it."],
		]);
	});

	it("can mark a binary file by its full index ids (upstream fs's ids: form)", () =>
	{
		const logo =
		{
			...LOGO_FILE,
			patchLineCount: 3,
			patch: `diff --git a/assets/logo.png b/assets/logo.png\nindex ${"1".repeat(40)}..${"2".repeat(40)} 100644\nBinary files a/assets/logo.png and b/assets/logo.png differ\n`,
		};
		renderMarks([GREET_FILE, logo]);
		const shown = viewedButtons();
		fireEvent.click(viewedButton("assets/logo.png") ?? document.body);
		expect(
			{
				shown,
				status: fileMarkStatus(BRANCH_MARKS, "assets/logo.png", logo.patch),
			},
		).toStrictEqual(
			{
				shown: ["src/greet.ts", "assets/logo.png"],
				status: "marked",
			},
		);
	});

	/**
	 * Fake layout for upstream CodeView's held anchor: the files' scroller shows 0-400px at scrollTop 200, each
	 * header sits at `headers[path]`, and each file's root (its cds FileDiff) at `roots[path]`.
	 */
	function stubLayout(headers: Record<string, number>, roots: Record<string, number>)
	{
		const scroller = document.querySelector("[data-diff-file-header]")?.closest(".overflow-y-auto");
		if (!(scroller instanceof HTMLElement)) throw new Error("No diff scroller");
		scroller.style.overflowY = "auto";
		Object.defineProperty(
			scroller,
			"scrollHeight",
			{
				configurable: true,
				value: 2000,
			},
		);
		Object.defineProperty(
			scroller,
			"clientHeight",
			{
				configurable: true,
				value: 400,
			},
		);
		Object.defineProperty(
			scroller,
			"scrollTop",
			{
				configurable: true,
				writable: true,
				value: 200,
			},
		);
		const box = (top: number, height: number) =>
			DOMRect.fromRect(
				{
					x: 0,
					y: top,
					width: 300,
					height,
				},
			);
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element)
		{
			if (this === scroller) return box(0, 400);
			const header = this.getAttribute("data-diff-file-header");
			if (header !== null) return box(headers[header] ?? 0, 32);
			const root = this.matches('[data-cds="FileDiff"]')
				? this.querySelector("[data-diff-file-header]")?.getAttribute("data-diff-file-header")
				: null;
			return root == null ? box(0, 0) : box(roots[root] ?? 0, 32);
		});
		return scroller;
	}

	it("holds a marked header's place: the collapsed file's top lands where the header was (upstream Jt/Sc)", async () =>
	{
		renderMarks([GREET_FILE, OTHER_FILE]);
		await waitFor(() =>
		{
			expect(expanded("src/other.ts")).toBe("true");
		});
		const scrolled: number[] = [];
		try
		{
			const scroller = stubLayout(
				{
					"src/other.ts": 100,
				},
				{
					"src/other.ts": 40,
				},
			);
			fireEvent.click(viewedButton("src/other.ts") ?? document.body);
			scrolled.push(scroller.scrollTop);
			// Off screen (below the scroller's 400px), unmarking leaves the scroll alone.
			stubLayout(
				{
					"src/other.ts": 500,
				},
				{
					"src/other.ts": 440,
				},
			);
			fireEvent.click(viewedButton("src/other.ts") ?? document.body);
			scrolled.push(scroller.scrollTop);
			// The header's chevron holds its place too, on or off screen (upstream gt).
			stubLayout(
				{
					"src/other.ts": 100,
				},
				{
					"src/other.ts": 40,
				},
			);
			fireEvent.click(headerButton("src/other.ts"));
			scrolled.push(scroller.scrollTop);
		}
		finally
		{
			vi.restoreAllMocks();
		}
		expect(
			{
				scrolled,
				other: expanded("src/other.ts"),
			},
		).toStrictEqual(
			{
				scrolled: [140, 200, 140],
				other: "false",
			},
		);
	});

	it("holds only the first on-screen header when a patch change expands several marked files at once", async () =>
	{
		setFileMarked(BRANCH_MARKS, "src/greet.ts", GREET_PATCH, true);
		setFileMarked(BRANCH_MARKS, "src/other.ts", OTHER_FILE.patch, true);
		const view = renderMarks([GREET_FILE, OTHER_FILE]);
		let scrollTop: number | undefined;
		try
		{
			const scroller = stubLayout(
				{
					"src/greet.ts": 50,
					"src/other.ts": 100,
				},
				{
					"src/greet.ts": 20,
					"src/other.ts": 40,
				},
			);
			view.rerender([
				{
					...GREET_FILE,
					patch: `${GREET_PATCH}+export const later = 1;\n`,
				},
				{
					...OTHER_FILE,
					patch: `${OTHER_FILE.patch ?? ""}+export const later = 1;\n`,
				},
			]);
			await waitFor(() =>
			{
				expect([expanded("src/greet.ts"), expanded("src/other.ts")]).toStrictEqual(["true", "true"]);
			});
			scrollTop = scroller.scrollTop;
		}
		finally
		{
			vi.restoreAllMocks();
		}
		expect(scrollTop).toBe(170);
	});
});

describe("ChangesPaneView whole-file context (upstream c44d00c7f expandUnchanged, Id, Fo wholeFile, Jt)", () =>
{
	const SESSION = "session-whole-file";
	const FILE_LINES = (changed: readonly number[] = []) =>
		Array.from(
			{
				length: 40,
			},
			(_, index) => (changed.includes(index + 1) ? `LINE ${index + 1}\n` : `line ${index + 1}\n`),
		).join("");
	const patchFor = (path: string) => `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -14,3 +14,3 @@
 line 14
-line 15
+LINE 15
 line 16
@@ -20,3 +20,3 @@
 line 20
-line 21
+LINE 21
 line 22
`;
	const fileAt = (path: string): SessionDiffFile => (
	{
		path,
		status: "modified",
		additions: 2,
		deletions: 2,
		binary: false,
		patchLineCount: 16,
		patch: patchFor(path),
	});
	const A = fileAt("src/a.ts");
	const B = fileAt("src/b.ts");
	const SIDES =
	{
		oldText: FILE_LINES(),
		newText: FILE_LINES([15, 21]),
	};
	const FINDING_ON_A: ReviewFinding =
	{
		id: "f-whole",
		file: "src/a.ts",
		side: "new",
		line: 15,
		severity: "medium",
		title: "Fake finding",
		body: "Fake finding body.",
		resolved: false,
	};

	afterEach(() =>
	{
		clearDiffComments(SESSION);
	});

	interface Options
	{
		scope?: string;
		source?: "git" | "session-edits";
		findings?: ReviewFinding[];
		fetchContext?:
		{
			sessionId: string;
			scope: string;
		};
		load?: (
			path: string,
			patch: string,
			fresh: boolean,
		) => Promise<
		{
			oldText: string | null;
			newText: string | null;
		}>;
	}

	function element(
		{scope = "branch", source = "git", findings = [], fetchContext, load}: Options,
		files: SessionDiffFile[],
	)
	{
		return (
			<SettingsProvider>
				<ToastProvider>
					<ChangesPaneView
						diff={
						{
							...diffOf(files),
							scope,
							source,
						}}
						scopes={SCOPES}
						controls={null}
						onRefresh={() =>
						{
						}}
						scope={scope}
						sessionId={SESSION}
						findings={findings}
						{...(fetchContext === undefined
							? {}
							:
								{
									fetchContext,
								})}
						{...(load === undefined
							? {}
							:
								{
									loadFileSides: async (file: SessionDiffFile, patch: string, fresh: boolean) =>
										load(file.path, patch, fresh),
								})}
					/>
				</ToastProvider>
			</SettingsProvider>
		);
	}

	function loader(
		sides:
		{
			oldText: string | null;
			newText: string | null;
		} = SIDES,
	)
	{
		return vi.fn<(path: string, patch: string, fresh: boolean) => Promise<typeof sides>>(
			async (_path: string, _patch: string, _fresh: boolean) => Promise.resolve(sides),
		);
	}

	function separatorCount(path: string): number | undefined
	{
		const host = document.querySelector(`[data-diff-file-header="${path}"]`)?.closest("diffs-container");
		return host?.shadowRoot?.querySelectorAll("[data-gutter] > [data-separator]").length;
	}

	async function menuItem(path: string): Promise<
	{
		label: string;
		disabled: boolean;
	} | null>
	{
		fireEvent.contextMenu(
			headerButton(path),
			{
				clientX: 10,
				clientY: 10,
			},
		);
		const menu = await screen.findByRole("menu");
		const item = [...menu.querySelectorAll('[role="menuitem"]')].find((row) =>
			/^Show (whole file|changes only)/.test(row.textContent),
		);
		const result =
			item === undefined
				? null
				:
					{
						label: item.firstElementChild?.textContent ?? item.textContent,
						disabled: item.getAttribute("aria-disabled") === "true" || item.hasAttribute("data-disabled"),
					};
		fireEvent.keyDown(
			menu,
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		return result;
	}

	async function chooseMenuItem(path: string, name: string)
	{
		fireEvent.contextMenu(
			headerButton(path),
			{
				clientX: 10,
				clientY: 10,
			},
		);
		fireEvent.click(
			await screen.findByRole(
				"menuitem",
				{
					name,
				},
			),
		);
	}

	it("shows a file with a finding whole, loading it without a click, and leaves the others folded", async () =>
	{
		const load = loader();
		render(
			element(
				{
					findings: [FINDING_ON_A],
					load,
				},
				[A, B],
			),
		);

		await waitFor(() =>
		{
			expect(separatorCount("src/a.ts")).toBe(0);
		});
		expect(
			{
				calls: load.mock.calls.map(([path, , fresh]) => [path, fresh]),
				b: separatorCount("src/b.ts"),
			},
		).toStrictEqual(
			{
				calls: [["src/a.ts", false]],
				b: 3,
			},
		);
	});

	it("passes no loader, and so keeps the separators, for session edits", async () =>
	{
		const load = loader();
		render(
			element(
				{
					source: "session-edits",
					findings: [FINDING_ON_A],
					load,
				},
				[A],
			),
		);

		await waitFor(() =>
		{
			expect(separatorCount("src/a.ts")).toBe(2);
		});
		expect(load).not.toHaveBeenCalled();
	});

	it("shows a file whole for a comment on an unmodified line, but not for one inside a hunk", async () =>
	{
		const draft = openDiffCommentDraft(
			SESSION,
			{
				path: "src/a.ts",
				side: "additions",
				line: 30,
			},
		);
		saveDiffComment(SESSION, draft, "Fake comment on line 30");
		openDiffCommentDraft(
			SESSION,
			{
				path: "src/b.ts",
				side: "additions",
				line: 15,
			},
		);
		const load = loader();
		render(
			element(
				{
					load,
				},
				[A, B],
			),
		);

		await waitFor(() =>
		{
			expect(separatorCount("src/a.ts")).toBe(0);
		});
		expect(
			{
				calls: load.mock.calls.map(([path]) => path),
				b: separatorCount("src/b.ts"),
			},
		).toStrictEqual(
			{
				calls: ["src/a.ts"],
				b: 3,
			},
		);
	});

	it("shows a file whole for a draft on an unmodified line", async () =>
	{
		openDiffCommentDraft(
			SESSION,
			{
				path: "src/a.ts",
				side: "deletions",
				line: 3,
			},
		);
		const load = loader();
		render(
			element(
				{
					load,
				},
				[A],
			),
		);

		await waitFor(() =>
		{
			expect(separatorCount("src/a.ts")).toBe(0);
		});
		expect(load.mock.calls.map(([path]) => path)).toStrictEqual(["src/a.ts"]);
	});

	it("toggles Show whole file and Show changes only from the file menu, with the More button offered", async () =>
	{
		const load = loader();
		render(
			element(
				{
					load,
				},
				[A],
			),
		);
		await waitFor(() =>
		{
			expect(separatorCount("src/a.ts")).toBe(3);
		});
		const more = document.querySelector('[data-diff-file-header="src/a.ts"] button[aria-label="More actions"]');
		const folded = await menuItem("src/a.ts");

		await chooseMenuItem("src/a.ts", "Show whole file");
		await waitFor(() =>
		{
			expect(separatorCount("src/a.ts")).toBe(0);
		});
		const shown = await menuItem("src/a.ts");

		await chooseMenuItem("src/a.ts", "Show changes only");
		await waitFor(() =>
		{
			expect(separatorCount("src/a.ts")).toBeGreaterThan(0);
		});

		expect(
			{
				more: more !== null,
				folded,
				shown,
				calls: load.mock.calls.length,
			},
		).toStrictEqual(
			{
				more: true,
				folded:
				{
					label: "Show whole file",
					disabled: false,
				},
				shown:
				{
					label: "Show changes only",
					disabled: false,
				},
				calls: 1,
			},
		);
	});

	it("locks a file with a finding on Show changes only, and offers nothing for added files or session edits", async () =>
	{
		const added: SessionDiffFile =
		{
			...fileAt("src/new.ts"),
			status: "added",
		};
		const view = render(
			element(
				{
					findings: [FINDING_ON_A],
					load: loader(),
				},
				[A, added],
			),
		);
		const locked = await menuItem("src/a.ts");
		const forAdded = await menuItem("src/new.ts");
		view.unmount();

		render(
			element(
				{
					source: "session-edits",
					load: loader(),
				},
				[B],
			),
		);
		const sessionEdits = await menuItem("src/b.ts");

		expect(
			{
				locked,
				forAdded,
				sessionEdits,
			},
		).toStrictEqual(
			{
				locked:
				{
					label: "Show changes only",
					disabled: true,
				},
				forAdded: null,
				sessionEdits: null,
			},
		);
	});

	it("disables Show whole file once the loader gives up on a drifted file", async () =>
	{
		const load = loader(
			{
				oldText: `${FILE_LINES()}extra\n`,
				newText: FILE_LINES([15, 21]),
			},
		);
		render(
			element(
				{
					load,
				},
				[A],
			),
		);
		await chooseMenuItem("src/a.ts", "Show whole file");
		await waitFor(() =>
		{
			expect(load).toHaveBeenCalledTimes(1);
		});

		await waitFor(async () =>
		{
			expect(await menuItem("src/a.ts")).toStrictEqual(
				{
					label: "Show whole file",
					disabled: true,
				},
			);
		});
	});

	describe("scroll targets (upstream scrollToAnnotation consumers: c44d00c7f yi, of and the card's Ac loop)", () =>
	{
		const scrolled:
		{
			line: string | null;
			options: unknown;
		}[] = [];

		beforeEach(() =>
		{
			scrolled.length = 0;
			// jsdom lays nothing out: every element is visible, and the Changes body scrolls.
			Object.defineProperty(
				HTMLElement.prototype,
				"offsetParent",
				{
					configurable: true,
					get: () => document.body,
				},
			);
			Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown)
			{
				scrolled.push(
					{
						line: this.getAttribute("data-line"),
						options,
					},
				);
			};
		});

		afterEach(() =>
		{
			Reflect.deleteProperty(HTMLElement.prototype, "offsetParent");
			clearDiffScrollTarget(SESSION);
		});

		function makeBodyScroll()
		{
			const scroller = document.querySelector("[data-diff-file-path]")?.closest(".overflow-y-auto");
			if (!(scroller instanceof HTMLElement)) throw new Error("no Changes scroller");
			scroller.style.overflowY = "auto";
			Object.defineProperty(
				scroller,
				"scrollHeight",
				{
					configurable: true,
					value: 5000,
				},
			);
			// A zero-height client box puts every unlaid-out row at its centre, so the loop lands without recentring.
			Object.defineProperty(
				scroller,
				"clientHeight",
				{
					configurable: true,
					value: 0,
				},
			);
		}

		it("shows a file whole to reach a line hidden in a collapsed gap, and clears the target", async () =>
		{
			const load = loader();
			render(
				element(
					{
						load,
					},
					[A, B],
				),
			);
			await waitFor(() =>
			{
				expect(separatorCount("src/b.ts")).toBe(3);
			});

			act(() =>
			{
				scrollToDiffLine(
					SESSION,
					"src/b.ts",
					{
						anchor:
						{
							side: "additions",
							line: 30,
						},
					},
				);
			});
			await waitFor(() =>
			{
				expect(separatorCount("src/b.ts")).toBe(0);
			});

			expect(
				{
					target: diffScrollTarget(SESSION),
					calls: load.mock.calls.map(([path]) => path),
					a: separatorCount("src/a.ts"),
				},
			).toStrictEqual(
				{
					target: undefined,
					calls: ["src/b.ts"],
					a: 3,
				},
			);
		});

		it("centres a shown line without loading the file, again for a repeat request, and expands a collapsed file", async () =>
		{
			const load = loader();
			render(
				element(
					{
						load,
					},
					[A, B],
				),
			);
			await waitFor(() =>
			{
				expect(separatorCount("src/b.ts")).toBe(3);
			});
			makeBodyScroll();
			fireEvent.click(headerButton("src/b.ts"));

			act(() =>
			{
				scrollToDiffLine(
					SESSION,
					"src/b.ts",
					{
						anchor:
						{
							side: "additions",
							line: 21,
						},
					},
				);
			});
			await waitFor(() =>
			{
				expect(scrolled).toStrictEqual([
					{
						line: "21",
						options:
						{
							behavior: "instant",
							block: "center",
						},
					},
				]);
			});
			act(() =>
			{
				scrollToDiffLine(
					SESSION,
					"src/b.ts",
					{
						anchor:
						{
							side: "additions",
							line: 21,
						},
					},
				);
			});
			await waitFor(() =>
			{
				expect(scrolled).toHaveLength(2);
			});

			expect(
				{
					expanded: headerButton("src/b.ts").getAttribute("aria-expanded"),
					separators: separatorCount("src/b.ts"),
					calls: load.mock.calls.length,
				},
			).toStrictEqual(
				{
					expanded: "true",
					separators: 3,
					calls: 0,
				},
			);
		});

		it("resolves a fuzzy path to its one suffix match, and drops an unknown one", async () =>
		{
			const load = loader();
			render(
				element(
					{
						load,
					},
					[A, B],
				),
			);
			await waitFor(() =>
			{
				expect(separatorCount("src/a.ts")).toBe(3);
			});

			act(() =>
			{
				scrollToDiffLine(
					SESSION,
					"nowhere.ts",
					{
						fuzzy: true,
						anchor:
						{
							side: "additions",
							line: 30,
						},
					},
				);
			});
			const unknown = diffScrollTarget(SESSION);
			act(() =>
			{
				scrollToDiffLine(
					SESSION,
					"a.ts",
					{
						fuzzy: true,
						anchor:
						{
							side: "additions",
							line: 30,
						},
					},
				);
			});
			await waitFor(() =>
			{
				expect(separatorCount("src/a.ts")).toBe(0);
			});

			expect(
				{
					unknown,
					target: diffScrollTarget(SESSION),
					b: separatorCount("src/b.ts"),
				},
			).toStrictEqual(
				{
					unknown: undefined,
					target: undefined,
					b: 3,
				},
			);
		});

		it("scrolls an anchorless target's header to the top", async () =>
		{
			render(
				element(
					{
						load: loader(),
					},
					[A, B],
				),
			);
			act(() =>
			{
				scrollToDiffLine(SESSION, "src/b.ts");
			});
			await waitFor(() =>
			{
				expect(scrolled).toStrictEqual([
					{
						line: null,
						options:
						{
							block: "start",
						},
					},
				]);
			});
		});
	});

	it("shows a lazily fetched file whole for a comment on an unmodified line once its patch arrives", async () =>
	{
		const draft = openDiffCommentDraft(
			SESSION,
			{
				path: "src/a.ts",
				side: "additions",
				line: 30,
			},
		);
		saveDiffComment(SESSION, draft, "Fake comment on line 30");
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
		const lazy: SessionDiffFile =
		{
			...A,
			patch: null,
		};
		queryClient.setQueryData(
			sessionDiffFileQueryOptions(SESSION, "branch", "src/a.ts").queryKey,
			{
				scope: "branch",
				root: "/repo",
				file: A,
			},
		);
		const load = loader();
		render(
			<QueryClientProvider client={queryClient}>
				{element(
					{
						load,
						fetchContext:
						{
							sessionId: SESSION,
							scope: "branch",
						},
					},
					[lazy],
				)}
			</QueryClientProvider>,
		);

		await waitFor(() =>
		{
			expect(separatorCount("src/a.ts")).toBe(0);
		});
		expect(
			{
				calls: load.mock.calls.map(([path]) => path),
				menu: await menuItem("src/a.ts"),
			},
		).toStrictEqual(
			{
				calls: ["src/a.ts"],
				menu:
				{
					label: "Show changes only",
					disabled: true,
				},
			},
		);
	});

	it("expands a collapsed file when Show whole file is chosen, and forgets every toggle on a new scope", async () =>
	{
		const load = loader();
		const view = render(
			element(
				{
					load,
				},
				[A],
			),
		);
		fireEvent.click(headerButton("src/a.ts"));
		expect(headerButton("src/a.ts").getAttribute("aria-expanded")).toBe("false");

		await chooseMenuItem("src/a.ts", "Show whole file");
		await waitFor(() =>
		{
			expect(separatorCount("src/a.ts")).toBe(0);
		});
		const expanded = headerButton("src/a.ts").getAttribute("aria-expanded");

		view.rerender(
			element(
				{
					scope: "uncommitted",
					load,
				},
				[A],
			),
		);
		const afterScope = await menuItem("src/a.ts");

		expect(
			{
				expanded,
				afterScope,
			},
		).toStrictEqual(
			{
				expanded: "true",
				afterScope:
				{
					label: "Show whole file",
					disabled: false,
				},
			},
		);
	});
});

describe("ChangesPane review findings bar (upstream c9bd7af9c zw)", () =>
{
	const SESSION = "session-findings-bar";
	const REVIEW = "review-findings-bar";
	const finding = (id: string, extra: Partial<ReviewFinding> = {}): ReviewFinding => (
	{
		id,
		file: "src/greet.ts",
		side: "new",
		line: 2,
		severity: "medium",
		title: `Fake finding ${id}`,
		body: "Fake body.",
		resolved: false,
		...extra,
	});
	const FINDINGS = [
		finding("a"),
		finding(
			"x",
			{
				resolved: true,
			},
		),
		finding(
			"b",
			{
				line: 3,
			},
		),
	];
	const BUNDLE: ReviewBundle =
	{
		reviewId: REVIEW,
		sessionId: SESSION,
		cwd: "/repo",
		diff: GREET_PATCH,
		summary: null,
		findings: FINDINGS,
		generatedAt: "2026-11-16T00:00:00.000Z",
	};

	afterEach(() =>
	{
		clearReviewFindingCursor(SESSION);
		clearDiffScrollTarget(SESSION);
		reviewApi.replace.mockReset();
	});

	function renderReviewPane()
	{
		// The diff hydrates its file through fetch; a failed read retries 2s later, after this file ends, into whatever
		// fetch the next file in a shared worker stubbed. Hold the read open instead: these tests show only the patch.
		vi.stubGlobal("fetch", async () => new Promise<never>(() => {}));
		openReviewInChanges(SESSION, REVIEW);
		const queryClient = new QueryClient(
			{
				defaultOptions:
				{
					queries:
					{
						retry: false,
						staleTime: Infinity,
					},
				},
			},
		);
		queryClient.setQueryData(
			sessionDiffQueryOptions(
				SESSION,
				"uncommitted",
				{
					hideWhitespace: DEFAULTS.diffHideWhitespace,
				},
			).queryKey,
			{
				...diffOf([GREET_FILE]),
				scope: "uncommitted",
			},
		);
		queryClient.setQueryData(sessionDiffScopesQueryOptions(SESSION).queryKey, SCOPES);
		queryClient.setQueryData(reviewQueryOptions(REVIEW).queryKey, BUNDLE);
		return render(
			<QueryClientProvider client={queryClient}>
				<SettingsProvider>
					<ToastProvider>
						<ChangesPane
							sessionId={SESSION}
							cwd="/repo"
							chrome={
							{
								moveHandle: null,
								controls: null,
							}}
						/>
					</ToastProvider>
				</SettingsProvider>
			</QueryClientProvider>,
		);
	}

	function shown(container: HTMLElement)
	{
		return {
			status: container.querySelector('.epitaxy-panel-subheader [role="status"]')?.textContent ?? null,
			cards: [...container.querySelectorAll("[data-review-finding]")].map((card) =>
				card.getAttribute("data-review-finding"),
			),
		};
	}

	it("counts the unresolved findings and moves to the neighbour when the current one is dismissed", async () =>
	{
		reviewApi.replace.mockImplementation(async (_reviewId, findings) =>
			Promise.resolve(
				{
					...BUNDLE,
					findings,
				},
			),
		);
		const {container} = renderReviewPane();
		const before = await waitFor(() =>
		{
			const state = shown(container);
			if (state.status === null) throw new Error("No findings bar yet");
			return state;
		});
		const first = container.querySelector('[data-review-finding="a"]');
		fireEvent.click(
			within(first as HTMLElement).getByRole(
				"button",
				{
					name: "Dismiss finding",
				},
			),
		);
		await waitFor(() =>
		{
			if (reviewApi.replace.mock.calls.length === 0) throw new Error("Not dismissed yet");
		});
		await act(async () =>
		{
			await Promise.resolve();
		});

		expect(
			{
				before,
				body: container.querySelector("[data-diff-pane-body]") !== null,
				after: shown(container),
				current: container.querySelector('[aria-current="true"]')?.getAttribute("data-review-finding"),
				target: diffScrollTarget(SESSION)?.anchor,
			},
		).toStrictEqual(
			{
				before:
				{
					status: "Finding 1 of 2",
					cards: ["a", "b"],
				},
				body: true,
				after:
				{
					status: "Finding 1 of 1",
					cards: ["b"],
				},
				current: "b",
				target:
				{
					side: "additions",
					line: 3,
				},
			},
		);
	});

	it("hides the findings on Close without resolving them until the review is opened again", async () =>
	{
		const {container} = renderReviewPane();
		const close = await screen.findByRole(
			"button",
			{
				name: "Close findings bar",
			},
		);
		fireEvent.click(close);
		const closed = shown(container);
		act(() =>
		{
			openReviewInChanges(SESSION, REVIEW);
		});

		expect(
			{
				closed,
				saved: reviewApi.replace.mock.calls,
				reopened: shown(container),
			},
		).toStrictEqual(
			{
				closed:
				{
					status: null,
					cards: [],
				},
				saved: [],
				reopened:
				{
					status: "Finding 1 of 2",
					cards: ["a", "b"],
				},
			},
		);
	});

	it("inserts the unresolved findings' Apply fixes prompt into the chat input", async () =>
	{
		const inserted: string[] = [];
		const stopComposer = registerComposer(
			SESSION,
			{
				insertText: (text) =>
				{
					inserted.push(text);
				},
				focus: () =>
				{
				},
			},
		);
		renderReviewPane();
		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: "Apply fixes",
				},
			),
		);
		stopComposer();

		expect(inserted).toStrictEqual([
			formatApplyFindingsPrompt(FINDINGS.filter((candidate) => !candidate.resolved)),
		]);
	});
});

describe("ChangesPane transcript review findings (upstream cc8941b7b setReviewFindings on any scope)", () =>
{
	const SESSION = "session-transcript-findings";

	function seed(files: readonly string[])
	{
		const parsed = parseReportFindings(
			{
				findings: files.map((file, index) => (
				{
					file,
					line: index + 2,
					summary: `Fake summary ${index}`,
					failure_scenario: `Fake scenario ${index}`,
					verdict: "CONFIRMED",
				})),
			},
		);
		if (parsed === undefined) throw new Error("unparsed");
		setReviewFindings(
			SESSION,
			toStoreFindings("tool-1", parsed, 1),
			{
				toolId: "tool-1",
			},
		);
	}

	afterEach(() =>
	{
		clearReviewFindings(SESSION, false);
		clearReviewFindingCursor(SESSION);
		clearDiffScrollTarget(SESSION);
		reviewApi.replace.mockReset();
	});

	function renderPane()
	{
		const queryClient = new QueryClient(
			{
				defaultOptions:
				{
					queries:
					{
						retry: false,
						staleTime: Infinity,
					},
				},
			},
		);
		queryClient.setQueryData(
			sessionDiffQueryOptions(
				SESSION,
				"branch",
				{
					hideWhitespace: DEFAULTS.diffHideWhitespace,
				},
			).queryKey,
			diffOf([GREET_FILE]),
		);
		queryClient.setQueryData(sessionDiffScopesQueryOptions(SESSION).queryKey, SCOPES);
		return render(
			<QueryClientProvider client={queryClient}>
				<SettingsProvider>
					<ToastProvider>
						<ChangesPane
							sessionId={SESSION}
							cwd="/repo"
							chrome={
							{
								moveHandle: null,
								controls: null,
							}}
						/>
					</ToastProvider>
				</SettingsProvider>
			</QueryClientProvider>,
		);
	}

	const cards = (container: HTMLElement) =>
		[...container.querySelectorAll("[data-review-finding]")].map((card) =>
			card.getAttribute("data-review-finding"),
		);

	it("shows seeded findings on All changes, fuzzy-matched to diff paths, and dismisses them in the store", async () =>
	{
		seed(["greet.ts", "src/greet.ts"]);
		const {container} = renderPane();
		await waitFor(() =>
		{
			if (cards(container).length === 0) throw new Error("No findings yet");
		});
		const before = cards(container);
		fireEvent.click(
			within(container.querySelector<HTMLElement>('[data-review-finding="finding-tool-1-0"]')!).getByRole(
				"button",
				{
					name: "Dismiss finding",
				},
			),
		);

		expect(
			{
				before,
				after: cards(container),
				saved: reviewApi.replace.mock.calls,
				status: reviewFindingsSnapshot().findingStatusBySession[SESSION],
			},
		).toStrictEqual(
			{
				before: ["finding-tool-1-0", "finding-tool-1-1"],
				after: ["finding-tool-1-1"],
				saved: [],
				status:
				{
					"finding-tool-1-0": "dismissed",
				},
			},
		);
	});

	it("resolves the seeded findings against the scope's files, leaving absent files unanchored", async () =>
	{
		seed(["greet.ts", "z.ts"]);
		renderPane();
		await waitFor(() =>
		{
			if (unanchoredFindingIds(SESSION) === null) throw new Error("Not resolved yet");
		});

		expect(unanchoredFindingIds(SESSION)).toStrictEqual(new Set(["finding-tool-1-1"]));
	});

	it("drops the transcript findings when a working-copy review opens", () =>
	{
		seed(["greet.ts"]);
		openReviewInChanges(SESSION, "review-x");

		expect(reviewFindingsSnapshot().findingsBySession[SESSION]).toBe(undefined);
	});
});

// Upstream `jC` → `FC` → `IC`: the Changes header's PR chip after the scope label, sized by `PC`.
describe("ChangesPane PR chip", () =>
{
	const SESSION = "session-pr-chip";

	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	const URL_56 = "https://github.com/o/r/pull/56";

	function detailWith(prStatus: PrStatus | undefined): SessionDetailData
	{
		return {
			title: "PR chip",
			projectName: "repo",
			projectId: "repo",
			homeRoot: "/users/dev",
			imageRoots: [],
			archived: false,
			summary: null,
			projectPath: "/repo",
			gitBranch: "feature",
			cwd: "/repo",
			gitSha: null,
			gitClean: null,
			messageCount: 1,
			pendingTaskCount: 0,
			viewedState:
			{
				currentMessageIndex: 0,
				lastViewedMessageIndex: 0,
				reviewTargetMessageIndex: 0,
				newMessageCount: 0,
				viewedInCcp: true,
				viewedInHerdr: false,
				viewedAnywhere: true,
			},
			...(prStatus === undefined
				? {}
				:
					{
						prStatus,
					}),
		};
	}

	function renderWithPr(prStatus: PrStatus | undefined)
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
		queryClient.setQueryData(
			sessionDiffQueryOptions(
				SESSION,
				"branch",
				{
					hideWhitespace: DEFAULTS.diffHideWhitespace,
				},
			).queryKey,
			diffOf([GREET_FILE]),
		);
		queryClient.setQueryData(sessionDiffScopesQueryOptions(SESSION).queryKey, SCOPES);
		queryClient.setQueryData(sessionDetailQueryOptions(SESSION).queryKey, detailWith(prStatus));
		return render(
			<QueryClientProvider client={queryClient}>
				<SettingsProvider>
					<ToastProvider>
						<ChangesPane
							sessionId={SESSION}
							cwd="/repo"
							chrome={
							{
								moveHandle: null,
								controls: null,
							}}
						/>
					</ToastProvider>
				</SettingsProvider>
			</QueryClientProvider>,
		);
	}

	const DRAFT_56: PrStatus =
	{
		number: 56,
		state: "draft",
		url: URL_56,
		checks:
		{
			passed: 3,
			failed: 0,
			pending: 0,
		},
	};

	function chipLink(): HTMLElement
	{
		return screen.getByRole(
			"link",
			{
				name: "#56 · Draft",
			},
		);
	}

	function openChipMenu(link: HTMLElement): string[]
	{
		fireEvent.contextMenu(
			link,
			{
				clientX: 10,
				clientY: 10,
			},
		);
		const menu = screen.getByRole("menu");
		return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
			row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? row.textContent),
		);
	}

	it("links the PR with its number and CI glyph in the number state", () =>
	{
		const view = renderWithPr(DRAFT_56);
		const link = chipLink();
		const room = view.container.querySelector("[data-chip-room]");

		expect(
			{
				href: link.getAttribute("href"),
				target: link.getAttribute("target"),
				rel: link.getAttribute("rel"),
				tabIndex: link.getAttribute("tabindex"),
				number: link.querySelector("bdi")?.textContent,
				room: room?.getAttribute("data-chip-room"),
				roomAfterScope: room?.previousElementSibling?.hasAttribute("data-diff-scope-label"),
				ci: screen.getByRole(
					"img",
					{
						name: "CI: all checks passed",
					},
				).className,
			},
		).toStrictEqual(
			{
				href: URL_56,
				target: "_blank",
				rel: "noopener",
				tabIndex: "-1",
				number: "#56",
				room: "number",
				roomAfterScope: true,
				ci: "inline-flex size-5 shrink-0 items-center justify-center",
			},
		);
	});

	it("labels failing and in-progress checks, and hides CI on a merged PR", () =>
	{
		const labels = [
			{
				...DRAFT_56,
				checks:
				{
					passed: 1,
					failed: 1,
					pending: 1,
				},
			},
			{
				...DRAFT_56,
				checks:
				{
					passed: 1,
					failed: 0,
					pending: 1,
				},
			},
			{
				...DRAFT_56,
				state: "merged" as const,
			},
		].map((pr) =>
		{
			const view = renderWithPr(pr);
			const found = screen
				.queryAllByRole("img")
				.map((img) => img.getAttribute("aria-label"))
				.filter((label) => label?.startsWith("CI:"));
			view.unmount();
			return found;
		});

		expect(labels).toStrictEqual([["CI: checks failing"], ["CI: checks in progress"], []]);
	});

	it("renders no chip without an http(s) PR url", () =>
	{
		const {url: _url, ...urlless} = DRAFT_56;
		const views = [
			urlless,
			{
				...DRAFT_56,
				url: "ftp://example.com/56",
			},
			undefined,
		].map((pr) =>
		{
			const view = renderWithPr(pr);
			const room = view.container.querySelector("[data-chip-room]");
			view.unmount();
			return room;
		});

		expect(views).toStrictEqual([null, null, null]);
	});

	// Upstream `vr`/`Og`: Open on GitHub │ Copy link at the pointer; the trigger is marked while the menu is open.
	it("opens Open on GitHub and Copy link from a right-click on the link only", async () =>
	{
		const open = vi.fn<typeof window.open>(() => null);
		vi.stubGlobal("open", open);
		renderWithPr(DRAFT_56);
		const link = chipLink();
		const ciPrevented = !fireEvent.contextMenu(
			screen.getByRole(
				"img",
				{
					name: "CI: all checks passed",
				},
			),
		);
		const menuFromCi = screen.queryByRole("menu");
		const rows = openChipMenu(link);
		const marked = link.closest("[data-popup-open]") !== null;
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Open on GitHub",
				},
			),
		);
		const opened = open.mock.calls;

		clipboard.write.mockResolvedValueOnce(true);
		openChipMenu(link);
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Copy link",
				},
			),
		);
		const toast = await screen.findByText("Link copied to clipboard.");

		expect(
			{
				ciPrevented,
				menuFromCi,
				rows,
				marked,
				opened,
				copied: clipboard.write.mock.calls.at(-1),
				toast: toast.textContent,
			},
		).toStrictEqual(
			{
				ciPrevented: false,
				menuFromCi: null,
				rows: ["Open on GitHub", "─", "Copy link"],
				marked: true,
				opened: [[URL_56, "_blank", "noopener,noreferrer"]],
				copied: [URL_56],
				toast: "Link copied to clipboard.",
			},
		);
	});

	it("stays silent when copying the link fails", async () =>
	{
		renderWithPr(DRAFT_56);
		clipboard.write.mockResolvedValueOnce(false);
		openChipMenu(chipLink());
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Copy link",
				},
			),
		);
		await act(async () =>
		{
			await Promise.resolve();
		});

		expect(screen.queryByText("Link copied to clipboard.")).toBe(null);
	});

	// The gap-y-12 / flex-wrap / overflow-y-clip trick: `none` collapses the room, focus or a popup reopens it.
	it("collapses the room to w-0 in the none state, reopened by focus-visible or an open popup", async () =>
	{
		// No free room in the row and the scope label below its 8rem floor: the fit lands on none.
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement)
		{
			return this.querySelector(":scope > * > [data-chip-room]") === null ? 0 : 200;
		});
		vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement)
		{
			if (this.querySelector(":scope > [data-chip-room]") !== null) return 200;
			return this.hasAttribute("data-diff-scope-label") ? 100 : 0;
		});
		const view = renderWithPr(DRAFT_56);
		const room = () => view.container.querySelector("[data-chip-room]");
		await waitFor(() =>
		{
			expect(room()?.getAttribute("data-chip-room")).toBe("none");
		});

		expect(room()?.className.split(" ")).toEqual(
			expect.arrayContaining([
				"w-0",
				"flex-wrap",
				"gap-y-12",
				"overflow-y-clip",
				"has-[:focus-visible]:w-auto",
				"has-[:focus-visible]:overflow-y-visible",
				"has-[[data-popup-open]]:w-auto",
			]),
		);
	});
});
