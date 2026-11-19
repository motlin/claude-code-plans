import {globSync, readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {loadDesignSystem} from "./helpers/tailwind-design-system";

const stripComments = (code: string) =>
	code.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const SENTINEL = "\u0000";

/** Static class tokens from className literals and `*_CLASS` constants, each with the file:line it came from. */
function collectTokens(): Map<string, string[]>
{
	const tokens = new Map<string, string[]>();
	const literal = String.raw`"([^"]*)"|'([^']*)'|\x60([^\x60]*)\x60`;
	const patterns = [
		new RegExp(String.raw`className=(?:"([^"]*)"|\{"([^"]*)"\}|\{'([^']*)'\}|\{\x60([^\x60]*)\x60\})`, "g"),
		new RegExp(String.raw`(?:const|let) [A-Z][A-Z0-9_]*_CLASS(?:ES|NAME)?(?:: [^=]+)? =\s*(?:${literal})`, "g"),
	];
	for (const path of globSync("src/**/*.{ts,tsx}").filter((file) => !file.includes(".test.")))
	{
		const code = stripComments(readFileSync(path, "utf8"));
		for (const pattern of patterns)
		{
			for (const match of code.matchAll(pattern))
			{
				const body = (match.slice(1) as (string | undefined)[]).find((group) => group !== undefined) ?? "";
				const line = code.slice(0, match.index).split("\n").length;
				const words = body.replaceAll(/\$\{[^}]*\}/g, SENTINEL).split(/\s+/);
				for (const word of words)
				{
					if (word === "" || word.includes(SENTINEL)) continue;
					const sites = tokens.get(word) ?? [];
					if (!sites.includes(`${path}:${line}`)) sites.push(`${path}:${line}`);
					tokens.set(word, sites);
				}
			}
		}
	}
	return tokens;
}

/** Class names that some stylesheet styles by selector, so they are real hooks rather than dead utilities. */
function stylesheetClasses(): Set<string>
{
	const sheets = [
		"src/styles/globals.css",
		"src/styles/file-type-icons.css",
		"src/components/markdown-article.module.css",
	];
	return new Set(
		sheets.flatMap((path) =>
			[...stripComments(readFileSync(path, "utf8")).matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map(
				([, name]) => name ?? "",
			),
		),
	);
}

const HOOK = "test or JS hook mirroring upstream's class name";

/** Tokens that compile to nothing on purpose, each with its reason. */
const ALLOWLIST: Record<string, string> =
{
	"draggable-none": "upstream Electron app-region utility; no browser meaning",
	"cc-lined-title-group": HOOK,
	"cds-card-body": HOOK,
	"cds-card-fill": HOOK,
	"cds-root":
		"upstream's cds portal-root marker (`rx`); local cds tokens live on :root, so the wrapper needs no styles",
	"cds-user-message-body": HOOK,
	"df-chrome-btn": HOOK,
	"df-compact-trigger": HOOK,
	"df-family-stub": HOOK,
	"df-nav-scroll-box": HOOK,
	"df-session-list": HOOK,
	"df-sortable-section": HOOK,
	"epitaxy-markdown-inherit-color":
		"upstream's `.epitaxy-markdown-inherit-color .epitaxy-markdown{color:inherit}`; local inline markdown sets no color",
	"epitaxy-answer-option": HOOK,
	"epitaxy-approval-actions": HOOK,
	"epitaxy-approval-card":
		"upstream's approval card class, which the read gates find the card (and its read-lines) by",
	"epitaxy-approval-body":
		"upstream's approval body class, which the session dock column's short-viewport overscroll rule selects on",
	"epitaxy-approval-read-hint": HOOK,
	"epitaxy-chat-panel": "upstream's chat panel class, which the session outline's gutter variants select on",
	"epitaxy-side-chat": HOOK,
	"epitaxy-code-card": HOOK,
	"epitaxy-diff": HOOK,
	"epitaxy-panel-subheader": HOOK,
	"epitaxy-pill-body": HOOK,
	"epitaxy-pill-body--flat": HOOK,
	"epitaxy-pill-remove": HOOK,
	"epitaxy-rail-lined": HOOK,
	"epitaxy-reply-flash-accent": HOOK,
	"epitaxy-pane-close-control": HOOK,
	"epitaxy-root": HOOK,
	"epitaxy-status-control": HOOK,
	"epitaxy-toc": HOOK,
	"epitaxy-transcript-typography":
		"upstream's transcript typography scope on the sticky prompt bubble's row; its rules reach only descendants the bubble does not have",
	"epitaxy-user-list": "upstream's user prompt list marker class; no shipped stylesheet rule targets it",
	"mdx-editor-wrapper": HOOK,
	"settings-row-title": HOOK,
	spark: HOOK,
	"status-dot":
		"local test hook on the sidebar status Pulse's contents wrapper, read with its data-kind; no rule styles it",
	"tiles-shell": "upstream's tile shell class on the cell that adopts the tile's content host; no rule styles it",
	"usage-band-enter": HOOK,
};

/** Known-dead tokens waiting on a queued task; each must stay dead, so the entry goes once the fix lands. */
const PENDING: Record<string, string> = {};

describe("no dead utility classes", () =>
{
	it("compiles every static className token and *_CLASS constant, or knows why it doesn't", async () =>
	{
		const designSystem = await loadDesignSystem();
		const tokens = collectTokens();
		const styled = stylesheetClasses();
		const names = [...tokens.keys()];
		const rules = designSystem.candidatesToCss(names);
		const dead: Record<string, string[]> = {};
		const pendingStillDead: Record<string, boolean> = {};
		names.forEach((name, index) =>
		{
			if (rules[index] !== null) return;
			if (/^(group|peer)(\/[\w-]+)?$/.test(name) || styled.has(name) || name in ALLOWLIST) return;
			if (name in PENDING)
			{
				pendingStillDead[name] = true;
				return;
			}
			dead[name] = tokens.get(name) ?? [];
		});

		expect(
			{
				dead,
				pendingStillDead,
				staleAllowlist: Object.keys(ALLOWLIST).filter((name) => !tokens.has(name)),
			},
		).toStrictEqual(
			{
				dead: {},
				pendingStillDead: Object.fromEntries(Object.keys(PENDING).map((name) => [name, true])),
				staleAllowlist: [],
			},
		);
	});

	it("loads tw-animate and the custom variants, so the harness itself can tell live from dead", async () =>
	{
		const designSystem = await loadDesignSystem();
		const rules = designSystem.candidatesToCss([
			"animate-in",
			"fade-in-0",
			"group/x",
			"px-3",
			"comfortable:gap-1.5",
		]);

		expect(rules.map((rule) => (rule === null ? null : typeof rule))).toStrictEqual([
			"string",
			"string",
			null,
			"string",
			"string",
		]);
	});
});
