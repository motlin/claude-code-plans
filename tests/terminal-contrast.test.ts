import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {CodeThemeDarkSchema, CodeThemeLightSchema, loadCodeTheme} from "../src/lib/code-themes";
import
{
	contrastRatio,
	ensureContrastRatio,
	installContrastFloor,
	installMinimumContrast,
	minimumContrastRatio,
	parseHexColor,
	type ContrastCell,
	type Rgb,
} from "../src/lib/terminal-contrast";
import {terminalBaseFromCodeTheme, terminalThemeFromCodeTheme} from "../src/lib/terminal-theme";

const CREAM: Rgb = [0xfa, 0xf9, 0xf5];
const CHARCOAL: Rgb = [0x1f, 0x1e, 0x1d];

const PALETTE_FIELDS = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
	"foreground",
] as const;

function cell(fg: Rgb, bg: Rgb = [0, 0, 0], flags = 0): ContrastCell
{
	return {
		fg_r: fg[0],
		fg_g: fg[1],
		fg_b: fg[2],
		bg_r: bg[0],
		bg_g: bg[1],
		bg_b: bg[2],
		flags,
		codepoint: 0x41,
	};
}

describe("minimumContrastRatio", () =>
{
	it("is upstream's WCAG AA 4.5, raised to 7 under prefers-contrast: more", () =>
	{
		expect([minimumContrastRatio(false), minimumContrastRatio(true)]).toStrictEqual([4.5, 7]);
	});
});

describe("ensureContrastRatio", () =>
{
	it("leaves a foreground that already meets the ratio alone", () =>
	{
		expect(ensureContrastRatio(CREAM, CHARCOAL, 4.5)).toBeUndefined();
	});

	it("darkens the CLI's pale lavender on the cream light background to at least 4.5", () =>
	{
		const lavender: Rgb = [0xb1, 0xb9, 0xf9];
		const adjusted = ensureContrastRatio(CREAM, lavender, 4.5);
		expect(adjusted).toBeDefined();
		expect(contrastRatio(CREAM, adjusted ?? lavender)).toBeGreaterThanOrEqual(4.5);
	});

	it("lightens a near-black foreground on a dark background", () =>
	{
		const nearBlack: Rgb = [0x30, 0x30, 0x30];
		const adjusted = ensureContrastRatio(CHARCOAL, nearBlack, 4.5);
		expect(contrastRatio(CHARCOAL, adjusted ?? nearBlack)).toBeGreaterThanOrEqual(4.5);
	});
});

describe("code theme palettes under the contrast floor", () =>
{
	const ids = [...CodeThemeLightSchema.options, ...CodeThemeDarkSchema.options];
	it.each(ids)("every %s palette colour reads at >= 4.5 against its background", async (id) =>
	{
		const dark = (CodeThemeDarkSchema.options as readonly string[]).includes(id);
		const base = terminalBaseFromCodeTheme(await loadCodeTheme(dark ? "claude-dark" : "claude-light"));
		const theme = terminalThemeFromCodeTheme(await loadCodeTheme(id), base);
		const background = parseHexColor(theme.background ?? "#ffffff");
		const failing = PALETTE_FIELDS.flatMap((field) =>
		{
			const color = theme[field];
			if (color === undefined || background === undefined) return [];
			const rgb = parseHexColor(color);
			if (rgb === undefined) return [];
			const shown = ensureContrastRatio(background, rgb, 4.5) ?? rgb;
			return contrastRatio(background, shown) < 4.5 ? [field] : [];
		});
		expect(failing).toStrictEqual([]);
	});
});

describe("installMinimumContrast", () =>
{
	function fakeRenderer(background: string)
	{
		const drawn: Rgb[] = [];
		const renderer =
		{
			theme:
			{
				background,
			},
			renderCellText(this: unknown, c: ContrastCell, _x: number, _y: number)
			{
				drawn.push([c.fg_r, c.fg_g, c.fg_b]);
			},
		};
		return {
			renderer,
			drawn,
		};
	}

	it("draws a too-light foreground at the floor on the theme background, then restores the cell", () =>
	{
		const {renderer, drawn} = fakeRenderer("#faf9f5");
		installMinimumContrast(renderer, () => 4.5);
		const pale = cell([0xee, 0xee, 0xee]);
		renderer.renderCellText(pale, 0, 0);
		const [shown] = drawn;
		expect(contrastRatio(CREAM, shown ?? [0, 0, 0])).toBeGreaterThanOrEqual(4.5);
		expect([pale.fg_r, pale.fg_g, pale.fg_b]).toStrictEqual([0xee, 0xee, 0xee]);
	});

	it("measures against the cell's own background when it has one", () =>
	{
		const {renderer, drawn} = fakeRenderer("#faf9f5");
		installMinimumContrast(renderer, () => 4.5);
		renderer.renderCellText(cell([0xee, 0xee, 0xee], [0x10, 0x10, 0x10]), 0, 0);
		expect(drawn).toStrictEqual([[0xee, 0xee, 0xee]]);
	});

	it("halves the floor for faint text, like xterm's dim", () =>
	{
		const {renderer, drawn} = fakeRenderer("#ffffff");
		installMinimumContrast(renderer, () => 4.5);
		const grey: Rgb = [0x90, 0x90, 0x90];
		renderer.renderCellText(cell(grey, [0, 0, 0], 128), 0, 0);
		expect(drawn).toStrictEqual([grey]);
	});

	it("leaves box-drawing glyphs at their own colour", () =>
	{
		const {renderer, drawn} = fakeRenderer("#ffffff");
		installMinimumContrast(renderer, () => 4.5);
		renderer.renderCellText(
			{
				...cell([0xee, 0xee, 0xee]),
				codepoint: 0x2502,
			},
			0,
			0,
		);
		expect(drawn).toStrictEqual([[0xee, 0xee, 0xee]]);
	});

	it("reads the ratio on every draw, so a prefers-contrast change applies on the next render", () =>
	{
		const {renderer, drawn} = fakeRenderer("#ffffff");
		let ratio = 1;
		installMinimumContrast(renderer, () => ratio);
		renderer.renderCellText(cell([0xee, 0xee, 0xee]), 0, 0);
		ratio = 7;
		renderer.renderCellText(cell([0xee, 0xee, 0xee]), 0, 0);
		expect(drawn[0]).toStrictEqual([0xee, 0xee, 0xee]);
		expect(contrastRatio([255, 255, 255], drawn[1] ?? [255, 255, 255])).toBeGreaterThanOrEqual(7);
	});
});

describe("installContrastFloor", () =>
{
	afterEach(() =>
	{
		vi.unstubAllGlobals();
	});

	function stubContrastMore(initial: boolean)
	{
		const listeners = new Set<() => void>();
		const media =
		{
			matches: initial,
			addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
			removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
		};
		const queries: string[] = [];
		vi.stubGlobal(
			"window",
			{
				matchMedia: (query: string) =>
				{
					queries.push(query);
					return media;
				},
			},
		);
		return {
			queries,
			listeners,
			flip(matches: boolean)
			{
				media.matches = matches;
				for (const listener of listeners) listener();
			},
		};
	}

	it("floors at 4.5, then at 7 with a redraw once prefers-contrast: more matches, until cleaned up", () =>
	{
		const contrast = stubContrastMore(false);
		const drawn: Rgb[] = [];
		const renderer =
		{
			theme:
			{
				background: "#ffffff",
			},
			renderCellText(c: ContrastCell)
			{
				drawn.push([c.fg_r, c.fg_g, c.fg_b]);
			},
		};
		let redraws = 0;
		const cleanup = installContrastFloor(renderer, () =>
		{
			redraws += 1;
		});
		const white: Rgb = [255, 255, 255];
		renderer.renderCellText(cell([0xee, 0xee, 0xee]));
		contrast.flip(true);
		renderer.renderCellText(cell([0xee, 0xee, 0xee]));
		const ratios = drawn.map((rgb) => contrastRatio(white, rgb));
		expect(
			{
				queries: contrast.queries,
				redraws,
				atAa: (ratios[0] ?? 0) >= 4.5 && (ratios[0] ?? 0) < 7,
				atAaa: (ratios[1] ?? 0) >= 7,
			},
		).toStrictEqual(
			{
				queries: ["(prefers-contrast: more)"],
				redraws: 1,
				atAa: true,
				atAaa: true,
			},
		);
		cleanup();
		expect(contrast.listeners.size).toBe(0);
	});

	it("leaves a renderer without a text pass alone", () =>
	{
		const contrast = stubContrastMore(false);
		installContrastFloor(
			{
				theme:
				{
					background: "#ffffff",
				},
			},
			() => undefined,
		);
		expect(contrast.listeners.size).toBe(0);
	});
});
