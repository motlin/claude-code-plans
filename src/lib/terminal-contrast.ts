/**
 * A minimum foreground/background contrast for ghostty-web terminals, ported
 * from xterm.js's `minimumContrastRatio` that claude.ai/code's terminal sets
 * (4.5, or 7 while `prefers-contrast: more` matches). CLIs pick truecolor
 * greys for their own, usually dark, theme, so on a light terminal theme
 * those would otherwise draw light-on-light; ghostty-web 0.4 has no such
 * option, so the renderer's per-cell text pass is wrapped instead.
 */

import type {Terminal} from "ghostty-web";

export type Rgb = readonly [number, number, number];

const FAINT = 128;
const INVERSE = 16;

/** Upstream's floor: WCAG AA 4.5, or AAA 7 when the OS asks for more contrast. */
export function minimumContrastRatio(contrastMore: boolean): number {
	return contrastMore ? 7 : 4.5;
}

/** `#rrggbb[aa]` / `#rgb[a]` as RGB, or undefined for anything else. */
export function parseHexColor(color: string): Rgb | undefined {
	const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color);
	if (match?.[1] === undefined) return undefined;
	const digits = match[1].length <= 4 ? match[1].replace(/./g, (digit) => digit + digit) : match[1];
	return [
		Number.parseInt(digits.slice(0, 2), 16),
		Number.parseInt(digits.slice(2, 4), 16),
		Number.parseInt(digits.slice(4, 6), 16),
	];
}

function channelLuminance(value: number): number {
	const scaled = value / 255;
	return scaled <= 0.039_28 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: Rgb): number {
	return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return la < lb ? (lb + 0.05) / (la + 0.05) : (la + 0.05) / (lb + 0.05);
}

/** Steps the foreground 10% toward black until it meets the ratio, as xterm does. */
function reduceLuminance(background: Rgb, foreground: Rgb, ratio: number): Rgb {
	let [r, g, b] = foreground;
	while (contrastRatio([r, g, b], background) < ratio && (r > 0 || g > 0 || b > 0)) {
		r -= Math.max(0, Math.ceil(r * 0.1));
		g -= Math.max(0, Math.ceil(g * 0.1));
		b -= Math.max(0, Math.ceil(b * 0.1));
	}
	return [r, g, b];
}

/** Steps the foreground 10% toward white until it meets the ratio, as xterm does. */
function increaseLuminance(background: Rgb, foreground: Rgb, ratio: number): Rgb {
	let [r, g, b] = foreground;
	while (contrastRatio([r, g, b], background) < ratio && (r < 255 || g < 255 || b < 255)) {
		r = Math.min(255, r + Math.ceil((255 - r) * 0.1));
		g = Math.min(255, g + Math.ceil((255 - g) * 0.1));
		b = Math.min(255, b + Math.ceil((255 - b) * 0.1));
	}
	return [r, g, b];
}

/**
 * The foreground moved just far enough from the background to meet the
 * ratio — darker when it is already the darker of the two, lighter
 * otherwise, falling back to the other direction when that one runs out of
 * room — or undefined when it already meets the ratio. xterm's
 * `color.ensureContrastRatio`.
 */
export function ensureContrastRatio(background: Rgb, foreground: Rgb, ratio: number): Rgb | undefined {
	if (contrastRatio(background, foreground) >= ratio) return undefined;
	const darker = relativeLuminance(foreground) < relativeLuminance(background);
	const first = darker
		? reduceLuminance(background, foreground, ratio)
		: increaseLuminance(background, foreground, ratio);
	const firstRatio = contrastRatio(background, first);
	if (firstRatio >= ratio) return first;
	const second = darker
		? increaseLuminance(background, foreground, ratio)
		: reduceLuminance(background, foreground, ratio);
	return firstRatio > contrastRatio(background, second) ? first : second;
}

/**
 * Glyphs xterm exempts from the floor because they are drawn as shapes, not
 * text: box drawing and block elements, and the private-use area that
 * Powerline and Nerd Font glyphs live in.
 */
function isExemptGlyph(codepoint: number): boolean {
	return (codepoint >= 0x25_00 && codepoint <= 0x25_9f) || (codepoint >= 0xe0_00 && codepoint <= 0xf8_ff);
}

/** The ghostty-web cell fields the text pass reads colours and flags from. */
export interface ContrastCell {
	codepoint: number;
	fg_r: number;
	fg_g: number;
	fg_b: number;
	bg_r: number;
	bg_g: number;
	bg_b: number;
	flags: number;
}

/** The slice of ghostty-web's `CanvasRenderer` the floor wraps. */
export interface ContrastRenderer {
	theme: {background: string};
	renderCellText(cell: ContrastCell, x: number, y: number): void;
}

/**
 * Wraps the renderer's per-cell text pass so a foreground below `ratio()`
 * against the cell's background (its own, else the theme background) is
 * drawn adjusted, then restores the pooled cell. The ratio is read on every
 * draw, so a change applies on the next render; 1 turns the floor off, and
 * faint text gets half the floor, like xterm's dim.
 */
export function installMinimumContrast(renderer: ContrastRenderer, ratio: () => number): void {
	const renderCellText = renderer.renderCellText.bind(renderer);
	renderer.renderCellText = (cell, x, y) => {
		const floor = ratio() / (cell.flags & FAINT ? 2 : 1);
		if (floor <= 1 || isExemptGlyph(cell.codepoint)) {
			renderCellText(cell, x, y);
			return;
		}
		const inverse = (cell.flags & INVERSE) !== 0;
		const fg: Rgb = [cell.fg_r, cell.fg_g, cell.fg_b];
		const bg: Rgb = [cell.bg_r, cell.bg_g, cell.bg_b];
		const text = inverse ? bg : fg;
		const hasOwnBackground = inverse || bg[0] !== 0 || bg[1] !== 0 || bg[2] !== 0;
		const behind = inverse ? fg : hasOwnBackground ? bg : parseHexColor(renderer.theme.background);
		const adjusted = behind === undefined ? undefined : ensureContrastRatio(behind, text, floor);
		if (adjusted === undefined) {
			renderCellText(cell, x, y);
			return;
		}
		const writeText = (rgb: Rgb): void => {
			if (inverse) [cell.bg_r, cell.bg_g, cell.bg_b] = rgb;
			else [cell.fg_r, cell.fg_g, cell.fg_b] = rgb;
		};
		writeText(adjusted);
		try {
			renderCellText(cell, x, y);
		} finally {
			writeText(text);
		}
	};
}

function isContrastRenderer(value: unknown): value is ContrastRenderer {
	if (typeof value !== "object" || value === null) return false;
	const theme: unknown = Reflect.get(value, "theme");
	return (
		typeof Reflect.get(value, "renderCellText") === "function" &&
		typeof theme === "object" &&
		theme !== null &&
		typeof Reflect.get(theme, "background") === "string"
	);
}

const CONTRAST_MORE = "(prefers-contrast: more)";

/**
 * Applies upstream's contrast floor to a ghostty-web renderer, following
 * `prefers-contrast: more` live and calling `redraw` when it flips. Returns
 * the media-listener cleanup; a renderer without the expected text pass (a
 * ghostty-web upgrade that renamed it) is left as-is.
 */
export function installContrastFloor(renderer: unknown, redraw: () => void): () => void {
	if (!isContrastRenderer(renderer)) return () => undefined;
	const media = window.matchMedia(CONTRAST_MORE);
	installMinimumContrast(renderer, () => minimumContrastRatio(media.matches));
	media.addEventListener("change", redraw);
	return () => {
		media.removeEventListener("change", redraw);
	};
}

/** {@link installContrastFloor} on an opened terminal, redrawing every row on a change. */
export function installTerminalContrast(terminal: Terminal): () => void {
	return installContrastFloor(terminal.renderer, () => {
		if (terminal.renderer && terminal.wasmTerm) {
			terminal.renderer.render(terminal.wasmTerm, true, terminal.viewportY, terminal);
		}
	});
}
