import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

import
{
	ADD_BUTTON_CLASS,
	CHIN_TRIGGER_CLASS,
	COMPOSER_CARD_CLASS,
	COMPOSER_EDITOR_ROW_CLASS,
	ENVIRONMENT_BAR_CLASS,
	ENVIRONMENT_BAR_ROW_CLASS,
	PLACE_CHIP_CLASS,
} from "../src/components/composer-tokens";
import {SESSION_DOCK_COLUMN_CLASS} from "../src/components/dock-tokens";
import {FIZZY_LAKE_PANELS_FINE_POINTER_QUERY} from "../src/lib/fizzy-lake";
import {ruleStart} from "./css-rule";

const styles = readFileSync("src/styles/globals.css", "utf8");

function block(selector: string): string
{
	const start = ruleStart(styles, selector);
	if (start === -1) return "";
	return styles.slice(start, styles.indexOf("}", start));
}

function token(source: string, name: string): string | null
{
	return source.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;
}

const TYPE_TOKENS = [
	"--upstream-text-body",
	"--upstream-leading-body",
	"--density-text-body",
	"--density-leading-body",
	"--upstream-text-footnote",
	"--upstream-leading-footnote",
	"--upstream-text-code",
	"--upstream-leading-code",
	"--upstream-text-caption",
	"--upstream-leading-caption",
	"--upstream-text-prose",
	"--upstream-leading-prose",
	"--upstream-text-heading",
	"--upstream-leading-heading",
] as const;

function typeTokens(source: string): Record<string, string | null>
{
	return Object.fromEntries(TYPE_TOKENS.map((name) => [name, token(source, name)]));
}

describe("density type tokens", () =>
{
	it("uses upstream's comfortable type scale on :root and [data-density=comfortable] and the compact scale under [data-density=compact]", () =>
	{
		const theme = block("@theme inline");
		const compact = block('[data-density="compact"]');
		const comfortable = block('[data-density="comfortable"]');

		expect(
			{
				root: typeTokens(block(":root")),
				comfortable: typeTokens(comfortable),
				comfortableDeclarations: comfortable.match(/--[\w-]+:/g)?.length ?? 0,
				compact: typeTokens(compact),
				compactDeclarations: compact.match(/--[\w-]+:/g)?.length ?? 0,
				caption: token(theme, "--text-caption"),
				captionLeading: token(theme, "--text-caption--line-height"),
			},
		).toStrictEqual(
			{
				root:
				{
					"--upstream-text-body": "14px",
					"--upstream-leading-body": "20px",
					"--density-text-body": "14px",
					"--density-leading-body": "20px",
					"--upstream-text-footnote": "13px",
					"--upstream-leading-footnote": "17px",
					"--upstream-text-code": "13px",
					"--upstream-leading-code": "19px",
					"--upstream-text-caption": "12px",
					"--upstream-leading-caption": "17px",
					"--upstream-text-prose": "16px",
					"--upstream-leading-prose": "24px",
					"--upstream-text-heading": "15px",
					"--upstream-leading-heading": "20px",
				},
				comfortable:
				{
					"--upstream-text-body": "14px",
					"--upstream-leading-body": "20px",
					"--density-text-body": "14px",
					"--density-leading-body": "20px",
					"--upstream-text-footnote": "13px",
					"--upstream-leading-footnote": "17px",
					"--upstream-text-code": "13px",
					"--upstream-leading-code": "19px",
					"--upstream-text-caption": "12px",
					"--upstream-leading-caption": "17px",
					"--upstream-text-prose": "16px",
					"--upstream-leading-prose": "24px",
					"--upstream-text-heading": "15px",
					"--upstream-leading-heading": "20px",
				},
				comfortableDeclarations: 59,
				compact:
				{
					"--upstream-text-body": "13px",
					"--upstream-leading-body": "19px",
					"--density-text-body": "13px",
					"--density-leading-body": "19px",
					"--upstream-text-footnote": "12px",
					"--upstream-leading-footnote": "15px",
					"--upstream-text-code": "12px",
					"--upstream-leading-code": "17px",
					"--upstream-text-caption": "11px",
					"--upstream-leading-caption": "17px",
					"--upstream-text-prose": "14px",
					"--upstream-leading-prose": "20px",
					"--upstream-text-heading": "14px",
					"--upstream-leading-heading": "18px",
				},
				compactDeclarations: 59,
				caption: "var(--upstream-text-caption)",
				captionLeading: "var(--upstream-leading-caption)",
			},
		);
	});
});

describe("control height token", () =>
{
	it("copies upstream's --cds-h-control: 24px compact, 32px comfortable (and on :root), 28px comfortable under panels on a fine pointer, where cds Buttons cap their pad at 9px", () =>
	{
		const mediaStart = styles.indexOf(
			`@media ${FIZZY_LAKE_PANELS_FINE_POINTER_QUERY}\n{\n\t[data-cds-fizzy-lake~="panels"][data-density="comfortable"]`,
		);
		const panels = mediaStart === -1 ? "" : styles.slice(mediaStart, styles.indexOf("}", mediaStart));

		expect(
			{
				root: token(block(":root"), "--cds-h-control"),
				comfortable: token(block('[data-density="comfortable"]'), "--cds-h-control"),
				compact: token(block('[data-density="compact"]'), "--cds-h-control"),
				panelsComfortable: panels.slice(panels.indexOf("{\n\t") + 3),
			},
		).toStrictEqual(
			{
				root: "calc(2rem * var(--cds-rem-scale, 1))",
				comfortable: "calc(2rem * var(--cds-rem-scale, 1))",
				compact: "calc(1.5rem * var(--cds-rem-scale, 1))",
				panelsComfortable:
					'[data-cds-fizzy-lake~="panels"][data-density="comfortable"],\n\t[data-cds-fizzy-lake~="panels"] [data-density="comfortable"]\n\t{\n\t\t--cds-h-control: calc(1.75rem * var(--cds-rem-scale, 1));\n\t\t--cds-button-pad-max: calc(0.5625rem * var(--cds-rem-scale, 1));\n\t',
			},
		);
	});
});

describe("xs control tokens", () =>
{
	it("copies upstream's --xs control and type tokens at every density and maps the whole scale in every [data-size=xs] subtree", () =>
	{
		const scale = (source: string) => (
		{
			height: token(source, "--cds-h-control--xs"),
			radius: token(source, "--cds-radius--xs"),
			nested: token(source, "--cds-h-control-nested--xs"),
			icon: token(source, "--cds-icon--xs"),
			switch: token(source, "--cds-switch-h--xs"),
			caption: token(source, "--upstream-text-caption--xs"),
			body: token(source, "--upstream-text-body--xs"),
			prose: token(source, "--upstream-text-prose--xs"),
			bodyLeading: token(source, "--upstream-leading-body--xs"),
			proseLeading: token(source, "--upstream-leading-prose--xs"),
		});
		const comfortableScale =
		{
			height: "calc(1.5rem * var(--cds-rem-scale, 1))",
			radius: "0.375rem",
			nested: "calc(1.125rem * var(--cds-rem-scale, 1))",
			icon: "calc(1rem * var(--cds-rem-scale, 1))",
			switch: "calc(1rem * var(--cds-rem-scale, 1))",
			caption: "calc(0.6875rem * var(--cds-rem-scale, 1))",
			body: "calc(0.8125rem * var(--cds-rem-scale, 1))",
			prose: "0.875rem",
			bodyLeading: "calc(1.1875rem * var(--cds-rem-scale, 1))",
			proseLeading: "1.25rem",
		};
		const declarations = (source: string) =>
			[...source.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value]);
		const panelsFineStart = styles.indexOf(
			`@media ${FIZZY_LAKE_PANELS_FINE_POINTER_QUERY}\n{\n\t[data-cds-fizzy-lake~="panels"]\n`,
		);
		const panelsFine =
			panelsFineStart === -1 ? "" : styles.slice(panelsFineStart, styles.indexOf("\n}\n", panelsFineStart));

		expect(
			{
				root: scale(block(":root")),
				comfortable: scale(block('[data-density="comfortable"]')),
				compact: scale(block('[data-density="compact"]')),
				xs: declarations(block('[data-size="xs"]')),
				panelsFine: declarations(panelsFine),
				scopedRules: [
					'[data-cds="MessageActions"][data-size="xs"]',
					'[data-view-tab-bar] [data-size="xs"]',
					'[data-cds="MessageAttachmentsQuote"][data-variant="row"] [data-size="xs"]',
				].filter((selector) => ruleStart(styles, selector) !== -1),
			},
		).toStrictEqual(
			{
				root: comfortableScale,
				comfortable: comfortableScale,
				compact:
				{
					height: "calc(1.25rem * var(--cds-rem-scale, 1))",
					radius: "0.3125rem",
					nested: "calc(1rem * var(--cds-rem-scale, 1))",
					icon: "calc(0.75rem * var(--cds-rem-scale, 1))",
					switch: "calc(0.875rem * var(--cds-rem-scale, 1))",
					caption: "calc(0.625rem * var(--cds-rem-scale, 1))",
					body: "calc(0.75rem * var(--cds-rem-scale, 1))",
					prose: "0.8125rem",
					bodyLeading: "calc(1.0625rem * var(--cds-rem-scale, 1))",
					proseLeading: "1.1875rem",
				},
				xs: [
					["--upstream-radius", "var(--cds-radius--xs)"],
					["--cds-h-control", "var(--cds-h-control--xs)"],
					["--cds-h-control-nested", "var(--cds-h-control-nested--xs)"],
					["--cds-icon", "var(--cds-icon--xs)"],
					["--cds-pad-xs", "var(--cds-pad-xs--xs)"],
					["--cds-pad-sm", "var(--cds-pad-sm--xs)"],
					["--cds-pad-md", "var(--cds-pad-md--xs)"],
					["--cds-pad-lg", "var(--cds-pad-lg--xs)"],
					["--cds-pad-xl", "var(--cds-pad-xl--xs)"],
					["--upstream-text-caption", "var(--upstream-text-caption--xs)"],
					["--upstream-text-body", "var(--upstream-text-body--xs)"],
					["--upstream-text-prose", "var(--upstream-text-prose--xs)"],
					["--upstream-leading-body", "var(--upstream-leading-body--xs)"],
					["--upstream-leading-prose", "var(--upstream-leading-prose--xs)"],
					["--cds-checkbox", "var(--cds-checkbox--xs, 1rem)"],
					["--cds-checkbox-glyph", "var(--cds-checkbox-glyph--xs, 1rem)"],
					["--cds-checkbox-radius", "0.25rem"],
					["--cds-switch-h", "var(--cds-switch-h--xs)"],
				],
				panelsFine: [
					["--cds-button-pad-max--xs", "calc(0.375rem * var(--cds-rem-scale, 1))"],
					["--cds-h-control", "var(--cds-h-control--xs)"],
					["--cds-button-pad-max", "var(--cds-button-pad-max--xs)"],
				],
				scopedRules: [],
			},
		);
	});
});

describe("checkbox tokens", () =>
{
	it("copies upstream's --cds-checkbox and --cds-checkbox-radius: 16px / 4px on the base and compact, 20px / 5px comfortable", () =>
	{
		const pair = (source: string) => (
		{
			size: token(source, "--cds-checkbox"),
			radius: token(source, "--cds-checkbox-radius"),
			glyph: token(source, "--cds-checkbox-glyph"),
			xs: token(source, "--cds-checkbox--xs"),
			xsGlyph: token(source, "--cds-checkbox-glyph--xs"),
		});

		expect(
			{
				base: pair(block("@theme")),
				compact: pair(block('[data-density="compact"]')),
				comfortable: pair(block('[data-density="comfortable"]')),
				xsScope: pair(block('[data-size="xs"]')),
			},
		).toStrictEqual(
			{
				base:
				{
					size: "1rem",
					radius: "0.25rem",
					glyph: "1rem",
					xs: null,
					xsGlyph: null,
				},
				compact:
				{
					size: "1rem",
					radius: "0.25rem",
					glyph: null,
					xs: "0.875rem",
					xsGlyph: "0.875rem",
				},
				comfortable:
				{
					size: "1.25rem",
					radius: "0.3125rem",
					glyph: null,
					xs: "1rem",
					xsGlyph: "1rem",
				},
				xsScope:
				{
					size: "var(--cds-checkbox--xs, 1rem)",
					radius: "0.25rem",
					glyph: "var(--cds-checkbox-glyph--xs, 1rem)",
					xs: null,
					xsGlyph: null,
				},
			},
		);
	});
});

describe("density sidebar geometry", () =>
{
	// Upstream `Us()` defaults the web sidebar to comfortable; the 26px compact rows are the desktop app's default only.
	it("locks the web sidebar geometry tokens on :root at upstream's comfortable values", () =>
	{
		const root = block(":root");
		const names = [
			"--sb-row-h",
			"--sb-row-font",
			"--sb-group-font",
			"--sb-icon",
			"--sb-leading-slot",
			"--sb-row-ctl",
			"--sb-row-gap",
			"--sb-group-pt",
			"--sb-radius",
		];

		expect(Object.fromEntries(names.map((name) => [name, token(root, name)]))).toStrictEqual(
			{
				"--sb-row-h": "32px",
				"--sb-row-font": "14px",
				"--sb-group-font": "13px",
				"--sb-icon": "20px",
				"--sb-leading-slot": "28px",
				"--sb-row-ctl": "24px",
				"--sb-row-gap": "4px",
				"--sb-group-pt": "0px",
				"--sb-radius": "8px",
			},
		);
	});

	/* Upstream `.dframe-root[data-variant="web"] .dframe-sidebar-body [data-row] { margin-bottom: var(--df-row-stack-gap) }`: a 34px nav pitch. */
	it("spaces every sidebar-body row by one 2px stack gap, leaving the nav row class without its own margin", () =>
	{
		expect(
			{
				rows: token(block("\n[data-nav-block] [data-row]:not(.df-search-field)"), "margin-bottom"),
				navRow: token(block("\n\t.df-nav-row"), "margin-bottom"),
			},
		).toStrictEqual(
			{
				rows: "var(--sb-row-stack-gap)",
				navRow: null,
			},
		);
	});

	it("bands desktop group labels with upstream's df-session-list tokens: 18px web band margin + row-height band, 2px stack, 8px iconless pad", () =>
	{
		const root = block(":root");
		const names = [
			"--sb-row-stack-gap",
			"--sb-group-band-mt",
			"--sb-group-band-h",
			"--sb-group-pt",
			"--sb-group-label-pb",
			"--sb-group-pb",
			"--sb-iconless-pad",
		];

		expect(Object.fromEntries(names.map((name) => [name, token(root, name)]))).toStrictEqual(
			{
				"--sb-row-stack-gap": "2px",
				"--sb-group-band-mt": "calc(var(--sb-group-pt-token) + 4px - var(--sb-row-stack-gap))",
				"--sb-group-band-h": "var(--sb-row-h)",
				"--sb-group-pt": "0px",
				"--sb-group-label-pb": "0px",
				"--sb-group-pb": "var(--sb-row-stack-gap)",
				"--sb-iconless-pad": "8px",
			},
		);
	});

	it("insets group labels by the row padding plus upstream's iconless pad (10px), as .df-label-inset", () =>
	{
		expect(token(block("\n.df-label-inset").replaceAll(/\s+/g, " "), "padding-left")).toBe(
			"calc(var(--sb-row-px) + var(--sb-iconless-pad, calc((var(--sb-leading-slot) - var(--sb-icon)) / 2)))",
		);
	});
});

describe("described session rows", () =>
{
	function declarations(selector: string): Record<string, string>
	{
		return Object.fromEntries(
			[
				...block(`\n${selector}`)
					.slice(selector.length + 3)
					.matchAll(/([\w-]+):\s*([^;]+);/g),
			].map((match) => [match[1], match[2]?.replaceAll(/\s+/g, " ").replace("( ", "(").replace(" )", ")")]),
		);
	}

	it("adds upstream's described tuck/trim tokens on :root and the 24px described line on the phone sheet", () =>
	{
		const root = block(":root");
		const sheet = block("\n.phone-sheet");
		expect(
			{
				tuck: token(root, "--sb-described-tuck"),
				trim: token(root, "--sb-described-trim"),
				rootLine: token(root, "--sb-described-line"),
				phoneLine: token(sheet, "--sb-described-line"),
			},
		).toStrictEqual(
			{
				tuck: "4px",
				trim: "calc(var(--sb-described-tuck) / 2)",
				rootLine: null,
				phoneLine: "24px",
			},
		);
	});

	it("copies upstream's .df-described-row, .df-row-description and .df-meta-line rules", () =>
	{
		expect(
			{
				row: declarations(".df-described-row"),
				lines: declarations(".df-described-title,\n.df-row-description"),
				description: declarations(".df-row-description"),
				metaLine: declarations(".df-meta-line"),
				metaLineRtl: declarations('.df-meta-line:where(:root[dir="rtl"] :dir(rtl))'),
			},
		).toStrictEqual(
			{
				row:
				{
					"padding-block":
						"calc((var(--sb-row-h) - var(--sb-row-ctl)) / 2 + var(--sb-described-tuck) - var(--sb-described-trim))",
					"row-gap": "2px",
				},
				lines:
				{
					height: "calc(var(--sb-described-line, var(--sb-row-ctl)) - var(--sb-described-tuck))",
				},
				description:
				{
					"font-size": "var(--sb-group-font)",
					"line-height": "16px",
					gap: "6px",
				},
				metaLine:
				{
					overflow: "clip",
					"padding-inline-end": "12px",
					"mask-image": "linear-gradient(90deg, #000 calc(100% - 12px), transparent)",
				},
				metaLineRtl:
				{
					"mask-image": "linear-gradient(270deg, #000 calc(100% - 12px), transparent)",
				},
			},
		);
	});

	it("centres a described row's decoration and kebab on the title line, as upstream's described top", () =>
	{
		expect(declarations("[data-described] :is([data-row-decoration], [data-row-action])")).toStrictEqual(
			{
				top: "calc(var(--sb-row-h) / 2 + var(--sb-described-tuck) / 2 - var(--sb-described-trim))",
			},
		);
	});
});

describe("density variants", () =>
{
	it("defines compact: and comfortable: variants keyed on the nearest [data-density] scope", () =>
	{
		const variants = Object.fromEntries(
			[...styles.matchAll(/@custom-variant (compact|comfortable) \((.+)\);/g)].map((match) => [
				match[1],
				match[2],
			]),
		);

		expect(variants).toStrictEqual(
			{
				compact:
					'&:where([data-density="compact"] *):not(:where([data-density="compact"] [data-density="comfortable"] *):not(:where([data-density="compact"] [data-density="comfortable"] [data-density="compact"] *):not(:where([data-density="compact"] [data-density="comfortable"] [data-density="compact"] [data-density="comfortable"] *))))',
				comfortable:
					'&:where([data-density="comfortable"] *):not(:where([data-density="comfortable"] [data-density="compact"] *):not(:where([data-density="comfortable"] [data-density="compact"] [data-density="comfortable"] *):not(:where([data-density="comfortable"] [data-density="compact"] [data-density="comfortable"] [data-density="compact"] *))))',
			},
		);
	});
});

describe("main-column comfortable variants", () =>
{
	it("opens the dock column gap to 8px at comfortable, and pads the environment bar by viewport, not density, as upstream", () =>
	{
		const comfortable = (classes: string) => classes.split(" ").filter((name) => name.startsWith("comfortable:"));

		expect(
			{
				dock: comfortable(SESSION_DOCK_COLUMN_CLASS),
				bar: ENVIRONMENT_BAR_CLASS,
			},
		).toStrictEqual(
			{
				dock: ["comfortable:gap-2"],
				bar: "@container flex w-full min-w-0 flex-col pt-0.5 -mb-0.5 md:pt-0 md:mb-0",
			},
		);
	});
});

describe("composer comfortable variants", () =>
{
	it("flips the composer to upstream's comfortable literals: 8px card gap, 32px editor insets, 8px Add and env-pill radii, 6px chin-pill radius and an 8px place-label gap", () =>
	{
		const comfortable = (classes: string) => classes.split(" ").filter((name) => name.startsWith("comfortable:"));

		expect(
			{
				card: comfortable(COMPOSER_CARD_CLASS),
				editorRow: comfortable(COMPOSER_EDITOR_ROW_CLASS),
				add: comfortable(ADD_BUTTON_CLASS),
				chinTrigger: comfortable(CHIN_TRIGGER_CLASS),
				envRow: comfortable(ENVIRONMENT_BAR_ROW_CLASS),
				placeChip: comfortable(PLACE_CHIP_CLASS),
			},
		).toStrictEqual(
			{
				card: ["comfortable:gap-y-2"],
				editorRow: ["comfortable:pr-[32px]", "comfortable:pl-[32px]"],
				add: ["comfortable:rounded-r6"],
				chinTrigger: ["comfortable:rounded-r5"],
				envRow: ["comfortable:[&_button]:rounded-r6"],
				placeChip: ["comfortable:gap-2"],
			},
		);
	});
});
