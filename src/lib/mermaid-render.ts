import DOMPurify from "dompurify";
import type {Mermaid, MermaidConfig} from "mermaid";
import {loadMermaid} from "./mermaid-gate";
import type {MeasuredDraw, MermaidDrawSeen, MermaidRefusal, SequenceRepair} from "./mermaid-guard";

/*
 * Upstream's mermaid renderer support (shared-41, dumps/markdown-mermaid-diagram-render-shared41-renderer.txt):
 * the lazy mermaid import, the serialized draw queue with its time limit, the sandbox iframe CSP, the SVG pulled
 * back out of the iframe, DOMPurify sanitizing with style scoping, the shadow-root writer and the two caches, and
 * the source rewrites before a draw. Each draw runs under upstream's guard (./mermaid-guard, chunk c763d2034), loaded
 * lazily beside mermaid, which checks the parsed diagram and meters the frame mermaid draws in.
 */

/** Upstream `LJ`: how long one diagram may take to draw. */
export const MERMAID_DRAW_LIMIT_MS = 30_000;

/** Upstream `CN`: the config keys a `%%{init}%%` directive may not override. */
export const MERMAID_SECURE_KEYS =
	"secure.securityLevel.startOnLoad.maxTextSize.maxEdges.suppressErrorRendering.htmlLabels.dompurifyConfig.themeCSS.fontFamily.altFontFamily.fontSize.fontWeight.messageFontSize.messageFontWeight.messageFontFamily.noteFontSize.noteFontWeight.noteFontFamily.actorFontSize.actorFontWeight.actorFontFamily.themeVariables.theme.layout.defaultRenderer.bitsPerRow.numIter.look".split(
		".",
	);

/** Upstream `Uw`: the CSP injected into mermaid's sandbox iframe. */
const MERMAID_FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

/** Upstream `hH`: the style leading every diagram's shadow root. */
export const MERMAID_SHADOW_STYLE =
	":host > div > svg, [data-mermaid] > div > svg { display: block; max-width: 100%; margin-inline: auto; }";

const LABEL_SELECTORS = ["text > tspan", "text:not(:has(> tspan))"];
const MEMBER_LABELS = ":is(.members-group, .methods-group) :is(text, tspan)";
const hostScoped = (selector: string) => `:host ${selector}, [data-mermaid] ${selector}`;
/** Upstream `VS`: {@link MERMAID_SHADOW_STYLE} plus per-label bidi detection, for `autoLabelDirection`. */
export const MERMAID_SHADOW_STYLE_AUTO_DIRECTION = [
	MERMAID_SHADOW_STYLE,
	...LABEL_SELECTORS.map((selector) => `${hostScoped(selector)} { unicode-bidi: plaintext; }`),
	`${hostScoped(MEMBER_LABELS)} { unicode-bidi: normal; }`,
].join("\n");

/** Upstream `mF`: an Error with a name the callers branch on. */
function namedError(name: string, message: string): Error {
	const error = new Error(message);
	error.name = name;
	return error;
}

// ---- sanitizing (upstream Vb and its helpers) ----

/** Upstream `WH`. */
const SANITIZE_CONFIG = {
	USE_PROFILES: {svg: true, svgFilters: true},
	KEEP_CONTENT: false,
	FORBID_TAGS: ["image", "feimage", "link", "animate", "set", "animatecolor", "animatemotion", "animatetransform"],
	FORBID_ATTR: ["target", "color-profile", "direction", "writing-mode", "letter-spacing", "word-spacing"],
};

/** Upstream `zS`. */
const LAYOUT_ESCAPE_PROPERTIES = [
	"view-transition-name",
	"view-transition-class",
	"anchor-name",
	"container-name",
	"container",
	"timeline-scope",
	"scroll-timeline-name",
	"view-timeline-name",
	"scroll-timeline",
	"view-timeline",
];
const LAYOUT_ESCAPE_PROPERTY = new RegExp(`^(?:-\\w+-)?(?:${LAYOUT_ESCAPE_PROPERTIES.join("|")})$`, "i");
/** Upstream `gz`. */
const BIDI_PROPERTIES = ["unicode-bidi", "direction", "writing-mode", "rtl-ordering"];
const BIDI_PROPERTY = new RegExp(`^(?:-\\w+-)?(?:${BIDI_PROPERTIES.join("|")})$`, "i");
const SPACING_PROPERTY = /^(?:-\w+-)?(?:letter|word)-spacing$/i;
const PLAIN_SPACING = /^(?:normal|\+?(?:\d+(?:\.\d+)?|\.\d+)[a-z%]*)$/i;
const MAY_HOLD_BIDI = new RegExp(`${BIDI_PROPERTIES.join("|")}|-spacing`, "i");
const MAY_HOLD_LAYOUT_ESCAPE = new RegExp(`${LAYOUT_ESCAPE_PROPERTIES.join("|")}|/\\*`, "i");

/** Upstream `mS`: a bidi property, or letter/word spacing that is not a plain length. */
function altersGlyphOrder(style: CSSStyleDeclaration, property: string): boolean {
	return (
		BIDI_PROPERTY.test(property) ||
		(SPACING_PROPERTY.test(property) && !PLAIN_SPACING.test(style.getPropertyValue(property).trim()))
	);
}

function propertiesOf(style: CSSStyleDeclaration): string[] {
	const properties: string[] = [];
	for (let index = 0; index < style.length; index++) properties.push(style.item(index));
	return properties;
}

/** Upstream `aQ`: a style attribute without layout-escaping or glyph-reordering properties. */
function stripStyleProperties(css: string): string {
	if (!MAY_HOLD_LAYOUT_ESCAPE.test(css) && !MAY_HOLD_BIDI.test(css)) return css;
	const {style} = document.createElement("div");
	style.cssText = css;
	for (const property of propertiesOf(style)) {
		if (LAYOUT_ESCAPE_PROPERTY.test(property) || altersGlyphOrder(style, property)) style.removeProperty(property);
	}
	return style.cssText;
}

/** Upstream `D$`: CSS that can fetch nothing (no external url(), image functions or @import). */
function blockCssFetches(css: string): string {
	return css
		.replace(/\\/g, "-")
		.replace(/\burl\((?!\s*["']?#)/gi, "url-blocked(")
		.replace(/(?:-webkit-)?(?:image-set|image|cross-fade|src)\(/gi, "url-blocked(")
		.replace(/@import\b/gi, "@-blocked-import");
}

/** Upstream `Sv`: the rules of a stylesheet, or null without a CSS parser. */
function parseRules(css: string): CSSRuleList | null {
	try {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(css);
		return sheet.cssRules;
	} catch {
		// Fall back to a detached document's <style>.
	}
	try {
		const doc = document.implementation.createHTMLDocument("");
		const style = doc.createElement("style");
		style.textContent = css;
		doc.head.appendChild(style);
		return style.sheet?.cssRules ?? null;
	} catch {
		return null;
	}
}

/** Upstream `Uk`: keeps only plain style rules scoped under `#<scopeId>`. */
function scopeStyle(css: string, scopeId: string): string {
	const rules = parseRules(css);
	if (rules === null) {
		console.warn("mermaid style sanitize: no CSS parser available; dropping styles");
		return "";
	}
	const scope = `#${scopeId}`;
	const kept: string[] = [];
	for (const rule of Array.from(rules)) {
		if (!(rule instanceof CSSStyleRule)) continue;
		const selector = rule.selectorText;
		const scoped = selector.split(",").every((part) => {
			const trimmed = part.trim();
			if (!trimmed.startsWith(scope)) return false;
			const next = trimmed.charAt(scope.length);
			if (next !== "" && !" >.:[#".includes(next)) return false;
			return !trimmed.includes("(") && !trimmed.includes("+") && !trimmed.includes("~");
		});
		if (!scoped) continue;
		const {style} = rule;
		for (const property of propertiesOf(style)) {
			if (LAYOUT_ESCAPE_PROPERTY.test(property) || altersGlyphOrder(style, property)) {
				style.removeProperty(property);
				continue;
			}
			if (/^(?:-\w+-)?position$/i.test(property)) {
				const value = style.getPropertyValue(property).trim().toLowerCase();
				if (value !== "static" && value !== "relative" && value !== "absolute") style.removeProperty(property);
			}
		}
		const body = style.cssText;
		if (selector.includes("\\") || body.includes("\\") || body.includes("{") || body.includes("}")) continue;
		kept.push(`${selector} { ${body} }`);
	}
	return blockCssFetches(kept.join("\n"));
}

/** Upstream `Ej`. */
function blockStyleElementFetches(svg: string): string {
	return svg.replace(
		/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
		(_match, open: string, body: string, close: string) => open + blockCssFetches(body) + close,
	);
}

/** Upstream `zN`: presentation attributes that may reference paint servers. */
const PAINT_ATTRIBUTES: ReadonlySet<string> = new Set([
	"fill",
	"stroke",
	"filter",
	"mask",
	"clip-path",
	"marker-start",
	"marker-mid",
	"marker-end",
]);
const BIDI_OVERRIDES = /[\u202D\u202E]/g;

/** Upstream `Vb`: a drawn SVG made inert, its styles confined to `#<scopeId>`. */
export function sanitizeMermaidSvg(svg: string, scopeId: string): string {
	DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
		if (data.attrName === "style" || PAINT_ATTRIBUTES.has(data.attrName)) {
			data.attrValue = blockCssFetches(data.attrValue);
			if (data.attrName === "style") data.attrValue = stripStyleProperties(data.attrValue);
		} else if (data.attrName === "href" || data.attrName === "xlink:href") {
			if (!data.attrValue.trim().startsWith("#")) data.keepAttr = false;
		}
	});
	DOMPurify.addHook("uponSanitizeElement", (node, data) => {
		if (data.tagName === "style" && node.textContent) node.textContent = scopeStyle(node.textContent, scopeId);
		else if (data.tagName === "#text" && node.nodeValue)
			node.nodeValue = node.nodeValue.replace(BIDI_OVERRIDES, "\uFFFD");
	});
	try {
		return DOMPurify.sanitize(blockStyleElementFetches(svg), SANITIZE_CONFIG);
	} finally {
		DOMPurify.removeHook("uponSanitizeAttribute");
		DOMPurify.removeHook("uponSanitizeElement");
	}
}

// ---- source preparation (upstream Mv, fW) ----

/**
 * Upstream `Mv`: drops `@{…}` shape data and any `%%{…}%%` directive that itself holds shape data or a nested
 * directive, refusing to draw a source the strip cannot settle.
 */
function stripShapeData(source: string): string {
	const text = source.replace(/\r\n?/g, "\n");
	const frontMatter = /^-{3}[^\S\n\r]*[\n\r]([\s\S]*?)[\n\r]-{3}[^\S\n\r]*[\n\r]+/;
	const directive = /%{2}\{\s*(?:\w+\s*:|\w+)\s*(?:\w+|(?:(?!\}%{2}).|\r?\n)*)?\s*(?:\}%{2})?/gi;
	const shapeData = /@;{0,2}\{(?:"[^"]*"|[^"}])*\}?/g;
	const shapeDataStart = /@;{0,2}\{/;
	const clean = (part: string) => !shapeDataStart.test(part) && !part.includes("%%{");
	const head = frontMatter.exec(text)?.[0] ?? "";
	const kept = clean(head) ? head : "";
	let body = text.slice(kept.length);
	const directives: string[] = [];
	body = body.replace(directive, (match) => {
		if (clean(match.slice(3))) directives.push(match.endsWith("}%%") ? match : `${match}}%%`);
		return "";
	});
	let converged = false;
	for (let pass = 0; pass < 32; pass++) {
		const before = body;
		body = body.replace(shapeData, "").replace(directive, "");
		if (body === before) {
			converged = true;
			break;
		}
	}
	if (!converged)
		throw namedError(
			"MermaidShapeDataStripNotConverged",
			"mermaid shape-data strip did not converge; refusing to render",
		);
	const result = kept + directives.map((entry) => `${entry}\n`).join("") + body;
	if (shapeDataStart.test(result))
		throw namedError(
			"MermaidShapeDataNotStripped",
			"mermaid shape-data strip post-condition violated; refusing to render",
		);
	return result;
}

/** Upstream `fW`: a block diagram's `space:N` capped at 100. */
function capBlockSpace(source: string): string {
	if (!/^[^\S\n\r\u2028\u2029]*block/m.test(source)) return source;
	return source.replace(
		/s;{0,2}p;{0,2}a;{0,2}c;{0,2}e;{0,2}:;{0,2}(\d(?:;{0,2}\d)*)/g,
		(match: string, digits: string, offset: number) =>
			offset > 0 && /[A-Za-z_]/.test(source.charAt(offset - 1))
				? match
				: Number(digits.replace(/;/g, "")) > 100
					? "space:100"
					: match,
	);
}

/** Upstream `c$`: every `$` of a sequence diagram as mermaid's encoded `#36;`, so no `$$…$$` becomes KaTeX math. */
export function sequenceDollarsAsEntities(source: string): string {
	return /sequencediagram/i.test(source.replaceAll(";", ""))
		? source.replaceAll("$", "\uFB02\u00B0\u00B036\u00B6\u00DF")
		: source;
}

// ---- readable colours (upstream $g … Us, sg, cx) ----

/** Upstream `$g`: WCAG's 4.5:1 contrast for body text. */
const READABLE_CONTRAST = 4.5;
/** Upstream `yz`: a fill at least this opaque counts as solid. */
const SOLID_OPACITY = 240 / 255;
/** Upstream `mY`, `WZ`: the near-black and near-white a label falls back to. */
const NEAR_BLACK: Rgb = [25, 25, 25];
const NEAR_WHITE: Rgb = [245, 245, 245];
/** Upstream `HT`: the opacity an unreadable band is thinned to. */
const THIN_BAND_OPACITY = 0.1;
/** Upstream `dr`. */
const MAX_COLOR_CHARS = 64;
const RGB_FUNCTION = /^rgba?\(([0-9., \t]*)\)$/i;
const NAMED_OR_HSL = /^(?:[a-z]+|hsla?\([0-9.,% \t]*\))$/i;
const PLAIN_NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const STYLE_LINE = /^[ \t]*(style|classDef)[ \t]+(\S+)[ \t]+/i;
const HAS_STYLE_LINE = /^[ \t]*(?:style|classDef)[ \t]/im;
const ER_DIAGRAM = /^[ \t]*erDiagram\b/m;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

type Rgb = [number, number, number];

/** Upstream `Ye`: a hex colour's RGB, or undefined when it is not solid. */
function hexRgb(hex: string): Rgb | undefined {
	let digits = hex.slice(1);
	if (digits.length <= 4)
		digits = digits
			.split("")
			.map((digit) => digit + digit)
			.join("");
	if (digits.length === 8) {
		if (parseInt(digits.slice(6), 16) / 255 < SOLID_OPACITY) return undefined;
		digits = digits.slice(0, 6);
	}
	const value = parseInt(digits, 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Upstream `pQ`. */
const hexOf = (rgb: Rgb) =>
	`#${rgb
		.map((part) => part.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase()}`;

let colorParser: CanvasRenderingContext2D | null | undefined;

/** Upstream `uD`: any CSS colour's RGB, read back through a canvas for names and functions. */
function cssRgb(color: string): Rgb | undefined {
	const trimmed = color.trim();
	if (HEX_COLOR.test(trimmed)) return hexRgb(trimmed);
	if (colorParser === undefined)
		colorParser =
			typeof document === "undefined" ? null : (document.createElement("canvas").getContext("2d") ?? null);
	if (!colorParser) return undefined;
	colorParser.fillStyle = "#000001";
	colorParser.fillStyle = trimmed;
	const parsed: unknown = colorParser.fillStyle;
	return typeof parsed === "string" && parsed !== "#000001" && HEX_COLOR.test(parsed) ? hexRgb(parsed) : undefined;
}

/** Upstream `TK`. */
function opacityOf(value: string): number {
	const trimmed = value.trim();
	const opacity = trimmed.endsWith("%") ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
	return Number.isFinite(opacity) ? opacity : 0;
}

/** Upstream `Cj`. */
function luminance([red, green, blue]: Rgb): number {
	const channel = (value: number) => {
		const ratio = value / 255;
		return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/** Upstream `Di`. */
function contrast(first: Rgb, second: Rgb): number {
	const a = luminance(first);
	const b = luminance(second);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Upstream `Ex`: `text`, or the near-black or near-white that reads better on `fill` when `text` does not. */
function readableOn(fill: Rgb | undefined, text: Rgb): Rgb {
	if (!fill) return text;
	const current = contrast(fill, text);
	if (current >= READABLE_CONTRAST) return text;
	const onBlack = contrast(fill, NEAR_BLACK);
	const onWhite = contrast(fill, NEAR_WHITE);
	return Math.max(onBlack, onWhite) <= current ? text : onBlack >= onWhite ? NEAR_BLACK : NEAR_WHITE;
}

interface StyleLine {
	head: string;
	isClassDef: boolean;
	ids: string[];
	declarations: string;
	tail: string;
	appendable: boolean;
	setsFill: boolean;
	setsColor: boolean;
	fill: Rgb | undefined;
}

/** Upstream `m8`: a `style` / `classDef` line's ids and the fill and colour it sets. */
function styleLine(line: string): StyleLine | undefined {
	const match = STYLE_LINE.exec(line);
	if (!match) return undefined;
	const [head, keyword = "", ids = ""] = match;
	const rest = line.slice(head.length);
	const semicolon = rest.indexOf(";");
	const appendable =
		semicolon < 0 || (rest.slice(semicolon + 1).trim() === "" && (keyword === "style" || keyword === "classDef"));
	const declarations = (semicolon < 0 ? rest : rest.slice(0, semicolon)).trimEnd();
	let setsFill = false;
	let setsColor = false;
	let fill: Rgb | undefined;
	let solid = true;
	for (const declaration of declarations.split(",")) {
		const colon = declaration.indexOf(":");
		if (colon < 0) continue;
		const property = declaration.slice(0, colon).trim().toLowerCase();
		const value = declaration.slice(colon + 1);
		if (property === "color") setsColor = true;
		else if (property === "fill") {
			setsFill = true;
			fill = cssRgb(value);
		} else if (property === "fill-opacity" || property === "opacity") {
			setsFill = true;
			solid &&= opacityOf(value) >= SOLID_OPACITY;
		}
	}
	return {
		head,
		isClassDef: keyword.toLowerCase() === "classdef",
		ids: ids.split(","),
		declarations,
		tail: rest.slice(declarations.length),
		appendable,
		setsFill,
		setsColor,
		fill: solid ? fill : undefined,
	};
}

/**
 * Upstream `Us`: gives each `style` (and, when no style line sets a fill, each `classDef`) whose fill the theme's
 * text cannot be read on a `color:` that can, unless the line or another for its ids already sets one. The source
 * stays as written when nothing changes or the result would pass `maxText`.
 */
export function readableStyleColors(
	source: string,
	textColor: string | undefined,
	maxText: number | undefined,
): string {
	const text = textColor === undefined ? undefined : cssRgb(textColor);
	if (!text || !HAS_STYLE_LINE.test(source) || ER_DIAGRAM.test(source)) return source;
	const lines = source.split("\n");
	const parsed = lines.map(styleLine);
	const coloured = new Set(parsed.flatMap((line) => (line?.setsColor ? line.ids : [])));
	const styleSetsFill = parsed.some((line) => line?.setsFill && !line.isClassDef);
	const recoloured: boolean[] = [];
	const rewritten = lines.map((line, index) => {
		const style = parsed[index];
		if (!style?.appendable || !style.setsFill || style.ids.some((id) => coloured.has(id))) return line;
		const color = readableOn(style.fill, text);
		if (style.isClassDef && (styleSetsFill || color === text)) return line;
		recoloured.push(color !== text);
		return `${style.head}${style.declarations},color:${hexOf(color)}${style.tail}`;
	});
	if (!recoloured.includes(true)) return source;
	const result = rewritten.join("\n");
	return maxText !== undefined && result.length > maxText ? source : result;
}

/** Upstream `sg`: a fill attribute's RGB and opacity. */
function fillOf(color: string): {rgb: Rgb; opacity: number} | undefined {
	if (color.length > MAX_COLOR_CHARS) return undefined;
	const parts = RGB_FUNCTION.exec(color)?.[1]
		?.split(",")
		.map((part) => part.trim());
	if (parts) {
		if ((parts.length !== 3 && parts.length !== 4) || !parts.every((part) => PLAIN_NUMBER.test(part)))
			return undefined;
		const [red = 0, green = 0, blue = 0, opacity = 1] = parts.map(Number);
		const channel = (value: number) => Math.round(Math.min(value, 255));
		return {rgb: [channel(red), channel(green), channel(blue)], opacity};
	}
	const rgb = HEX_COLOR.test(color) || NAMED_OR_HSL.test(color) ? cssRgb(color) : undefined;
	return rgb && {rgb, opacity: 1};
}

/** Upstream `cx`: a sequence diagram's `rect` bands the text cannot be read on, thinned to 10% opacity. */
export function dimUnreadableSequenceBands(svg: Element, textColor: string | undefined): void {
	const text = textColor === undefined ? undefined : cssRgb(textColor);
	if (!text) return;
	svg.querySelectorAll("rect.rect").forEach((rect) => {
		const fill = fillOf(rect.getAttribute("fill") ?? "");
		if (fill && fill.opacity > THIN_BAND_OPACITY && contrast(fill.rgb, text) < READABLE_CONTRAST) {
			const [red, green, blue] = fill.rgb;
			rect.setAttribute("fill", `rgba(${red}, ${green}, ${blue}, ${THIN_BAND_OPACITY})`);
		}
	});
}

/** Upstream `W$`: the colour the theme draws node text in. */
export function textColorOf(config: MermaidConfig): string | undefined {
	const variables: unknown = config.themeVariables;
	const color: unknown =
		typeof variables === "object" && variables !== null
			? (Reflect.get(variables, "nodeTextColor") ?? Reflect.get(variables, "primaryTextColor"))
			: undefined;
	return typeof color === "string" ? color : undefined;
}

// ---- drawing (upstream km, pw) ----

const FONT_LIST = /(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,"'])+/g;
const fontKey = (family: string) =>
	family
		.trim()
		.replace(/^(["'])(.*)\1$/, "$2")
		.toLowerCase();

/** Upstream `qT`: the body's font stack without web fonts (the sandbox cannot load them), else sans-serif. */
function mermaidFontFamily(): string {
	const webFonts = new Set<string>();
	// oxlint-disable-next-line typescript/no-unnecessary-condition -- jsdom and older engines have no FontFaceSet
	document.fonts?.forEach((face) => webFonts.add(fontKey(face.family)));
	const families = (getComputedStyle(document.body).fontFamily.match(FONT_LIST) ?? [])
		.map((family) => family.trim())
		.filter((family) => family !== "" && !webFonts.has(fontKey(family)));
	return families.length > 0 ? families.join(", ") : "sans-serif";
}

/**
 * Upstream `Mp`: the SVG out of the base64 `src` of mermaid's sandbox iframe, after `adjust` (a colour fix that
 * may fail without losing the drawing).
 */
function extractSandboxSvg(html: string, adjust?: (svg: SVGSVGElement) => void): string {
	const encoded = /;base64,([^"]+)"/.exec(html)?.[1];
	if (encoded === undefined)
		throw namedError("MermaidSandboxNoIframeSrc", "mermaid sandbox render: missing data-uri iframe src");
	const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
	const svg = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "text/html").querySelector("svg");
	if (!svg) throw namedError("MermaidSandboxNoSvg", "mermaid sandbox render: no <svg> in iframe body");
	try {
		adjust?.(svg);
	} catch {
		console.warn(
			"mermaid: a step that changes a finished diagram's colours failed; the diagram is shown without the change, or with part of it",
		);
	}
	return svg.outerHTML;
}

/** Upstream `I7`: `work`, or a MermaidRenderTimeout after `ms`, calling `onTimeout` first. */
async function withTimeLimit<T>(work: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					try {
						onTimeout?.();
					} finally {
						reject(namedError("MermaidRenderTimeout", `mermaid render exceeded ${ms}ms`));
					}
				}, ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

interface DrawQueue {
	last: Promise<unknown>;
	drawnMs: number;
	/** A draw that ran past its limit and is still running in mermaid. */
	stuck?: Promise<unknown> | undefined;
}

/** Upstream `iL`: every draw waits for the one before it. */
let queue: DrawQueue = {last: Promise.resolve(), drawnMs: 0};

type MermaidGuard = typeof import("./mermaid-guard");

/** Upstream `Gs`: the guard module, once loaded. */
let guard: MermaidGuard | undefined;
let guardModule: Promise<MermaidGuard> | undefined;

/** Upstream `FF`: the guard (chunk c763d2034), imported once beside mermaid. */
export async function loadMermaidGuard(): Promise<MermaidGuard> {
	guardModule ??= import("./mermaid-guard").then((module) => {
		guard = module;
		return module;
	});
	return guardModule;
}

/** Upstream `Kx`: mermaid, with the guard starting to load beside it. */
export async function loadMermaidWithGuard(): Promise<Mermaid> {
	loadMermaidGuard().catch(() => undefined);
	return loadMermaid();
}

/** Upstream `Gs !== undefined`: whether the guard loaded, so a failed draw was mermaid's and not a missing chunk. */
export const mermaidGuardLoaded = (): boolean => guard !== undefined;

/** Upstream `aL`: `error` when the guard refused the draw. */
export const asMermaidRefusal = (error: unknown): MermaidRefusal | undefined =>
	guard?.isMermaidRefusal(error) ? error : undefined;

export interface DrawnMermaid {
	svg: string;
	/** The render id the drawing's styles are scoped under. */
	diagramId: string;
	diagramType: string;
	overLimit: string | undefined;
	drawMs: number;
	typeDrawnBefore: boolean;
	measured: MeasuredDraw | undefined;
}

/** The narrow mermaid API a draw needs. */
type MermaidApi = Pick<Mermaid, "initialize" | "render"> & Partial<Pick<Mermaid, "detectType" | "mermaidAPI">>;

type Now = () => number;

export interface DrawOptions {
	signal?: AbortSignal;
	limitMs?: number;
	now?: Now;
	/** The parsed diagram's type, once the guard has seen it. */
	onParsed?: (diagramType: string) => void;
	/** The type mermaid detects in a text it could not parse. */
	onUnparsed?: (diagramType: string) => void;
	/** The repair a sequence diagram was redrawn with. */
	onRepair?: (repair: SequenceRepair["repair"]) => void;
	/** Faces to add to the sandbox frame's document. */
	fonts?: Iterable<FontFace>;
	/** Thin a sequence diagram's unreadable rect bands. */
	dimUnreadableBands?: boolean;
}

interface DrawRun {
	signal: AbortSignal | undefined;
	limitMs: number | undefined;
	queue: DrawQueue;
	now: Now;
	onParsed: ((diagramType: string) => void) | undefined;
	onUnparsed: ((diagramType: string) => void) | undefined;
	onRepair: ((repair: SequenceRepair["repair"]) => void) | undefined;
	fonts: Iterable<FontFace> | undefined;
	dimBands: boolean;
}

/** Upstream `yh`: a mermaid parse error (it carries the parser's `hash`). */
const isParseError = (error: unknown) =>
	typeof error === "object" && error !== null && "hash" in error && typeof error.hash === "object";

/**
 * Upstream `$W`: one draw. The source goes through the clean-up passes and rewrites; a sequence diagram whose
 * parse failed is redrawn once with the guard's repair, its wait for a turn not counted against the queue.
 */
async function drawGuarded(
	checks: MermaidGuard,
	mermaid: MermaidApi,
	config: MermaidConfig,
	scopeId: string,
	source: string,
	run: DrawRun,
): Promise<DrawnMermaid> {
	const fontFamily = !config.fontFamily || config.fontFamily === "inherit" ? mermaidFontFamily() : config.fontFamily;
	mermaid.initialize({
		...config,
		fontFamily,
		htmlLabels: false,
		securityLevel: "sandbox",
		secure: MERMAID_SECURE_KEYS,
	});
	const prepared = sequenceDollarsAsEntities(
		readableStyleColors(
			capBlockSpace(stripShapeData(source)),
			textColorOf(config),
			checks.mermaidMaxText(config.maxTextSize),
		),
	);
	let detected: (() => string) | undefined;
	const noteUnparsed = (detect: () => string) => {
		let type: string | undefined;
		detected = () => (type ??= detect());
		if (run.onUnparsed) run.onUnparsed(detected());
	};
	try {
		return await drawChecked(checks, mermaid, config, scopeId, source, prepared, run, noteUnparsed);
	} catch (error) {
		const repaired =
			detected !== undefined && isParseError(error) && detected() === "sequence"
				? checks.repairSequenceText(prepared, error)
				: undefined;
		if (!repaired || repaired.text.length > checks.mermaidMaxText(config.maxTextSize)) throw error;
		const waitedFrom = performance.now();
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 0);
		});
		run.queue.drawnMs -= performance.now() - waitedFrom;
		throwIfAborted(run.signal);
		run.onRepair?.(repaired.repair);
		return drawChecked(checks, mermaid, config, scopeId, source, repaired.text, run, noteUnparsed);
	}
}

/**
 * Upstream `QZ`: one sandboxed render under the guard. The render id comes from the guard so the patched mermaid
 * can hand it the parsed diagram; the frame gets its CSP and the meter as it goes in; and the result is refused
 * when the check never ran, the meter came off, or a limit was passed.
 */
async function drawChecked(
	checks: MermaidGuard,
	mermaid: MermaidApi,
	config: MermaidConfig,
	scopeId: string,
	source: string,
	prepared: string,
	{limitMs, queue: drawQueue, now, onParsed, fonts, dimBands}: DrawRun,
	noteUnparsed: (detect: () => string) => void,
): Promise<DrawnMermaid> {
	checks.checkMermaidLength(prepared, config.maxTextSize);
	const seen: MermaidDrawSeen = {ran: false, diagramType: "other"};
	let frame: HTMLIFrameElement | undefined;
	const handle = checks.registerMermaidCheck(scopeId, (diagram) => {
		try {
			checks.checkParsedDiagram(diagram, seen, now);
			checks.checkGitgraphText(source, prepared, seen);
			const lost = checks.mermaidMeterLost(seen, frame, false);
			if (lost) throw lost;
		} finally {
			onParsed?.(seen.diagramType);
		}
	});
	if (!handle) throw checks.mermaidRefusal("MermaidGuardNotRun");
	const id = handle.id;
	const host = document.createElement("div");
	host.setAttribute("aria-hidden", "true");
	host.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;visibility:hidden;pointer-events:none";
	document.body.appendChild(host);
	const csp = {injected: false};
	const append = host.appendChild.bind(host);
	host.appendChild = <T extends Node>(child: T): T => {
		const added = append(child);
		if (child instanceof HTMLIFrameElement) {
			const doc = child.contentDocument;
			if (doc && doc.readyState !== "complete") doc.defaultView?.stop();
			if (doc?.head && !doc.head.querySelector("meta[http-equiv]")) {
				const meta = doc.createElement("meta");
				meta.httpEquiv = "Content-Security-Policy";
				meta.content = MERMAID_FRAME_CSP;
				doc.head.appendChild(meta);
				csp.injected = true;
				if (fonts) for (const face of fonts) doc.fonts.add(face);
			}
			frame = child;
			checks.meterMermaidFrame(doc?.defaultView, seen, now, undefined, () => {
				host.remove();
			});
		}
		return added;
	};
	let stopMeasuring: () => void;
	try {
		stopMeasuring = checks.startMermaidMeasuring(seen, now);
	} catch (error) {
		handle.done();
		host.remove();
		throw error;
	}
	const drawing = mermaid.render(id, prepared, host);
	const settled = drawing.catch(() => undefined);
	void settled.then(() => {
		handle.done();
		seen.cleanup?.();
		stopMeasuring();
		checks.noteMermaidRenderSettled(now);
	});
	void drawing.then(
		() => {
			if (!seen.ran) checks.noteMermaidHookMissing();
		},
		() => undefined,
	);
	const markStuck = () => {
		drawQueue.stuck = settled;
		void settled.then(() => {
			if (drawQueue.stuck === settled) drawQueue.stuck = undefined;
		});
	};
	try {
		const {svg} = await withTimeLimit(
			drawing,
			limitMs ?? 5000,
			limitMs === undefined ? undefined : markStuck,
		).catch((error: unknown) => {
			const due = checks.mermaidRefusalDue(seen);
			if (!due && !seen.ran)
				noteUnparsed(() =>
					checks.detectedMermaidType(
						// oxlint-disable-next-line typescript/no-deprecated -- upstream reads the config through mermaidAPI
						(text) => mermaid.detectType?.(text, mermaid.mermaidAPI?.getConfig()),
						prepared,
					),
				);
			throw due ?? error;
		});
		const due = checks.mermaidRefusalDue(seen);
		if (due) throw due;
		if (!csp.injected)
			throw namedError(
				"MermaidCspNotInjected",
				"mermaid sandbox render: CSP not injected via host.appendChild \u2014 iframe insertion path changed",
			);
		if (!seen.ran) {
			checks.noteMermaidHookMissing();
			throw checks.mermaidRefusal("MermaidGuardNotRun");
		}
		const lost = checks.mermaidMeterLost(seen, frame, true);
		if (lost) throw lost;
		const textColor = textColorOf(config);
		return {
			svg: extractSandboxSvg(
				svg,
				dimBands && seen.diagramType === "sequence"
					? (drawn) => {
							dimUnreadableSequenceBands(drawn, textColor);
						}
					: undefined,
			),
			diagramId: id,
			diagramType: seen.diagramType,
			overLimit: seen.overLimit,
			...checks.closeMermaidDraw(seen, now),
			measured: seen.measured,
		};
	} finally {
		stopMeasuring();
		host.remove();
	}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted !== true) return;
	const reason: unknown = signal.reason;
	throw reason instanceof Error
		? reason
		: namedError("AbortError", "not drawn: its caller cancelled it before it was drawn");
}

/** Upstream `pw`: queue one draw behind the others, once the guard has loaded. */
export async function drawMermaid(
	mermaid: MermaidApi,
	config: MermaidConfig,
	scopeId: string,
	source: string,
	{
		signal,
		limitMs,
		now = () => performance.now(),
		onParsed,
		onUnparsed,
		onRepair,
		fonts,
		dimUnreadableBands = false,
	}: DrawOptions = {},
): Promise<DrawnMermaid> {
	const drawQueue = queue;
	const drawnBefore = drawQueue.drawnMs;
	const result = loadMermaidGuard().then(async (checks) => {
		const run = drawQueue.last.then(async () => {
			throwIfAborted(signal);
			if (drawQueue.stuck)
				throw namedError(
					"MermaidQueueStalled",
					"not drawn: an earlier diagram ran past its time limit and mermaid is still working on it; new diagrams are drawn again when it ends, or after a reload",
				);
			if (limitMs !== undefined && drawQueue.drawnMs - drawnBefore > limitMs)
				throw namedError(
					"MermaidQueueTimeout",
					"not drawn: the diagrams ahead of this one took longer to draw than its time limit; it is asked for again when it next mounts",
				);
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 0);
			});
			throwIfAborted(signal);
			const start = performance.now();
			try {
				return await drawGuarded(checks, mermaid, config, scopeId, source, {
					signal,
					limitMs,
					queue: drawQueue,
					now,
					onParsed,
					onUnparsed,
					onRepair,
					fonts,
					dimBands: dimUnreadableBands,
				});
			} finally {
				drawQueue.drawnMs += performance.now() - start;
			}
		});
		drawQueue.last = run.catch(() => undefined);
		return run;
	});
	result.catch(() => undefined);
	return result;
}

// ---- caches (upstream yL/cy/u$/B1 and Pw/vR) ----

export interface CachedDiagram {
	svg: string;
	scopeId: string;
	/** The window width it was drawn at. */
	width: number;
}

/** Upstream `Pv`, `z7`, `ex`, `xi`. */
const DRAWN_ENTRIES = 48;
const DRAWN_CHARS = 4_000_000;
const DRAWN_SKIP_CHARS = 512_000;
const WIDTH_DRIFT = 120;
const drawn = new Map<string, CachedDiagram>();
let drawnChars = 0;

/** Upstream `Sb`. */
const windowWidth = () => (typeof window === "undefined" ? 0 : window.innerWidth);

/** Upstream `bO`: a drawn diagram's cache key. */
export const drawnKey = (mode: string, code: string): string => JSON.stringify([mode, code]);

function forgetDrawn(key: string): void {
	const entry = drawn.get(key);
	if (!entry) return;
	drawn.delete(key);
	drawnChars -= entry.svg.length;
}

/** Upstream `cy`: remember a drawn diagram, evicting the oldest past 48 entries or 4M chars. */
export function rememberDrawn(key: string, entry: CachedDiagram): void {
	if (entry.svg.length > DRAWN_SKIP_CHARS) return;
	forgetDrawn(key);
	drawn.set(key, entry);
	drawnChars += entry.svg.length;
	while (drawn.size > DRAWN_ENTRIES || drawnChars > DRAWN_CHARS) {
		const oldest = drawn.keys().next().value;
		if (oldest === undefined) break;
		forgetDrawn(oldest);
	}
}

/** Upstream `u$`: mark a cached diagram as just used. */
export function touchDrawn(key: string): void {
	const entry = drawn.get(key);
	if (!entry) return;
	drawn.delete(key);
	drawn.set(key, entry);
}

const SCOPE_ID = /^[A-Za-z0-9-]+$/;

/**
 * Upstream `B1`: a cached diagram re-scoped to `scopeId` and sanitized again, unless the window has changed width
 * by more than 120px since it was drawn.
 */
export function cachedDiagram(key: string, scopeId: string): CachedDiagram | undefined {
	const entry = drawn.get(key);
	if (!entry || Math.abs(entry.width - windowWidth()) > WIDTH_DRIFT) return undefined;
	if (!SCOPE_ID.test(entry.scopeId) || !SCOPE_ID.test(scopeId)) return undefined;
	return {
		svg: sanitizeMermaidSvg(entry.svg.replaceAll(entry.scopeId, scopeId), scopeId),
		scopeId,
		width: entry.width,
	};
}

/** Upstream `MZ`. */
const REFUSED_ENTRIES = 48;
const REFUSED_CHARS = 1_000_000;
const refused = new Map<string, string>();
let refusedChars = 0;

function forgetRefusal(code: string): void {
	if (refused.delete(code)) refusedChars -= code.length;
}

/** Upstream `vR`: remember why a source was refused, so a remount does not draw it again. */
export function rememberRefusal(code: string, reason: string): void {
	forgetRefusal(code);
	if (code.length > REFUSED_CHARS) return;
	refused.set(code, reason);
	refusedChars += code.length;
	for (const oldest of refused.keys()) {
		if (refused.size <= REFUSED_ENTRIES && refusedChars <= REFUSED_CHARS) break;
		forgetRefusal(oldest);
	}
}

/**
 * Upstream `sy`: whether a refusal is remembered for the source. Not the length (the cleaned text may change),
 * not an unreadable measure, and not a clock refusal that the page being hidden (or a report-only count) explains.
 */
export function rememberedRefusal(refusal: MermaidRefusal | undefined): boolean {
	return (
		refusal?.refusedBy !== undefined &&
		refusal.refusedBy !== "length" &&
		!(refusal.refusedBy === "measure" && refusal.unreadable === true) &&
		!(
			refusal.byClock === true &&
			(refusal.refusedBy === "measure" ? refusal.hidden === true : !refusal.overReportCount)
		)
	);
}

/** Upstream `Pw.get`. */
export function refusalFor(code: string): string | undefined {
	return refused.get(code);
}

/** Upstream `$6`: the scope id mermaid draws under, from a React id. */
export const mermaidScopeId = (reactId: string): string => `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;

/** Upstream `I8`: the shadow root's drawing `<div>`, created after a leading `<style>` the first time. */
function shadowDrawing(host: HTMLElement, style: string): HTMLElement {
	const root = host.shadowRoot ?? host.attachShadow({mode: "open"});
	const last = root.lastElementChild;
	if (last instanceof HTMLElement && last.localName === "div") {
		const first = root.firstElementChild;
		if (first?.localName === "style" && first.textContent !== style) first.textContent = style;
		return last;
	}
	const doc = host.ownerDocument;
	const styleElement = doc.createElement("style");
	styleElement.textContent = style;
	const drawing = doc.createElement("div");
	root.replaceChildren(styleElement, drawing);
	return drawing;
}

const written = new WeakMap<HTMLElement, string>();

/** Upstream `ZU`: write an SVG into the host's shadow root, skipping an unchanged one. */
export function writeShadowSvg(host: HTMLElement, svg: string, style: string): void {
	const drawing = shadowDrawing(host, style);
	if (written.get(drawing) === svg) return;
	drawing.innerHTML = svg;
	written.set(drawing, svg);
}

/** Clears the module state between tests. */
export function resetMermaidCachesForTests(): void {
	drawn.clear();
	drawnChars = 0;
	refused.clear();
	refusedChars = 0;
	queue = {last: Promise.resolve(), drawnMs: 0};
	guard?._test.reset();
}
