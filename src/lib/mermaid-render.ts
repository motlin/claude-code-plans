import DOMPurify from "dompurify";
import type {Mermaid, MermaidConfig} from "mermaid";

/*
 * Upstream's mermaid renderer support (shared-41, dumps/markdown-mermaid-diagram-render-shared41-renderer.txt):
 * the lazy mermaid import, the serialized draw queue with its time limit, the sandbox iframe CSP, the SVG pulled
 * back out of the iframe, DOMPurify sanitizing with style scoping, the shadow-root writer and the two caches.
 * Upstream's guard module (c763d2034: readability refusals and measuring) is a separate feature and not here.
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

/** Upstream `Mp`: the SVG out of the base64 `src` of mermaid's sandbox iframe. */
function extractSandboxSvg(html: string): string {
	const encoded = /;base64,([^"]+)"/.exec(html)?.[1];
	if (encoded === undefined)
		throw namedError("MermaidSandboxNoIframeSrc", "mermaid sandbox render: missing data-uri iframe src");
	const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
	const svg = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "text/html").querySelector("svg");
	if (!svg) throw namedError("MermaidSandboxNoSvg", "mermaid sandbox render: no <svg> in iframe body");
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

export interface DrawnMermaid {
	svg: string;
	diagramId: string;
}

/** The narrow mermaid API a draw needs. */
type MermaidApi = Pick<Mermaid, "initialize" | "render">;

/** Upstream `km`: one sandboxed draw into a hidden host, with the frame's CSP injected. */
async function drawOnce(
	mermaid: MermaidApi,
	config: MermaidConfig,
	id: string,
	source: string,
	limitMs: number | undefined,
	drawQueue: DrawQueue,
): Promise<DrawnMermaid> {
	const fontFamily = !config.fontFamily || config.fontFamily === "inherit" ? mermaidFontFamily() : config.fontFamily;
	mermaid.initialize({
		...config,
		fontFamily,
		htmlLabels: false,
		securityLevel: "sandbox",
		secure: MERMAID_SECURE_KEYS,
	});
	const prepared = capBlockSpace(stripShapeData(source));
	const host = document.createElement("div");
	host.setAttribute("aria-hidden", "true");
	host.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;visibility:hidden;pointer-events:none";
	document.body.appendChild(host);
	const csp = {injected: false};
	const append = host.appendChild.bind(host);
	host.appendChild = <T extends Node>(child: T): T => {
		const added = append(child);
		if (child instanceof HTMLIFrameElement) {
			const frame = child.contentDocument;
			if (frame && frame.readyState !== "complete") frame.defaultView?.stop();
			if (frame?.head && !frame.head.querySelector("meta[http-equiv]")) {
				const meta = frame.createElement("meta");
				meta.httpEquiv = "Content-Security-Policy";
				meta.content = MERMAID_FRAME_CSP;
				frame.head.appendChild(meta);
				csp.injected = true;
			}
		}
		return added;
	};
	const drawing = mermaid.render(id, prepared, host);
	const settled = drawing.catch(() => undefined);
	const markStuck = () => {
		drawQueue.stuck = settled;
		void settled.then(() => {
			if (drawQueue.stuck === settled) drawQueue.stuck = undefined;
		});
	};
	try {
		const {svg} = await withTimeLimit(drawing, limitMs ?? 5000, limitMs === undefined ? undefined : markStuck);
		if (!csp.injected)
			throw namedError(
				"MermaidCspNotInjected",
				"mermaid sandbox render: CSP not injected via host.appendChild \u2014 iframe insertion path changed",
			);
		return {svg: extractSandboxSvg(svg), diagramId: id};
	} finally {
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

/** Upstream `pw`: queue one draw behind the others. */
export async function drawMermaid(
	mermaid: MermaidApi,
	config: MermaidConfig,
	id: string,
	source: string,
	{signal, limitMs}: {signal?: AbortSignal; limitMs?: number} = {},
): Promise<DrawnMermaid> {
	const drawQueue = queue;
	const drawnBefore = drawQueue.drawnMs;
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
			return await drawOnce(mermaid, config, id, source, limitMs, drawQueue);
		} finally {
			drawQueue.drawnMs += performance.now() - start;
		}
	});
	drawQueue.last = run.catch(() => undefined);
	return run;
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
}
