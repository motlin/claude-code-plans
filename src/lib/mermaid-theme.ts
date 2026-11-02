/**
 * Upstream's mermaid theme chunk (ce48a1d68 `themeFor`): the `themeVariables` and `themeCSS` handed to
 * `mermaid.initialize` on top of `theme: "base"`, ported verbatim. The shared-1 design tokens it reads are
 * inlined here as their light and dark values.
 */

export type MermaidThemeMode = "light" | "dark";

/** A shared-1 token: its light value, and its dark one when that differs. */
interface Token
{
	value: string;
	dark?: string;
}

const tokens =
{
	chartCategorical1:
	{
		value: "#2a78d6",
		dark: "#3987e5",
	},
	chartCategorical2:
	{
		value: "#eb6834",
		dark: "#d95926",
	},
	chartCategorical3:
	{
		value: "#1baf7a",
		dark: "#199e70",
	},
	chartCategorical4:
	{
		value: "#eda100",
		dark: "#c98500",
	},
	chartCategorical5:
	{
		value: "#e87ba4",
		dark: "#d55181",
	},
	chartCategorical6:
	{
		value: "#008300",
	},
	chartCategorical7:
	{
		value: "#6250d6",
		dark: "#9085e9",
	},
	chartCategorical8:
	{
		value: "#e34948",
		dark: "#e66767",
	},
	chartMuted:
	{
		value: "#c3c2b7",
		dark: "#5f5e5a",
	},
	chartReference:
	{
		value: "#898781",
		dark: "#97958d",
	},
	chartGrid:
	{
		value: "rgba(11, 11, 11, 0.1)",
		dark: "rgba(255, 255, 255, 0.1)",
	},
	bgTintBlueOpaque:
	{
		value: "#cde2fb",
		dark: "#032042",
	},
	bgTintOrangeOpaque:
	{
		value: "#f7d8cb",
		dark: "#371407",
	},
	bgTintAquaOpaque:
	{
		value: "#bfebdb",
		dark: "#022720",
	},
	bgTintYellowOpaque:
	{
		value: "#f9dca4",
		dark: "#311a00",
	},
	bgTintMagentaOpaque:
	{
		value: "#f9d4e2",
		dark: "#390f1f",
	},
	bgTintGreenOpaque:
	{
		value: "#caeac7",
		dark: "#11260f",
	},
	bgTintVioletOpaque:
	{
		value: "#dfdbfd",
		dark: "#1d1649",
	},
	bgTintRedOpaque:
	{
		value: "#fad6d6",
		dark: "#3c0e0e",
	},
	textTintBlue:
	{
		value: "#184f95",
		dark: "#6da7ec",
	},
	textTintOrange:
	{
		value: "#863311",
		dark: "#ec835a",
	},
	textTintAqua:
	{
		value: "#065f49",
		dark: "#3bbd8c",
	},
	textTintYellow:
	{
		value: "#734500",
		dark: "#db9300",
	},
	textTintMagenta:
	{
		value: "#862a4c",
		dark: "#e87ba4",
	},
	textTintGreen:
	{
		value: "#006300",
		dark: "#55bf50",
	},
	textTintViolet:
	{
		value: "#4a3aa7",
		dark: "#a096eb",
	},
	textTintRed:
	{
		value: "#8e2626",
		dark: "#ec7e7e",
	},
	textSecondary:
	{
		value: "#52514e",
		dark: "#c3c2b7",
	},
	surface2:
	{
		value: "#ffffff",
		dark: "#1a1a19",
	},
	surface3:
	{
		value: "#ffffff",
		dark: "#20201f",
	},
	bgNeutral:
	{
		value: "rgba(11, 11, 11, 0.05)",
		dark: "rgba(255, 255, 255, 0.05)",
	},
	gray0:
	{
		value: "#ffffff",
	},
	gray550:
	{
		value: "#5f5e5a",
	},
	blue500:
	{
		value: "#256abf",
	},
	red450:
	{
		value: "#d03b3b",
	},
} satisfies Record<string, Token>;

/** Upstream `k`: the dark value, or the light one when the token has no dark value. */
const darkOf = (token: Token): string => token.dark ?? token.value;
/** Upstream `A`. */
const inMode = (token: Token, mode: MermaidThemeMode): string => (mode === "dark" ? darkOf(token) : token.value);

/** Upstream `j`: each categorical series with its opaque tint fill and tint text. */
type Series = readonly [stroke: Token, fill: Token, text: Token];
const series: readonly Series[] = [
	[tokens.chartCategorical1, tokens.bgTintBlueOpaque, tokens.textTintBlue],
	[tokens.chartCategorical2, tokens.bgTintOrangeOpaque, tokens.textTintOrange],
	[tokens.chartCategorical3, tokens.bgTintAquaOpaque, tokens.textTintAqua],
	[tokens.chartCategorical4, tokens.bgTintYellowOpaque, tokens.textTintYellow],
	[tokens.chartCategorical5, tokens.bgTintMagentaOpaque, tokens.textTintMagenta],
	[tokens.chartCategorical6, tokens.bgTintGreenOpaque, tokens.textTintGreen],
	[tokens.chartCategorical7, tokens.bgTintVioletOpaque, tokens.textTintViolet],
	[tokens.chartCategorical8, tokens.bgTintRedOpaque, tokens.textTintRed],
];
const gitSeries = series.slice(0, 7);

const gitColors = (mode: MermaidThemeMode): Record<string, string> =>
	Object.fromEntries(gitSeries.map(([stroke], index) => [`git${index + 1}`, inMode(stroke, mode)]));

/** Upstream `P`: the gitgraph commit, label and branch-label colors. */
function gitgraphCss(mode: MermaidThemeMode, mergeFill: string): string
{
	const reference = inMode(tokens.chartReference, mode);
	const branches = gitSeries
		.map(
			([stroke, fill, text], index) =>
				` .commit-highlight${index + 1} { fill: ${inMode(stroke, mode)}; stroke: ${inMode(stroke, mode)}; } .label${index + 1} { fill: ${inMode(fill, mode)}; } .branch-label${index + 1} { fill: ${inMode(text, mode)}; }`,
		)
		.join("");
	return (
		`.commit0, .commit-highlight0 { fill: ${reference}; } .commit0, .arrow0, .commit-highlight0 { stroke: ${reference}; } .label0 { fill: ${inMode(tokens.bgNeutral, mode)}; } .branch-label0 { fill: ${inMode(tokens.textSecondary, mode)}; }` +
		branches +
		` .commit-merge, .commit-reverse, .commit-highlight-inner { fill: ${mergeFill}; stroke: ${mergeFill}; }`
	);
}

/** Upstream `I`: the series, then four muted ones. */
const mutedTail = [tokens.surface3, tokens.textSecondary] as const;
const scale: readonly Series[] = [
	...series,
	...Array.from(
		{
			length: 4,
		},
		(): Series => [tokens.chartMuted, ...mutedTail],
	),
];

const colorScale: Record<string, string> = Object.fromEntries(
	scale.flatMap(([stroke], index) => [
		[`cScale${index}`, darkOf(stroke)],
		[`cScaleInv${index}`, darkOf(stroke)],
		[`cScaleLabel${index}`, darkOf(tokens.gray0)],
	]),
);

/** Upstream `R`: one mindmap/timeline section's fills. */
const sectionCss = (selector: string, [stroke, fill, text]: Series): string =>
	` ${selector} rect, ${selector} path, ${selector} circle, ${selector} polygon { fill: ${darkOf(fill)}; } ${selector} .node-bkg, ${selector} .label-container { stroke: ${darkOf(stroke)}; } ${selector} text { fill: ${darkOf(text)}; }`;

const sectionsCss =
	scale.map((entry, index) => sectionCss(`.section-${index - 1}`, entry)).join("") +
	sectionCss(".section-root", [tokens.chartReference, ...mutedTail]);

const DARK_TEXT = "#E5E5E5";
const DARK_LINE = "#A1A1A1";
const scaleColors = scale.map(([stroke]) => darkOf(stroke));
const chartTextKeys = [
	"titleColor",
	"legendTextColor",
	"xAxisTitleColor",
	"xAxisLabelColor",
	"xAxisTickColor",
	"xAxisLineColor",
	"yAxisTitleColor",
	"yAxisLabelColor",
	"yAxisTickColor",
	"yAxisLineColor",
];

/** Upstream `W`: pie, quadrant, radar and xyChart colors. */
const chartVariables =
{
	...Object.fromEntries(scaleColors.map((color, index) => [`pie${index + 1}`, color])),
	pieStrokeColor: darkOf(tokens.surface2),
	pieOuterStrokeColor: darkOf(tokens.surface2),
	pieSectionTextColor: darkOf(tokens.gray0),
	quadrantPointFill: darkOf(tokens.chartCategorical1),
	radar:
	{
		axisColor: DARK_LINE,
		graticuleColor: darkOf(tokens.chartGrid),
	},
	xyChart:
	{
		...Object.fromEntries(chartTextKeys.map((key) => [key, DARK_TEXT])),
		dataLabelColor: darkOf(tokens.gray0),
		backgroundColor: "transparent",
		plotColorPalette: scaleColors.join(","),
	},
};

/** Upstream `G`: the remaining dark-mode diagram colors. */
const darkDiagramVariables =
{
	activationBkgColor: darkOf(tokens.surface3),
	activationBorderColor: DARK_LINE,
	compositeBackground: darkOf(tokens.surface3),
	clusterBkg: darkOf(tokens.surface3),
	clusterBorder: DARK_LINE,
	altBackground: darkOf(tokens.surface3),
	secondBkg: darkOf(tokens.surface3),
	secondaryBorderColor: DARK_LINE,
	secondaryTextColor: DARK_TEXT,
	archGroupBorderColor: DARK_LINE,
	...Object.fromEntries([1, 2, 3, 4].map((quadrant) => [`quadrant${quadrant}Fill`, darkOf(tokens.surface3)])),
	...Object.fromEntries(scale.slice(0, 8).map(([, fill], index) => [`fillType${index}`, darkOf(fill)])),
	activeTaskBkgColor: darkOf(tokens.blue500),
	activeTaskBorderColor: darkOf(tokens.textTintBlue),
	doneTaskBkgColor: darkOf(tokens.gray550),
	doneTaskBorderColor: darkOf(tokens.textSecondary),
	critBkgColor: darkOf(tokens.red450),
	critBorderColor: darkOf(tokens.textTintRed),
	taskTextDarkColor: darkOf(tokens.gray0),
	taskTextClickableColor: darkOf(tokens.gray0),
	pieTitleTextColor: DARK_TEXT,
	pieLegendTextColor: DARK_TEXT,
	packet:
	{
		startByteColor: DARK_TEXT,
		endByteColor: DARK_TEXT,
		labelColor: DARK_TEXT,
		titleColor: DARK_TEXT,
		blockStrokeColor: DARK_LINE,
		blockFillColor: darkOf(tokens.surface3),
	},
	treeView:
	{
		labelColor: DARK_TEXT,
		lineColor: DARK_LINE,
	},
	cynefin:
	{
		complexBg: darkOf(tokens.bgTintGreenOpaque),
		complicatedBg: darkOf(tokens.bgTintBlueOpaque),
		chaoticBg: darkOf(tokens.bgTintRedOpaque),
		clearBg: darkOf(tokens.bgTintYellowOpaque),
		confusionBg: darkOf(tokens.bgTintVioletOpaque),
		boundaryColor: DARK_LINE,
		cliffColor: darkOf(tokens.chartCategorical8),
		arrowColor: DARK_LINE,
		textColor: DARK_TEXT,
		labelColor: DARK_TEXT,
	},
};

/** Upstream `K`: halo and stroke fixes for mermaid's hard-coded #444444 ink. */
const darkInkCss = ` text[fill="#444444"] { fill: ${DARK_TEXT}; stroke: ${darkOf(tokens.surface2)}; stroke-width: 3px; paint-order: stroke; } line[stroke="#444444"], path[stroke="#444444"][marker-end], path[stroke="#444444"][marker-start], rect[stroke="#444444"] { stroke: ${DARK_LINE}; }`;

const darkVariables =
{
	primaryTextColor: DARK_TEXT,
	lineColor: DARK_LINE,
	primaryColor: "transparent",
	primaryBorderColor: DARK_LINE,
	secondaryColor: "transparent",
	tertiaryColor: "#CC785C",
	actorTextColor: DARK_TEXT,
	actorLineColor: DARK_LINE,
	signalColor: DARK_TEXT,
	signalTextColor: DARK_TEXT,
	noteBkgColor: "#2D2D2D",
	noteTextColor: DARK_TEXT,
	noteBorderColor: DARK_LINE,
	...gitColors("dark"),
	commitLabelColor: DARK_TEXT,
	...colorScale,
	...chartVariables,
	...darkDiagramVariables,
};

const journeySectionCss = (fill: string): string => ` text.journey-section { fill: ${fill}; }`;

const darkCss =
	gitgraphCss("dark", darkVariables.noteBkgColor) +
	` .commit-cherry-pick[fill], .commit-cherry-pick[stroke] { fill: ${darkVariables.noteBkgColor}; stroke: ${darkVariables.noteBkgColor}; }` +
	sectionsCss +
	` .items .node rect { fill: ${darkOf(tokens.surface3)}; } .critText0, .critText1, .critText2, .critText3 { fill: ${darkOf(tokens.gray0)}; }` +
	journeySectionCss(DARK_TEXT) +
	` .titleText, .sectionTitle0, .sectionTitle1, .sectionTitle2, .sectionTitle3 { fill: ${DARK_TEXT}; } rect.treemapSection { fill-opacity: 0.3; }` +
	darkInkCss;

const LIGHT_LINE = "#91918D";
const lightVariables =
{
	primaryTextColor: "#191919",
	lineColor: LIGHT_LINE,
	primaryColor: "#F0F0EB",
	primaryBorderColor: "#D9D8D5",
	secondaryColor: "#F5E6D8",
	tertiaryColor: "#CC785C",
	actorTextColor: "#191919",
	actorLineColor: LIGHT_LINE,
	signalColor: "#191919",
	signalTextColor: "#191919",
	noteBkgColor: "#F0F0EB",
	noteTextColor: "#191919",
	noteBorderColor: "#D9D8D5",
	...gitColors("light"),
	clusterBkg: tokens.surface3.value,
	clusterBorder: LIGHT_LINE,
	altBackground: tokens.surface3.value,
};

/** Upstream `se`: wardley map colors (dark mode only). */
const wardley =
{
	axisColor: LIGHT_LINE,
	axisTextColor: lightVariables.primaryTextColor,
	componentStroke: LIGHT_LINE,
	componentLabelColor: lightVariables.primaryTextColor,
	linkStroke: LIGHT_LINE,
	annotationStroke: LIGHT_LINE,
	annotationTextColor: lightVariables.primaryTextColor,
};

const mindmapLabelCss = " .mindmap-node .label { transform: translate(-50%, -50%); transform-box: fill-box; }";
const dividerCss = (stroke: string): string =>
	` .block .node .cluster, .statediagram-state rect.divider { stroke: ${stroke}; }`;

export interface MermaidTheme
{
	themeVariables: Record<string, unknown>;
	themeCSS: string;
}

/** Upstream `themeFor(mode)`. */
export function themeFor(mode: MermaidThemeMode): MermaidTheme
{
	return mode === "dark"
		?
			{
				themeVariables:
				{
					...darkVariables,
					wardley,
				},
				themeCSS: darkCss + dividerCss(darkVariables.clusterBorder) + mindmapLabelCss,
			}
		:
			{
				themeVariables: lightVariables,
				themeCSS:
					gitgraphCss("light", lightVariables.primaryColor) +
					journeySectionCss(lightVariables.primaryTextColor) +
					dividerCss(lightVariables.clusterBorder) +
					mindmapLabelCss,
			};
}
