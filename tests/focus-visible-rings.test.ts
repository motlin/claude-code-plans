import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.tsx?$/.test(name) ? [path] : [];
	});
}

describe("focus rings", () => {
	it("rings rows and buttons only on keyboard focus, as upstream's focus-visible rings do", () => {
		const offenders = sources("src").filter((path) =>
			/(?<![\w-])focus:ring-focus\b/.test(readFileSync(path, "utf8")),
		);

		expect({
			offenders,
			fileResult: readFileSync("src/components/file-search-results.tsx", "utf8").includes(
				"hover:bg-surface-0/50 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus",
			),
		}).toStrictEqual({offenders: [], fileResult: true});
	});
});

const SHADOW_FOCUS = "hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";
const INSET_FOCUS =
	"hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),inset_0_0_6px_1px_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)]";
const ROW_FOCUS =
	"hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)]";

describe("hand-rolled focus rings", () => {
	it("draws every keyboard ring with upstream's shadow-focus instead of hand-rolled outlines and rings", () => {
		const banned =
			/focus-visible:(?:shadow-\[0_0_0_2px_var\(--(?:color-)?accent-100\)\]|ring-[12](?![\w/[-])|ring-accent-100|ring-\[var\(--accent-100\)\]|outline-2|outline-offset-2|outline-accent-100|ring-inset)/;
		// Upstream's approval card root draws its own 1px fill-accent outline, offset 2px.
		const approvalCardRoot =
			"focus-visible:outline-1 focus-visible:outline-fill-accent focus-visible:outline-offset-2";
		// Upstream's screenshot thumbnails (shared-13 `Q8`) draw a 2px fill-accent ring, measured rgb(42,120,214).
		const screenshotThumb = "focus-visible:ring-2 focus-visible:ring-fill-accent";
		const offenders = sources("src").filter((path) =>
			banned.test(readFileSync(path, "utf8").replaceAll(approvalCardRoot, "").replaceAll(screenshotThumb, "")),
		);
		expect(offenders).toStrictEqual([]);
	});

	it("hides focus outlines with outline-hidden so forced-colors mode keeps a transparent ring", () => {
		const offenders = sources("src").filter((path) =>
			readFileSync(path, "utf8").includes("focus-visible:outline-none"),
		);
		expect(offenders).toStrictEqual([]);
	});

	it("gives the overlapping feature controls upstream's ring recipes", () => {
		const has = (path: string, needle: string) => readFileSync(path, "utf8").includes(needle);
		expect({
			titlebar: has(
				"src/components/session-titlebar.tsx",
				`text-primary select-none hover:bg-fill-ghost-hover ${SHADOW_FOCUS}`,
			),
			chevron: has(
				"src/components/session-titlebar.tsx",
				`text-secondary transition-colors hover:bg-fill-ghost-hover ${SHADOW_FOCUS} data-[popup-open]`,
			),
			segmented: has(
				"src/components/settings/segmented-control.tsx",
				`transition-shadow duration-[60ms] hover:text-primary ${SHADOW_FOCUS}`,
			),
			switch: has("src/components/settings/switch.tsx", `data-[disabled]:opacity-40 ${SHADOW_FOCUS}`),
			messageActions: has(
				"src/components/message-actions.tsx",
				`text-ink-muted outline-none ${SHADOW_FOCUS} transition-colors`,
			),
			customizeView: has(
				"src/components/customize/list-row.tsx",
				`absolute inset-0 rounded-card ${SHADOW_FOCUS}`,
			),
			skillKebab: has(
				"src/components/customize/skill-row-actions.tsx",
				`hover:bg-fill-ghost-hover ${SHADOW_FOCUS}`,
			),
			pluginKebab: has(
				"src/components/customize/plugin-row-actions.tsx",
				`hover:bg-fill-ghost-hover ${SHADOW_FOCUS}`,
			),
			shortcutsScroller: has("src/components/keyboard-shortcuts-dialog.tsx", `px-6 pb-6 ${INSET_FOCUS}`),
			terminalPane: has(
				"src/components/panes/terminal-pane.tsx",
				`rounded-b-[inherit] outline-none ${INSET_FOCUS}`,
			),
			groupLabel: has("src/components/sidebar/session-group-section.tsx", `text-left ${ROW_FOCUS}`),
			sessionRow: has(
				"src/components/sidebar/session-group-section.tsx",
				`\${rowClass} text-secondary ${ROW_FOCUS} data-[selected=focused]:text-primary`,
			),
			overflowRow: has(
				"src/components/sidebar/session-group-section.tsx",
				`\${ROW_CLASS} text-ink-muted ${ROW_FOCUS} hover:bg-[var(--sb-hover)]`,
			),
		}).toStrictEqual({
			titlebar: true,
			chevron: true,
			segmented: true,
			switch: true,
			messageActions: true,
			customizeView: true,
			skillKebab: true,
			pluginKebab: true,
			shortcutsScroller: true,
			terminalPane: true,
			groupLabel: true,
			sessionRow: true,
			overflowRow: true,
		});
	});
});

describe("sidebar nav row focus ring", () => {
	it("rings nav rows and the account trigger with upstream's inset row ring instead of a hover background", () => {
		const css = readFileSync("src/styles/globals.css", "utf8");
		const has = (path: string, needle: string) => readFileSync(path, "utf8").includes(needle);
		expect({
			cssBackgroundRule: /\.df-nav-row:focus-visible\s*\{/.test(css),
			navLink: has("src/components/sidebar/Sidebar.tsx", `rounded-[var(--sb-radius)] ${ROW_FOCUS}"`),
			newRow: has(
				"src/components/sidebar/new-session-row.tsx",
				`rounded-[var(--sb-radius)] flex-1 ${ROW_FOCUS} `,
			),
			moreRow: has("src/components/sidebar/more-menu.tsx", `rounded-[var(--sb-radius)] flex-1 ${ROW_FOCUS} `),
			fallbackRow: has(
				"src/components/app-shell-fallback.tsx",
				`rounded-[var(--sb-radius)] flex-1 ${ROW_FOCUS}"`,
			),
			accountMenu: has("src/components/sidebar/account-menu.tsx", `pr-2 pl-0.5 text-left ${ROW_FOCUS} hover:`),
			accountMenuBackground: has("src/components/sidebar/account-menu.tsx", "focus-visible:bg-"),
		}).toStrictEqual({
			cssBackgroundRule: false,
			navLink: true,
			newRow: true,
			moreRow: true,
			fallbackRow: true,
			accountMenu: true,
			accountMenuBackground: false,
		});
	});
});

describe("upstream base focus ring", () => {
	const css = readFileSync("src/styles/globals.css", "utf8");

	it("keeps hide-focus-ring as a pure opt-out marker with no rules of its own", () => {
		expect(/\.hide-focus-ring\s*[{,]/.test(css)).toBe(false);
	});

	it("rings bare links, buttons and fields on focus-visible unless they opt out", () => {
		const base = css.slice(css.indexOf("@layer base {"));
		const match = base.match(
			/(a:not\(\[role="menuitem"\]\):not\(\.hide-focus-ring\):focus-visible,\s*button:not\(\[role="menuitem"\]\):not\(\.hide-focus-ring\):focus-visible,\s*input:not\(\.hide-focus-ring\):not\(\.cds-input\):focus-visible,\s*textarea:not\(\.hide-focus-ring\):not\(\.cds-input\):focus-visible,\s*\.can-focus:focus-visible,\s*\.can-focus-within:focus-within)\s*\{([^}]*)\}/,
		);
		expect(
			match?.[2]
				?.split(";")
				.map((d) => d.trim())
				.filter(Boolean),
		).toStrictEqual([
			"outline: 2px solid var(--focus-outline-color)",
			"outline-offset: 2px",
			"transition: outline 0.2s !important",
		]);
	});

	it("colours the base ring with upstream --accent-100 in light and dark", () => {
		expect([...css.matchAll(/--focus-outline-color:\s*([^;]+);/g)].map((m) => m[1])).toStrictEqual([
			"hsl(213.117 67.5439% 44.7059%)",
			"hsl(212.466 75.2577% 61.9608%)",
		]);
	});

	it("draws ring-focus as upstream's shadow-focus box-shadow", () => {
		const body = css.match(/@utility ring-focus\s*\{([^}]*)\}/)?.[1];
		expect(
			body
				?.split(";")
				.map((d) => d.trim())
				.filter(Boolean),
		).toStrictEqual(["box-shadow: var(--focus-shadow)", "outline-style: none"]);
	});
});

describe("upstream focus shadow tokens", () => {
	const css = readFileSync("src/styles/globals.css", "utf8");
	const values = (name: string) => [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))].map((m) => m[1]);

	it("defines --focus-shadow and --focus-shadow-danger with upstream's inner page ring in light and dark", () => {
		expect({
			focus: values("--focus-shadow"),
			danger: values("--focus-shadow-danger"),
			utility: values("--shadow-focus-danger"),
		}).toStrictEqual({
			focus: [
				"inset 0 0 0 1px #fcfcfb, 0 0 0 1px #2a78d6, 0 0 6px 1px #cde2fb",
				"inset 0 0 0 1px var(--upstream-page), 0 0 0 1px #2a78d6, 0 0 6px 1px rgb(24 79 149 / 0.6)",
			],
			danger: [
				"inset 0 0 0 1px #fcfcfb, 0 0 0 1px #d03b3b, 0 0 6px 1px #fad6d6",
				"inset 0 0 0 1px var(--upstream-page), 0 0 0 1px #d03b3b, 0 0 6px 1px rgb(142 38 38 / 0.6)",
			],
			utility: ["var(--focus-shadow-danger)"],
		});
	});
});
