import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

function block(selector: string): string {
	const start = styles.indexOf(`${selector} {`);
	if (start === -1) return "";
	return styles.slice(start, styles.indexOf("\n}", start));
}

function tokens(source: string, names: readonly string[]): Record<string, string | null> {
	return Object.fromEntries(
		names.map((name) => [
			name,
			source.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.replaceAll(/\s+/g, " ") ?? null,
		]),
	);
}

const THEME_TOKENS = [
	"--color-fill-secondary",
	"--color-fill-secondary-hover",
	"--color-fill-secondary-ring",
	"--color-fill-danger",
	"--color-fill-danger-hover",
	"--color-on-danger",
	"--shadow-field-drop",
] as const;

const UPSTREAM_TOKENS = [
	"--upstream-fill-secondary",
	"--upstream-fill-secondary-hover",
	"--upstream-fill-secondary-ring",
	"--upstream-fill-danger",
	"--upstream-fill-danger-hover",
] as const;

describe("split-button colour tokens (upstream cds SplitDropdownButton)", () => {
	it("maps the theme utilities onto the upstream variables", () => {
		expect(tokens(block("@theme inline"), THEME_TOKENS)).toStrictEqual({
			"--color-fill-secondary": "var(--upstream-fill-secondary)",
			"--color-fill-secondary-hover": "var(--upstream-fill-secondary-hover)",
			"--color-fill-secondary-ring": "var(--upstream-fill-secondary-ring)",
			"--color-fill-danger": "var(--upstream-fill-danger)",
			"--color-fill-danger-hover": "var(--upstream-fill-danger-hover)",
			"--color-on-danger": "#fff",
			"--shadow-field-drop": "0 1px 2px rgb(0 0 0 / 0.05)",
		});
	});

	it("defines the light values", () => {
		expect(tokens(block(":root"), UPSTREAM_TOKENS)).toStrictEqual({
			"--upstream-fill-secondary": "#ffffff1a",
			"--upstream-fill-secondary-hover": "hsl(0 0% 4% / 0.05)",
			"--upstream-fill-secondary-ring": "hsl(0 0% 4% / 0.1)",
			"--upstream-fill-danger": "#d03b3b",
			"--upstream-fill-danger-hover": "#e34948",
		});
	});

	it("defines the dark values", () => {
		expect(tokens(block(".dark"), UPSTREAM_TOKENS)).toStrictEqual({
			"--upstream-fill-secondary": "hsl(0 0% 100% / 0.1)",
			"--upstream-fill-secondary-hover": "hsl(0 0% 100% / 0.14)",
			"--upstream-fill-secondary-ring": "transparent",
			"--upstream-fill-danger": "#d03b3b",
			"--upstream-fill-danger-hover": "#e34948",
		});
	});
});

describe("alpha-3 token (upstream --cds-alpha-3, neutral-900 at 20%)", () => {
	it("defines the light and dark values", () => {
		expect({
			light: tokens(block(":root"), ["--upstream-alpha-3"]),
			dark: tokens(block(".dark"), ["--upstream-alpha-3"]),
		}).toStrictEqual({
			light: {"--upstream-alpha-3": "rgb(11 11 11 / 0.2)"},
			dark: {"--upstream-alpha-3": "rgb(255 255 255 / 0.2)"},
		});
	});
});

describe("alpha-1 and alpha-2 tokens (upstream --cds-alpha-1/2, neutral-900 at 5% and 10%)", () => {
	it("defines the light and dark values", () => {
		expect({
			light: tokens(block(":root"), ["--upstream-alpha-1", "--upstream-alpha-2"]),
			dark: tokens(block(".dark"), ["--upstream-alpha-1", "--upstream-alpha-2"]),
		}).toStrictEqual({
			light: {"--upstream-alpha-1": "rgb(11 11 11 / 0.05)", "--upstream-alpha-2": "rgb(11 11 11 / 0.1)"},
			dark: {"--upstream-alpha-1": "rgb(255 255 255 / 0.05)", "--upstream-alpha-2": "rgb(255 255 255 / 0.1)"},
		});
	});
});

describe("brand accent tokens (upstream --brand-100 / --oncolor-100)", () => {
	const UPSTREAM_BRAND_TOKENS = ["--upstream-brand-100", "--upstream-oncolor-100"] as const;

	it("maps the theme utilities onto the upstream variables", () => {
		expect(tokens(block("@theme inline"), ["--color-brand-100", "--color-oncolor-100"])).toStrictEqual({
			"--color-brand-100": "var(--upstream-brand-100)",
			"--color-oncolor-100": "var(--upstream-oncolor-100)",
		});
	});

	it("defines the light values (hsl 15 54.2% 51.2%)", () => {
		expect(tokens(block(":root"), UPSTREAM_BRAND_TOKENS)).toStrictEqual({
			"--upstream-brand-100": "rgb(198 97 63)",
			"--upstream-oncolor-100": "rgb(255 255 255)",
		});
	});

	it("defines the dark values (hsl 15 63.1% 59.6%)", () => {
		expect(tokens(block(".dark"), UPSTREAM_BRAND_TOKENS)).toStrictEqual({
			"--upstream-brand-100": "rgb(217 119 87)",
			"--upstream-oncolor-100": "rgb(255 255 255)",
		});
	});
});

describe("compose field paint tokens (upstream --cds-fill-field / shadow-panel-sm)", () => {
	const UPSTREAM_FIELD_TOKENS = ["--upstream-fill-field", "--upstream-shadow-panel-sm"] as const;

	it("maps the theme utilities onto the upstream variables", () => {
		expect(tokens(block("@theme inline"), ["--color-fill-field", "--shadow-panel-sm-cds"])).toStrictEqual({
			"--color-fill-field": "var(--upstream-fill-field)",
			"--shadow-panel-sm-cds": "var(--upstream-shadow-panel-sm)",
		});
	});

	it("defines the light values (ring-outer 1px of --cds-border, --cds-shadow-sm with 8% shadow colour)", () => {
		expect(tokens(block(":root"), UPSTREAM_FIELD_TOKENS)).toStrictEqual({
			"--upstream-fill-field": "rgb(255 255 255 / 0.5)",
			"--upstream-shadow-panel-sm":
				"inset 0 0 0 0 rgb(11 11 11 / 0.1), 0 0 0 1px rgb(11 11 11 / 0.1), 0 1px 2px rgb(11 11 11 / 0.06), 0 2px 8px rgb(11 11 11 / 0.08)",
		});
	});

	it("defines the dark values (ring-inner 1px of --cds-alpha-2, shadow colour #0000003d)", () => {
		expect(tokens(block(".dark"), UPSTREAM_FIELD_TOKENS)).toStrictEqual({
			"--upstream-fill-field": "var(--upstream-alpha-1)",
			"--upstream-shadow-panel-sm":
				"inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 0 0 0 rgb(255 255 255 / 0.1), 0 1px 2px rgb(11 11 11 / 0.06), 0 2px 8px rgb(0 0 0 / 0.24)",
		});
	});
});

describe("brand fill tokens (upstream --cds-fill-brand / -hover, the ⌘K Compose Send)", () => {
	it("maps the theme utilities onto the upstream variables", () => {
		expect(tokens(block("@theme inline"), ["--color-fill-brand", "--color-fill-brand-hover"])).toStrictEqual({
			"--color-fill-brand": "var(--upstream-fill-brand)",
			"--color-fill-brand-hover": "var(--upstream-fill-brand-hover)",
		});
	});

	it("uses the same clay values in light and dark", () => {
		const names = ["--upstream-fill-brand", "--upstream-fill-brand-hover"] as const;
		expect({light: tokens(block(":root"), names), dark: tokens(block(".dark"), names)}).toStrictEqual({
			light: {"--upstream-fill-brand": "#c6613f", "--upstream-fill-brand-hover": "#d97757"},
			dark: {"--upstream-fill-brand": "#c6613f", "--upstream-fill-brand-hover": "#d97757"},
		});
	});
});

describe("button press squish (upstream .cds-btn-squish)", () => {
	it("uses upstream's --cds-btn-spring curve", () => {
		expect(tokens(block(":root"), ["--btn-spring"])).toStrictEqual({
			"--btn-spring":
				"linear( 0, 0.2459, 0.6526, 0.9468, 1.0764, 1.0915, 1.0585, 1.0219, 0.9993, 0.9914, 0.9921, 0.9957, 0.9988, 1.0004, 1 )",
		});
	});

	// The paint list keeps the hover fade (upstream's 60ms paint-span timing) since `transition` replaces `transition-colors`.
	it("scales to .975 in 60ms ease-out while pressed and springs back over .45s", () => {
		expect(block("@utility btn-squish").replaceAll(/\s+/g, " ")).toBe(
			"@utility btn-squish { --btn-squish-paint: background-color 60ms cubic-bezier(0.165, 0.84, 0.44, 1), color 60ms cubic-bezier(0.165, 0.84, 0.44, 1); transform-origin: 50% center; transition: transform 0.45s var(--btn-spring), var(--btn-squish-paint); &:active:not(:disabled) { transform: scale(0.975); transition: transform 60ms ease-out, var(--btn-squish-paint); }",
		);
	});
});

describe("sidebar group band", () => {
	it("uses upstream's web band top margin: the comfortable group padding + 4px, less one stack gap (18px)", () => {
		expect(tokens(block(":root"), ["--sb-group-pt-token", "--sb-group-band-mt"])).toStrictEqual({
			"--sb-group-pt-token": "16px",
			"--sb-group-band-mt": "calc(var(--sb-group-pt-token) + 4px - var(--sb-row-stack-gap))",
		});
	});
});

describe("task-card press scale", () => {
	it("scales a pressed task card's surface to .99 in 60ms and springs it back over .45s, as upstream's epitaxy-task-card-surface", () => {
		expect({
			rest: block(".task-card-surface").replaceAll(/\s+/g, " "),
			pressed: block(".group\\/btn:active:not([disabled]) .task-card-surface").replaceAll(/\s+/g, " "),
		}).toStrictEqual({
			rest: ".task-card-surface { transform-origin: 50%; transition: transform 0.45s var(--btn-spring);",
			pressed:
				".group\\/btn:active:not([disabled]) .task-card-surface { transition: transform 60ms ease-out; transform: scale(0.99);",
		});
	});
});

const RTL_ROOT_BDI = ':root[dir="rtl"] .df-meta-slots .df-meta-line > bdi:dir(ltr) {';

describe("described row meta line (upstream sidebar-row-metadata-line)", () => {
	const squash = (source: string) => source.replaceAll(/\s+/g, " ").trim();

	it("makes the slots a size container and caps the place at upstream's min(14ch, 40cqi) with a 12px fade", () => {
		expect({
			slots: squash(block(".df-meta-slots")),
			place: tokens(block(".df-meta-place"), ["--df-place-cap", "max-inline-size", "mask-image", "overflow"]),
			textless: tokens(block(".df-meta-line:not(:has(> bdi)) + .df-meta-place"), ["--df-place-cap"]),
			rtlPlace: tokens(block(".df-meta-place:dir(rtl)"), ["mask-image"]),
		}).toStrictEqual({
			slots: ".df-meta-slots { container-type: inline-size;",
			place: {
				"--df-place-cap": "min(14ch, 40cqi)",
				"max-inline-size": "calc(var(--df-place-cap) + 12px)",
				"mask-image":
					"linear-gradient(to right, #000 var(--df-place-cap), transparent calc(var(--df-place-cap) + 12px))",
				overflow: "clip",
			},
			textless: {"--df-place-cap": "min(70cqi, 100cqi - 92px)"},
			rtlPlace: {
				"mask-image":
					"linear-gradient(to left, #000 var(--df-place-cap), transparent calc(var(--df-place-cap) + 12px))",
			},
		});
	});

	it("clips opposite-direction message text with a fade at its own end", () => {
		expect({
			ltrRoot: tokens(
				block(
					':root:not([dir="rtl"]) .df-meta-slots .df-meta-line > bdi:dir(rtl),\n:root[dir="rtl"] .df-meta-slots .df-meta-line > bdi:dir(ltr)',
				),
				["flex-shrink", "min-inline-size", "padding-inline-end", "overflow", "mask-image"],
			),
			// The RTL-root override is the selector's last, standalone block.
			rtlRoot: tokens(styles.slice(styles.lastIndexOf(RTL_ROOT_BDI)), ["mask-image"]),
		}).toStrictEqual({
			ltrRoot: {
				"flex-shrink": "1",
				"min-inline-size": "0",
				"padding-inline-end": "12px",
				overflow: "clip",
				"mask-image": "linear-gradient(270deg, #000 calc(100% - 12px), #0000)",
			},
			rtlRoot: {"mask-image": "linear-gradient(90deg, #000 calc(100% - 12px), #0000)"},
		});
	});

	it("pads a described row from the row control, not the described line (phone row 54px)", () => {
		expect(tokens(block(".df-described-row"), ["padding-block"])).toStrictEqual({
			"padding-block":
				"calc( (var(--sb-row-h) - var(--sb-row-ctl)) / 2 + var(--sb-described-tuck) - var(--sb-described-trim) )",
		});
	});

	it("ends the fork guide mid-description when the family's last child is described", () => {
		expect(
			tokens(block(".df-family:has(> [data-family-child]:last-child .df-described-row)::before"), ["bottom"]),
		).toStrictEqual({
			bottom: "calc( (var(--sb-row-h) - var(--sb-row-ctl)) / 2 + var(--sb-described-tuck) - var(--sb-described-trim) + 2px + 1.5 * (var(--sb-described-line, var(--sb-row-ctl)) - var(--sb-described-tuck)) )",
		});
	});
});
