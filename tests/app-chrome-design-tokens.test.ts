import {globSync, readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {loadDesignSystem} from "./helpers/tailwind-design-system";
import {ruleStart} from "./css-rule";

/** A `text-`, `bg-`, or `border-` utility, its arbitrary value and opacity modifier included. */
const COLOUR_PREFIXED_UTILITY =
	/(?<![\w\-[./])(?:text|bg|border)-[a-z][\w-]*(?:\[[^\]\s]*\])?(?:\/(?:\d+|\[[^\]\s]*\]))?/g;

/**
 * CSS names that are not classes: the property names mermaid-svg-audit.ts refuses in a drawing's styles, and the
 * `box-sizing` value inline styles set.
 */
const CSS_PROPERTY_NAMES = new Set(["text-transform", "text-orientation", "text-combine", "border-box"]);

const RETIRED_CHROME_UTILITY = /(?:text-text|bg-bg|border-border)-[A-Za-z0-9]+|rounded-\[[0-9]+px\]/g;

describe("app chrome design tokens", () =>
{
	it("does not use the retired numeric palette or ad-hoc pixel radii", () =>
	{
		const violations = Object.fromEntries(
			globSync("src/**/*.{css,ts,tsx}").flatMap((path) =>
			{
				const matches = [...readFileSync(path, "utf8").matchAll(RETIRED_CHROME_UTILITY)].map(
					([utility]) => utility,
				);
				return matches.length === 0 ? [] : [[path, matches]];
			}),
		);

		expect(violations).toStrictEqual({});
	});

	it("gives every text-, bg-, and border- utility in src a rule, so no colour class names an undefined token", async () =>
	{
		const designSystem = await loadDesignSystem();
		const cssClasses = new Set(
			globSync("src/**/*.css").flatMap((path) =>
				[...readFileSync(path, "utf8").matchAll(/\.([a-z][\w-]*)/g)].map(([, name]) => name),
			),
		);
		const utilities = globSync("src/**/*.{ts,tsx}").flatMap((path) =>
		{
			const code = readFileSync(path, "utf8")
				.replaceAll(/\/\*[\s\S]*?\*\//g, "")
				.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
			// A name followed by `:` is a CSS declaration inside an injected stylesheet string, not a class.
			return [...code.matchAll(COLOUR_PREFIXED_UTILITY)]
				.filter(
					({0: utility, index}) => code[index + utility.length] !== ":" && !CSS_PROPERTY_NAMES.has(utility),
				)
				.map(([utility]) => (
				{
					path,
					utility,
				}));
		});
		const rules = designSystem.candidatesToCss(utilities.map(({utility}) => utility));
		const violations: Record<string, string[]> = {};
		utilities.forEach(({path, utility}, index) =>
		{
			if (rules[index] === null && !cssClasses.has(utility)) (violations[path] ??= []).push(utility);
		});

		expect(violations).toStrictEqual({});
	});

	it("washes the user bubble and inline-code chip in the cds-era 5% alpha layer", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const light = styles.slice(ruleStart(styles, ":root"), ruleStart(styles, ".dark"));
		const dark = styles.slice(ruleStart(styles, ".dark"));
		const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;

		expect(
			{
				lightBubble: token(light, "--user-msg-bg"),
				darkBubble: token(dark, "--user-msg-bg"),
				lightAlpha: token(light, "--upstream-alpha-1"),
				darkAlpha: token(dark, "--upstream-alpha-1"),
			},
		).toStrictEqual(
			{
				lightBubble: "var(--upstream-alpha-1)",
				darkBubble: "var(--upstream-alpha-1)",
				lightAlpha: "rgb(11 11 11 / 0.05)",
				darkAlpha: "rgb(255 255 255 / 0.05)",
			},
		);
	});

	it("shadows the dark chat card and side panes with upstream's measured shadow-panel-sm", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const dark = styles.slice(ruleStart(styles, ".dark"));

		expect(dark.match(/--pane-shadow:\s*([^;]+);/)?.[1]).toBe(
			"0 1px 2px rgba(11, 11, 11, 0.06), 0 2px 8px rgba(0, 0, 0, 0.24)",
		);
	});

	it("rings and lifts the Session-files jump popover with upstream's cds shadow-panel", async () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const designSystem = await loadDesignSystem();
		const light = styles.slice(ruleStart(styles, ":root"), ruleStart(styles, ".dark"));
		const dark = styles.slice(ruleStart(styles, ".dark"));
		const fizzyLightStart = ruleStart(styles, ':root[data-cds-fizzy-lake~="color"]');
		const fizzyDarkStart = ruleStart(styles, ':root.dark[data-cds-fizzy-lake~="color"]');
		const fizzyLight = styles.slice(fizzyLightStart, styles.indexOf("\n}", fizzyLightStart));
		const fizzyDark = styles.slice(fizzyDarkStart, styles.indexOf("\n}", fizzyDarkStart));
		const token = (block: string, name: string) =>
			block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.replaceAll(/\s+/g, " ") ?? null;
		const [rule] = designSystem.candidatesToCss(["shadow-panel"]);

		expect(
			{
				rule: rule?.split("@property")[0]?.replaceAll(/\s+/g, " ").trim() ?? null,
				utility: token(styles, "--shadow-panel"),
				light: token(light, "--upstream-shadow-panel"),
				dark: token(dark, "--upstream-shadow-panel"),
				fizzyLight: token(fizzyLight, "--upstream-shadow-panel"),
				fizzyDark: token(fizzyDark, "--upstream-shadow-panel"),
			},
		).toStrictEqual(
			{
				rule: ".shadow-panel { --tw-shadow: var(--upstream-shadow-panel); box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow); }",
				utility: "var(--upstream-shadow-panel)",
				light: "inset 0 0 0 0 rgb(11 11 11 / 0.1), 0 0 0 1px rgb(11 11 11 / 0.1), 0 8px 24px #0000001f, 0 2px 6px #00000014",
				dark: "inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 0 0 0 rgb(255 255 255 / 0.1), 0 8px 24px #00000052, 0 2px 6px #0003",
				fizzyLight: "inset 0 0 0 0 #00000014, 0 0 0 1px #00000014, 0 8px 24px #0000001f, 0 2px 6px #00000014",
				fizzyDark: "inset 0 0 0 1px #ffffff0a, 0 0 0 0 #ffffff0a, 0 8px 24px #00000052, 0 2px 6px #0003",
			},
		);
	});

	it("floats the phone session-rail card on upstream's measured shadow-panel-md", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const light = styles.slice(ruleStart(styles, ":root"), ruleStart(styles, ".dark"));
		const dark = styles.slice(ruleStart(styles, ".dark"));
		const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;

		expect(
			{
				utility: token(styles, "--shadow-panel-md"),
				light: token(light, "--panel-md-shadow"),
				dark: token(dark, "--panel-md-shadow"),
			},
		).toStrictEqual(
			{
				utility: "var(--panel-md-shadow)",
				light: "0 0 0 1px rgb(11 11 11 / 0.1), 0 2px 4px 0 rgb(11 11 11 / 0.07), 0 6px 16px 0 rgb(11 11 11 / 0.08)",
				dark: "inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 2px 4px 0 rgb(11 11 11 / 0.07), 0 6px 16px 0 rgb(0 0 0 / 0.24)",
			},
		);
	});

	it("inks the home Needs input pill in upstream's text-warning", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const light = styles.slice(ruleStart(styles, ":root"), ruleStart(styles, ".dark"));
		const dark = styles.slice(ruleStart(styles, ".dark"));
		const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;

		expect(
			{
				utility: token(styles, "--color-upstream-warning"),
				light: token(light, "--upstream-warning"),
				dark: token(dark, "--upstream-warning"),
			},
		).toStrictEqual(
			{
				utility: "var(--upstream-warning)",
				light: "rgb(115 69 0)",
				// Measured on claude.ai/code: dark text-warning computes to rgb(219, 147, 0).
				dark: "rgb(219 147 0)",
			},
		);
	});

	it("draws no New-row icon circle: upstream's stylesheets have no rule containing new-icon", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");

		expect(
			{
				circleRules: styles.includes("new-icon"),
				circleToken: styles.includes("--sb-new-circle"),
			},
		).toStrictEqual(
			{
				circleRules: false,
				circleToken: false,
			},
		);
	});
	it("paints a selected nav row's leading icon upstream's text-primary, as data-[selected=focused]:[&_.df-leading-slot]:text-primary does", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
		const leadingSlotColors = [...styles.matchAll(/([^{}]*\.df-leading-slot)\s*\{\s*color:\s*([^;]+);/g)].map(
			([, selector, color]) => [selector?.trim().replace(/\s+/g, " "), color],
		);
		const fizzy = ':root[data-cds-fizzy-lake~="color"] .dframe-sidebar';
		const newRow = readFileSync("src/components/sidebar/new-session-row.tsx", "utf8");

		expect(
			{
				leadingSlotColors,
				newRowOwnSelectedRule: newRow.includes("data-[selected=focused]:[&_.df-leading-slot]:text-primary"),
			},
		).toStrictEqual(
			{
				leadingSlotColors: [
					[".df-nav-row .df-leading-slot", "var(--upstream-text-secondary)"],
					['.df-nav-row[data-selected="focused"] .df-leading-slot', "var(--upstream-text-primary)"],
					/* fizzy-sidebar-color-inks T2: icons rest at the fizzy secondary, inherit on interaction, nav rows primary. */
					[`${fizzy} .df-leading-slot`, "var(--sb-icon-rest)"],
					[
						[
							`${fizzy} :is(.group, [data-row]):focus-visible .df-leading-slot`,
							`${fizzy} :is(.group, [data-row]):has(:focus-visible) .df-leading-slot`,
							`${fizzy} [data-menu-open="true"] .df-leading-slot`,
							`${fizzy} [data-context-menu-open="true"] .df-leading-slot`,
							`${fizzy} [data-selected] .df-leading-slot`,
							`${fizzy} [data-editing] .df-leading-slot`,
							`${fizzy} [data-edit-box] .df-leading-slot`,
						].join(", "),
						"inherit",
					],
					[`${fizzy} :is(.group, [data-row]):hover .df-leading-slot`, "inherit"],
					[`${fizzy} [data-row-nav] .df-leading-slot`, "var(--upstream-text-primary)"],
				],
				newRowOwnSelectedRule: false,
			},
		);
	});
	it("holds the sidebar placeholder rows back 0.5s and fades them in, as upstream's df-placeholder-rows does", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replaceAll(/\s+/g, " ");
		const rules = [...styles.matchAll(/([^{}]*(?:df-placeholder|data-placeholder-label)[^{}]*)\{([^}]*)\}/g)]
			.map(([, selector, body]) => [selector?.trim(), body?.trim()])
			.filter(([selector]) => selector?.startsWith("@keyframes") !== true);

		expect(
			{
				keyframes: styles.match(/@keyframes df-placeholder-fade \{ 0% \{[^}]*\} \}/)?.[0],
				rules,
			},
		).toStrictEqual(
			{
				keyframes: "@keyframes df-placeholder-fade { 0% { opacity: 0; } }",
				rules: [
					[
						".df-placeholder-rows",
						"animation: df-placeholder-fade 0.15s ease-out var(--placeholder-reveal-delay, 0.5s) backwards;",
					],
					[".df-placeholder-rows", "animation-duration: 0s;"],
					[
						"[data-placeholder-continues] .df-placeholder-rows, .df-placeholder-rows[data-placeholder-continues]",
						"animation: none;",
					],
					[".df-session-list [data-placeholder-label]", "margin-bottom: var(--sb-row-stack-gap);"],
					[".df-session-list .df-placeholder-rows > [data-row]", "margin-bottom: var(--sb-row-stack-gap);"],
				],
			},
		);
	});
	it("holds a delayed SkeletonGroup back 0.5s and fades it in, at once under reduced motion", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replaceAll(/\s+/g, " ");
		const delayedRules = [...styles.matchAll(/([^{}]*\[data-hold="delayed"\][^{}]*)\{([^}]*)\}/g)].map(
			([, selector, body]) => [selector?.trim(), body?.trim()],
		);

		expect(
			{
				keyframes: styles.match(/@keyframes placeholder-reveal \{ 0% \{[^}]*\} \}/)?.[0],
				delayedRules,
			},
		).toStrictEqual(
			{
				keyframes: "@keyframes placeholder-reveal { 0% { opacity: 0; } }",
				delayedRules: [
					[
						'[data-palette-skeleton][data-hold="delayed"][data-motion="wave"] [data-skeleton]',
						"animation-delay: calc(var(--placeholder-reveal-delay, 0.5s) + 0.15s + var(--skel-i, 0) * 90ms);",
					],
					[
						'[data-cds="SkeletonGroup"][data-hold="delayed"]',
						"animation: placeholder-reveal 0.15s ease-out var(--placeholder-reveal-delay, 0.5s) backwards;",
					],
					['[data-cds="SkeletonGroup"][data-hold="delayed"]', "animation-duration: 0.01ms;"],
					[
						'html[data-reduce-motion="true"] [data-cds="SkeletonGroup"][data-hold="delayed"]',
						"animation-duration: 0.01ms;",
					],
				],
			},
		);
	});
});
