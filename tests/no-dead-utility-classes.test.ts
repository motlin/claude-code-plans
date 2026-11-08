import {globSync, readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {loadDesignSystem} from "./helpers/tailwind-design-system";

const stripComments = (code: string) =>
	code.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const SENTINEL = "\u0000";

/** Static class tokens from className literals and `*_CLASS` constants, each with the file:line it came from. */
function collectTokens(): Map<string, string[]> {
	const tokens = new Map<string, string[]>();
	const literal = String.raw`"([^"]*)"|'([^']*)'|\x60([^\x60]*)\x60`;
	const patterns = [
		new RegExp(String.raw`className=(?:"([^"]*)"|\{"([^"]*)"\}|\{'([^']*)'\}|\{\x60([^\x60]*)\x60\})`, "g"),
		new RegExp(String.raw`(?:const|let) [A-Z][A-Z0-9_]*_CLASS(?:ES|NAME)?(?:: [^=]+)? =\s*(?:${literal})`, "g"),
	];
	for (const path of globSync("src/**/*.{ts,tsx}").filter((file) => !file.includes(".test."))) {
		const code = stripComments(readFileSync(path, "utf8"));
		for (const pattern of patterns) {
			for (const match of code.matchAll(pattern)) {
				const body = (match.slice(1) as (string | undefined)[]).find((group) => group !== undefined) ?? "";
				const line = code.slice(0, match.index).split("\n").length;
				const words = body.replaceAll(/\$\{[^}]*\}/g, SENTINEL).split(/\s+/);
				for (const word of words) {
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
function stylesheetClasses(): Set<string> {
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
const ALLOWLIST: Record<string, string> = {
	"draggable-none": "upstream Electron app-region utility; no browser meaning",
	"cc-lined-title-group": HOOK,
	"cds-card-body": HOOK,
	"cds-card-fill": HOOK,
	"cds-user-message-body": HOOK,
	"df-family-handle": HOOK,
	"df-family-stub": HOOK,
	"df-nav-scroll-box": HOOK,
	"df-sortable-section": HOOK,
	"epitaxy-answer-option": HOOK,
	"epitaxy-approval-actions": HOOK,
	"epitaxy-diff": HOOK,
	"epitaxy-reply-flash-accent": HOOK,
	"epitaxy-root": HOOK,
	"epitaxy-status-control": HOOK,
	"mdx-editor-wrapper": HOOK,
	"settings-row-title": HOOK,
	spark: HOOK,
	"usage-band-enter": HOOK,
};

/** Known-dead tokens waiting on a queued task; each must stay dead, so the entry goes once the fix lands. */
const PENDING: Record<string, string> = {};

describe("no dead utility classes", () => {
	it("compiles every static className token and *_CLASS constant, or knows why it doesn't", async () => {
		const designSystem = await loadDesignSystem();
		const tokens = collectTokens();
		const styled = stylesheetClasses();
		const names = [...tokens.keys()];
		const rules = designSystem.candidatesToCss(names);
		const dead: Record<string, string[]> = {};
		const pendingStillDead: Record<string, boolean> = {};
		names.forEach((name, index) => {
			if (rules[index] !== null) return;
			if (/^(group|peer)(\/[\w-]+)?$/.test(name) || styled.has(name) || name in ALLOWLIST) return;
			if (name in PENDING) {
				pendingStillDead[name] = true;
				return;
			}
			dead[name] = tokens.get(name) ?? [];
		});

		expect({
			dead,
			pendingStillDead,
			staleAllowlist: Object.keys(ALLOWLIST).filter((name) => !tokens.has(name)),
		}).toStrictEqual({
			dead: {},
			pendingStillDead: Object.fromEntries(Object.keys(PENDING).map((name) => [name, true])),
			staleAllowlist: [],
		});
	});

	it("loads tw-animate and the custom variants, so the harness itself can tell live from dead", async () => {
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
