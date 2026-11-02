// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {cleanup, render, screen} from "@testing-library/react";
import {createElement, use} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {CodeTile, CommandCodeTile} from "../src/components/code-tile";
import {CODE_TILE_CSS, normalizeTileCode} from "../src/lib/code-tile";
import {tileLanguage} from "../src/lib/code-tile-language";
import {DEFAULT_CODE_THEMES} from "../src/lib/code-themes";

/** Props each pierre `File` received, newest last; the stub draws a bare `diffs-container`, or suspends. */
const recorded = vi.hoisted(() => (
{
	file: [] as Record<string, unknown>[],
	suspend: false,
	never: new Promise<never>(() => {}),
}));

vi.mock("@pierre/diffs/react", async (importOriginal) =>
{
	const actual = await importOriginal<typeof import("@pierre/diffs/react")>();
	return {
		...actual,
		File: (props: Record<string, unknown>) =>
		{
			if (recorded.suspend) use(recorded.never);
			recorded.file.push(props);
			return createElement(
				"diffs-container",
				{
					"data-testid": "file",
				},
			);
		},
	};
});

const ROOT_CLASS = "epitaxy-diff epitaxy-code-card rounded-lg flex overflow-clip px-md py-xs text-code";
const GLOBALS_CSS = resolve(__dirname, "..", "src", "styles", "globals.css");

afterEach(() =>
{
	cleanup();
	recorded.file.length = 0;
	recorded.suspend = false;
});

/** The tile root, once the lazily loaded pierre `File` has replaced the held text. */
async function tileRoot(): Promise<HTMLElement>
{
	const file = await screen.findByTestId("file");
	const root = file.closest<HTMLElement>(".epitaxy-code-card");
	if (root === null) throw new Error("no tile root");
	return root;
}

describe("normalizeTileCode (upstream c5071af19 `J`)", () =>
{
	it("drops one trailing newline and shows a lone carriage return as ␍", () =>
	{
		expect([
			normalizeTileCode("ls\n"),
			normalizeTileCode("a\r\n"),
			normalizeTileCode("a\rb"),
			normalizeTileCode("a\n\n"),
		]).toStrictEqual(["ls", "a", "a␍b", "a\n"]);
	});
});

describe("tileLanguage (upstream c476e9be4 `D`)", () =>
{
	it("trims, lowercases, maps aliases and falls back to text", () =>
	{
		expect([
			tileLanguage(" Bash "),
			tileLanguage("pwsh"),
			tileLanguage(""),
			tileLanguage("ansi"),
			tileLanguage("not-a-language"),
		]).toStrictEqual(["bash", "powershell", "text", "ansi", "text"]);
	});
});

describe("CODE_TILE_CSS (upstream `Qc`)", () =>
{
	it("turns ligatures on, snaps letter-spacing to 1/64px and carries the token weight skip rules", () =>
	{
		expect(
			{
				ligatures: CODE_TILE_CSS.includes('font-feature-settings: "liga", "clig", "calt";'),
				snap: CODE_TILE_CSS.includes("letter-spacing: calc(round(up, 1ch, 1px / 64) - 1ch);"),
				leading: CODE_TILE_CSS.includes(
					"--diffs-line-height: var(--code-leading, var(--upstream-leading-code));",
				),
				mono: CODE_TILE_CSS.includes("--diffs-font-family: var(--font-mono);"),
				weight: CODE_TILE_CSS.includes(
					'[data-line] span[style*="-font-weight"]{font-weight:var(--code-font-skip-dark,var(--diffs-token-dark-font-weight,inherit)) var(--code-font-skip-light,var(--diffs-token-light-font-weight,inherit))}',
				),
				noFontStyle: CODE_TILE_CSS.includes("-font-style"),
			},
		).toStrictEqual(
			{
				ligatures: true,
				snap: true,
				leading: true,
				mono: true,
				weight: true,
				noFontStyle: false,
			},
		);
	});

	it("has globals.css pick the token weight per mode on every diffs-container, as upstream's [data-mode] rules do", () =>
	{
		const css = readFileSync(GLOBALS_CSS, "utf8");
		expect(
			{
				dark: /\.dark diffs-container\s*\{\s*--code-font-skip-light: ;\s*--code-font-skip-dark: initial;\s*\}/.test(
					css,
				),
				light: /:root:not\(\.dark\) diffs-container\s*\{\s*--code-font-skip-dark: ;\s*--code-font-skip-light: initial;\s*\}/.test(
					css,
				),
			},
		).toStrictEqual(
			{
				dark: true,
				light: true,
			},
		);
	});
});

describe("CommandCodeTile (upstream `tl` > `el`)", () =>
{
	it("draws the prompt gutter, the File column and passes upstream's File props", async () =>
	{
		render(<CommandCodeTile command={"git status\n"} />);
		const root = await tileRoot();
		expect(
			{
				className: root.className,
				dir: root.getAttribute("dir"),
				childCount: root.children.length,
				gutter: root.children[0]?.outerHTML,
				column: root.children[1]?.className,
				file: recorded.file.at(-1),
			},
		).toStrictEqual(
			{
				className: ROOT_CLASS,
				dir: "ltr",
				childCount: 2,
				gutter: '<span aria-hidden="true" data-find-omitted="" class="select-none text-secondary">$&nbsp;</span>',
				column: "min-w-0 flex-1",
				file:
				{
					file:
					{
						name: "cmd",
						contents: "git status",
						lang: "bash",
						cacheKey: "bashtool:bash:git status\n",
					},
					options:
					{
						theme: DEFAULT_CODE_THEMES,
						themeType: "light",
						disableFileHeader: true,
						disableLineNumbers: true,
						overflow: "wrap",
						unsafeCSS: CODE_TILE_CSS,
					},
					disableWorkerPool: true,
				},
			},
		);
	});

	it("uses the > gutter for PowerShell", async () =>
	{
		render(<CommandCodeTile command="Get-ChildItem" lang="powershell" />);
		const root = await tileRoot();
		expect(root.children[0]?.textContent).toBe("> ");
	});

	it("holds the plain normalized text in the File's place until pierre is ready", () =>
	{
		recorded.suspend = true;
		const {container} = render(<CommandCodeTile command={"a\rb\n"} />);
		const held = container.querySelector(".epitaxy-code-card > .min-w-0 > span");
		expect(
			{
				className: held?.className,
				text: held?.textContent,
			},
		).toStrictEqual(
			{
				className: "whitespace-pre-wrap break-words",
				text: "a␍b",
			},
		);
	});
});

describe("CodeTile (upstream `el`)", () =>
{
	it("puts an action after the code and drops dir=ltr for prose", async () =>
	{
		render(<CodeTile code="# Title" lang="markdown" prose action={<button type="button">c</button>} />);
		const root = await tileRoot();
		expect(
			{
				dir: root.getAttribute("dir"),
				children: [...root.children].map((child) => child.className),
				action: root.children[1]?.innerHTML,
			},
		).toStrictEqual(
			{
				dir: null,
				children: ["min-w-0 flex-1", "flex h-[1lh] shrink-0 items-center"],
				action: '<button type="button">c</button>',
			},
		);
	});
});
