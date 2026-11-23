// @vitest-environment jsdom

import {cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {InlineDiff} from "../src/components/tool-renderers/inline-diff";
import {EditRenderer} from "../src/components/tool-renderers/edit-renderer";
import {WriteRenderer} from "../src/components/tool-renderers/write-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";
import {OA, SA, WA} from "../src/components/changes/diffs-config";
import {TOKEN_FONT_CSS} from "../src/lib/code-tile";
import type {PatchHunk} from "../src/lib/diff-utils";

class FakeResizeObserver
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
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

function toolCall(name: string, input: Record<string, unknown>, patch?: PatchHunk[]): ClientToolCall
{
	return {
		id: "tool-call-64",
		name,
		input,
		param: "",
		result: "ok",
		sourceUuid: "source-64",
		...(patch === undefined
			? {}
			:
				{
					resultMeta:
					{
						patch,
					},
				}),
	};
}

function shadowRoots(container: HTMLElement): ShadowRoot[]
{
	return [...container.querySelectorAll("diffs-container")].map((host) =>
	{
		if (!host.shadowRoot) throw new Error("diffs-container has no shadow root yet");
		return host.shadowRoot;
	});
}

interface InlineDiffMarkup
{
	rows: string[];
	numbers: string[];
	pre: Record<string, string | boolean | null>;
	hasLibraryHeader: boolean;
}

function inlineDiffMarkup(root: ShadowRoot): InlineDiffMarkup
{
	const pre = root.querySelector("pre[data-diff]");
	if (!pre) throw new Error("no rendered <pre> yet");
	return {
		rows: [...root.querySelectorAll("[data-content] > *")].map((row) =>
			row.hasAttribute("data-separator")
				? "separator"
				: `${row.getAttribute("data-line-type")}:${row.textContent}`,
		),
		numbers: [...root.querySelectorAll("[data-gutter] [data-line-number-content]")].map((cell) => cell.textContent),
		pre:
		{
			diffType: pre.getAttribute("data-diff-type"),
			overflow: pre.getAttribute("data-overflow"),
			indicators: pre.getAttribute("data-indicators"),
			disableLineNumbers: pre.hasAttribute("data-disable-line-numbers"),
		},
		hasLibraryHeader: root.querySelector("[data-diffs-header]") !== null,
	};
}

interface PureSideMarkup
{
	lines: string[];
	diff: boolean;
	sign: string | null;
	excerpt: boolean;
	tint: string | undefined;
	base: string;
	gapStyle: string | undefined;
	rails: string;
}

/** Upstream's live pure-side sheet before the tint (2026-11-22): `Fx`, the token font rules, then the bidi rule. */
const PURE_SIDE_BASE_CSS =
	'[data-file] { letter-spacing: calc(round(up, 1ch, 1px / 64) - 1ch); font-feature-settings: "liga", "clig", "calt"; } [data-line] { min-height: 1lh; } [data-code] { padding-bottom: var(--diffs-gap-block, var(--diffs-gap-fallback)); overflow: clip; } ' +
	TOKEN_FONT_CSS +
	"[data-line] { unicode-bidi: var(--epitaxy-file-line-bidi, revert); }";

const RAIL_VARS =
	":host{--diff-rail-added:light-dark(color-mix(in lab,var(--diffs-addition-base) 86%,black),color-mix(in lab,var(--diffs-addition-base) 80%,var(--diffs-bg)));--diff-rail-removed:light-dark(color-mix(in lab,var(--diffs-deletion-base) 90%,black),color-mix(in lab,var(--diffs-deletion-base) 76%,white))}";
const RAIL_BOX = 'content:"";position:absolute;left:0;width:6px;top:0;bottom:0;pointer-events:none';
const RAIL_FORCED_COLORS =
	"@media (forced-colors:active){[data-column-number]::after{forced-color-adjust:none;--diff-rail-added:CanvasText;--diff-rail-removed:CanvasText}}";

/** Upstream's `ES` pure-side view: a `File` (no `data-diff`) tinted one side, its sign drawn before each number. */
function pureSideMarkup(container: HTMLElement): PureSideMarkup
{
	const [root] = shadowRoots(container);
	const pre = root?.querySelector("pre[data-file]");
	if (!root || !pre?.querySelector("[data-line]")) throw new Error("no rendered file yet");
	const css = [...root.querySelectorAll("style")].map((style) => style.textContent).join("");
	const unsafe = (root.querySelector("style[data-unsafe-css]")?.textContent ?? "").replace(
		/^[^]*?@layer unsafe\s*\{\s*/,
		"",
	);
	return {
		lines: [...root.querySelectorAll("[data-content] > [data-line]")].map((line) => line.textContent),
		diff: pre.hasAttribute("data-diff"),
		sign: /\[data-line-number-content\]::before\{content:"([^"]*)"/.exec(css)?.[1] ?? null,
		excerpt: css.includes("[data-line-number-content]{visibility:hidden;}"),
		tint: container.querySelector<HTMLElement>("[data-pure-side]")?.style.background,
		base: unsafe.slice(0, unsafe.indexOf("[data-line]{background:")),
		gapStyle: container
			.querySelector<HTMLElement>("[data-cds=FileDiff]")
			?.style.getPropertyValue("--diffs-gap-style"),
		rails: css.slice(
			css.indexOf(":host{--diff-rail-added"),
			css.indexOf(RAIL_FORCED_COLORS) + RAIL_FORCED_COLORS.length,
		),
	};
}

describe("inline Edit/Write diffs render with @pierre/diffs", () =>
{
	// Upstream _a keeps --diffs-line-height: var(--cds-leading-code) unless a caller passes metrics.lineHeight (ca7ba268c za).
	it("reads the scope's density code tokens on the host rather than a fixed 12/17", async () =>
	{
		const hostVars = (container: HTMLElement) =>
			[...container.querySelectorAll<HTMLElement>("[data-cds=FileDiff]")].map((host) => (
			{
				size: host.style.getPropertyValue("--diffs-font-size"),
				leading: host.style.getPropertyValue("--diffs-line-height"),
			}));
		const {container} = render(
			<>
				<div data-density="comfortable">
					<InlineDiff filePath="/test/alice.ts" oldStr="const alice = 1;" newStr="const alice = 2;" />
				</div>
				<div data-density="compact">
					<InlineDiff filePath="/test/alice.ts" oldStr="const bob = 1;" newStr="const bob = 2;" />
				</div>
			</>,
		);
		const tokens =
		{
			size: "var(--code-size, var(--upstream-text-code))",
			leading: "var(--code-leading, var(--upstream-leading-code))",
		};
		await waitFor(() =>
		{
			expect(hostVars(container)).toStrictEqual([tokens, tokens]);
		});
	});

	it("injects upstream's za() list led by Sa (header disabled) and paints the transcript's surface-1 background", async () =>
	{
		const {container} = render(
			<InlineDiff filePath="/test/alice.ts" oldStr="const alice = 1;" newStr="const alice = 2;" />,
		);
		await waitFor(() =>
		{
			const [root] = shadowRoots(container);
			const text = [...(root?.querySelectorAll("style") ?? [])].map((style) => style.textContent).join("");
			const layer = text.slice(text.indexOf("@layer unsafe"));
			const host = container.querySelector<HTMLElement>("[data-cds=FileDiff]");
			expect(
				{
					leadsWithSa: layer.replace(/^@layer unsafe\s*\{\s*/, "").startsWith(SA + WA),
					oa: layer.includes(OA),
					bg: host?.style.getPropertyValue("--cds-filediff-bg"),
				},
			).toStrictEqual(
				{
					leadsWithSa: true,
					oa: true,
					bg: "var(--cds-surface-1)",
				},
			);
		});
	});

	// Upstream c81f2e888 transcript FileDiff: ne() = Q(true, false), merged into style + onPostRender.
	it("adopts upstream's rails sheet and marks change runs, never with data-add-button", async () =>
	{
		const {container} = render(
			<InlineDiff
				filePath="/test/alice.ts"
				oldStr={"const alice = 1;\nconst bob = 1;\nconst carol = 1;"}
				newStr={"const alice = 2;\nconst bob = 1;\nconst carol = 2;"}
			/>,
		);
		await waitFor(() =>
		{
			const host = container.querySelector("diffs-container");
			const [root] = shadowRoots(container);
			if (!root) throw new Error("no shadow root");
			const wrapper = container.querySelector<HTMLElement>("[data-cds=FileDiff]");
			expect(
				{
					rails: root.adoptedStyleSheets.some((sheet) =>
						[...sheet.cssRules].some((rule) => rule.cssText.includes("--diff-rail-added")),
					),
					marks: [...root.querySelectorAll("[data-gutter] > [data-line-type]")].map((row) =>
						[
							row.getAttribute("data-line-type"),
							row.hasAttribute("data-rail-start") ? "start" : "",
							row.hasAttribute("data-rail-end") ? "end" : "",
						]
							.filter(Boolean)
							.join(":"),
					),
					addButton: host?.hasAttribute("data-add-button"),
					word: wrapper?.style.getPropertyValue("--diff-word-removed"),
				},
			).toStrictEqual(
				{
					rails: true,
					marks: [
						"change-deletion:start",
						"change-addition:end",
						"context",
						"change-deletion:start",
						"change-addition:end",
					],
					addButton: false,
					word: '"removed"',
				},
			);
		});
	});

	it("renders an Edit as a unified, wrapped diff with no file header", async () =>
	{
		const {container} = render(
			<EditRenderer
				toolCall={toolCall(
					"Edit",
					{
						file_path: "/test/alice.ts",
						old_string: "const alice = 100;\nconst bob = 1;",
						new_string: "const alice = 200;\nconst bob = 1;",
					},
				)}
			/>,
		);

		await waitFor(() =>
		{
			expect(shadowRoots(container).map(inlineDiffMarkup)).toStrictEqual([
				{
					rows: [
						"change-deletion:const alice = 100;",
						"change-addition:const alice = 200;",
						"context:const bob = 1;",
					],
					numbers: ["1", "1", "2"],
					pre:
					{
						diffType: "single",
						overflow: "wrap",
						indicators: "classic",
						disableLineNumbers: true,
					},
					hasLibraryHeader: false,
				},
			]);
		});
		expect(container.querySelector(".diff-tailwindcss-wrapper")).toBe(null);
	});

	it("numbers an Edit's diff from its result's real hunks", async () =>
	{
		const {container} = render(
			<EditRenderer
				toolCall={toolCall(
					"Edit",
					{
						file_path: "/test/alice.ts",
						old_string: "const alice = 100;",
						new_string: "const alice = 200;",
					},
					[
						{
							oldStart: 26,
							oldLines: 2,
							newStart: 26,
							newLines: 2,
							lines: ["-const alice = 100;", "+const alice = 200;", " const bob = 1;"],
						},
					],
				)}
			/>,
		);

		await waitFor(() =>
		{
			expect(shadowRoots(container).map(inlineDiffMarkup)).toStrictEqual([
				{
					rows: [
						"change-deletion:const alice = 100;",
						"change-addition:const alice = 200;",
						"context:const bob = 1;",
					],
					numbers: ["26", "26", "27"],
					pre:
					{
						diffType: "single",
						overflow: "wrap",
						indicators: "classic",
						disableLineNumbers: false,
					},
					hasLibraryHeader: false,
				},
			]);
		});
	});

	it("draws every hunk of a two-hunk patch with a separator between them", async () =>
	{
		const {container} = render(
			<EditRenderer
				toolCall={toolCall(
					"Edit",
					{
						file_path: "/test/alice.ts",
						old_string: "x",
						new_string: "y",
						replace_all: true,
					},
					[
						{
							oldStart: 3,
							oldLines: 1,
							newStart: 3,
							newLines: 1,
							lines: ["-x", "+y"],
						},
						{
							oldStart: 40,
							oldLines: 2,
							newStart: 40,
							newLines: 2,
							lines: [" a", "-x", "+y", "\\ No newline at end of file"],
						},
					],
				)}
			/>,
		);

		await waitFor(() =>
		{
			const [markup] = shadowRoots(container).map(inlineDiffMarkup);
			expect(
				{
					rows: markup?.rows,
					numbers: markup?.numbers,
				},
			).toStrictEqual(
				{
					rows: [
						"change-deletion:x",
						"change-addition:y",
						"separator",
						"context:a",
						"change-deletion:x",
						"change-addition:y",
					],
					numbers: ["3", "3", "40", "41", "41"],
				},
			);
		});
	});

	it("renders a MultiEdit as one unnumbered diff, its edits joined by a … row", async () =>
	{
		const {container} = render(
			<EditRenderer
				toolCall={toolCall(
					"MultiEdit",
					{
						file_path: "/test/alice.ts",
						edits: [
							{
								old_string: "a",
								new_string: "b",
							},
							{
								old_string: "c",
								new_string: "d",
							},
						],
					},
				)}
			/>,
		);

		await waitFor(() =>
		{
			expect(shadowRoots(container).map((root) => inlineDiffMarkup(root))).toStrictEqual([
				{
					rows: [
						"change-deletion:a",
						"change-addition:b",
						"context:…",
						"change-deletion:c",
						"change-addition:d",
					],
					numbers: ["1", "1", "2", "3", "3"],
					pre:
					{
						diffType: "single",
						overflow: "wrap",
						indicators: "classic",
						disableLineNumbers: true,
					},
					hasLibraryHeader: false,
				},
			]);
		});
	});

	it("renders a MultiEdit with a matching patch as one diff numbered from the patch", async () =>
	{
		const {container} = render(
			<EditRenderer
				toolCall={toolCall(
					"MultiEdit",
					{
						file_path: "/test/alice.ts",
						edits: [
							{
								old_string: "a",
								new_string: "b",
							},
							{
								old_string: "c",
								new_string: "d",
							},
						],
					},
					[
						{
							oldStart: 12,
							oldLines: 3,
							newStart: 12,
							newLines: 3,
							lines: ["-a", "+b", " x", "-c", "+d"],
						},
					],
				)}
			/>,
		);

		await waitFor(() =>
		{
			expect(shadowRoots(container).map((root) => inlineDiffMarkup(root).numbers)).toStrictEqual([
				["12", "12", "13", "14", "14"],
			]);
		});
	});

	it("renders a Write update with a matching patch as the real diff against the old file", async () =>
	{
		const {container} = render(
			<WriteRenderer
				toolCall={toolCall(
					"Write",
					{
						file_path: "/test/alice.ts",
						content: "new\n",
					},
					[
						{
							oldStart: 1,
							oldLines: 1,
							newStart: 1,
							newLines: 1,
							lines: ["-old", "+new"],
						},
					],
				)}
			/>,
		);

		await waitFor(() =>
		{
			expect(shadowRoots(container).map(inlineDiffMarkup)).toStrictEqual([
				{
					rows: ["change-deletion:old", "change-addition:new"],
					numbers: ["1", "1"],
					pre:
					{
						diffType: "single",
						overflow: "wrap",
						indicators: "classic",
						disableLineNumbers: false,
					},
					hasLibraryHeader: false,
				},
			]);
		});
	});

	it("renders a new file's Write as upstream's pure-additions file view, numbers shown", async () =>
	{
		const {container} = render(
			<WriteRenderer
				toolCall={toolCall(
					"Write",
					{
						file_path: "/test/alice.ts",
						content: "a\nb",
					},
				)}
			/>,
		);

		await waitFor(() =>
		{
			expect(pureSideMarkup(container)).toStrictEqual(
				{
					lines: ["a", "b"],
					diff: false,
					sign: "+ ",
					excerpt: false,
					tint: undefined,
					base: PURE_SIDE_BASE_CSS,
					gapStyle: "",
					// Upstream cb6930dae Vd("additions"), appended after the sign rule.
					rails: [
						RAIL_VARS,
						'[data-line-number-content]::before{content:"+ " / "added";opacity:var(--diff-sign-opacity,0)}',
						"@media (forced-colors:active),(prefers-contrast:more){[data-line-number-content]::before{opacity:1}}",
						":is([data-line],[data-column-number]){background:light-dark(color-mix(in lab,var(--diffs-bg) 88%,var(--diffs-addition-base)),color-mix(in lab,var(--diffs-bg) 85%,var(--diffs-addition-base)))}",
						"[data-column-number]{border-color:transparent;color:var(--cds-text-secondary)}",
						`[data-column-number]::after{${RAIL_BOX};background:var(--diff-rail-added)}`,
						RAIL_FORCED_COLORS,
					].join(""),
				},
			);
		});
		expect(container.querySelector(".diff-tailwindcss-wrapper")).toBe(null);
	});

	it("renders an Edit that only deletes as a pure-deletions excerpt with its numbers hidden", async () =>
	{
		const {container} = render(
			<EditRenderer
				toolCall={toolCall(
					"Edit",
					{
						file_path: "/test/alice.ts",
						old_string: "x\n",
						new_string: "",
					},
				)}
			/>,
		);

		await waitFor(() =>
		{
			expect(pureSideMarkup(container)).toStrictEqual(
				{
					lines: ["x"],
					diff: false,
					sign: "− ",
					excerpt: true,
					tint: undefined,
					base: PURE_SIDE_BASE_CSS,
					gapStyle: "",
					// Upstream cb6930dae Vd("deletions"): U+2212, the 90%/82% mix and the striped rail.
					rails: [
						RAIL_VARS,
						'[data-line-number-content]::before{content:"\u2212 " / "removed";opacity:var(--diff-sign-opacity,0)}',
						"@media (forced-colors:active),(prefers-contrast:more){[data-line-number-content]::before{opacity:1}}",
						":is([data-line],[data-column-number]){background:light-dark(color-mix(in lab,var(--diffs-bg) 90%,var(--diffs-deletion-base)),color-mix(in lab,var(--diffs-bg) 82%,var(--diffs-deletion-base)))}",
						"[data-column-number]{border-color:transparent;color:var(--cds-text-secondary)}",
						`[data-column-number]::after{${RAIL_BOX};background:linear-gradient(135deg,var(--diff-rail-removed) 25%,transparent 25% 50%,var(--diff-rail-removed) 50% 75%,transparent 75%) 0 0/calc(var(--diffs-line-height,20px) / 4) calc(var(--diffs-line-height,20px) / 4)}`,
						RAIL_FORCED_COLORS,
					].join(""),
				},
			);
		});
	});
});
