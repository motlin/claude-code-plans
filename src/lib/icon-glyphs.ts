import {
	Archive,
	ArrowRight,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	CodeXml,
	CornerDownLeft,
	Database,
	Ellipsis,
	File,
	Globe,
	Image,
	type LucideIcon,
	type LucideProps,
	Paperclip,
	Plus,
	Presentation,
	Scroll,
	Search,
	Sheet,
	Square,
	StickyNote,
	X,
} from "lucide-react";
import {createElement, type ComponentType} from "react";

import type {AnthropiconName} from "./anthropicon-names";

/*
 * The lucide stand-in for each Anthropicons glyph the app draws. Only the drawings differ from upstream:
 * `Icon` copies the size, stroke, mirror and rotate contract around them. Every entry ships in the cold
 * bundle wherever `Icon` is used, so add a name only when a surface starts drawing it.
 */
export const ICON_GLYPHS = {
	Add: Plus,
	Archive,
	ArrowReturn: CornerDownLeft,
	ArrowRight,
	Attachment: Paperclip,
	CaretDown: ChevronDown,
	CaretRight: ChevronRight,
	CaretUp: ChevronUp,
	Check,
	Code: CodeXml,
	Database,
	DotsHorizontal: Ellipsis,
	File,
	Globe,
	Image,
	Note: StickyNote,
	Scroll,
	Search,
	Slides: Presentation,
	Spreadsheet: Sheet,
	Stop: Square,
	X,
} satisfies Partial<Record<AnthropiconName, LucideIcon>>;

type GlyphProps = Omit<LucideProps, "ref">;

/** Strips lucide's sizing props so a hand-drawn svg takes only the shared attributes. */
function svgAttributes({size: _size, strokeWidth: _stroke, absoluteStrokeWidth: _absolute, ...rest}: GlyphProps) {
	return rest;
}

/** Upstream's `StopFilled`: a filled rounded square about 12px inside the 20px icon box. */
function StopFilled(props: GlyphProps) {
	return createElement(
		"svg",
		{viewBox: "0 0 20 20", ...svgAttributes(props)},
		createElement("rect", {x: 4, y: 4, width: 12, height: 12, rx: 2.5, fill: "currentColor"}),
	);
}

/** Upstream's `CheckCircleFilled`: a solid disc with the check knocked out. */
function CheckCircleFilled(props: GlyphProps) {
	return createElement(
		"svg",
		{viewBox: "0 0 24 24", ...svgAttributes(props)},
		createElement("path", {
			fill: "currentColor",
			fillRule: "evenodd",
			d: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.7 7.7a1 1 0 0 0-1.4-1.4L11 12.6l-2.3-2.3a1 1 0 1 0-1.4 1.4l3 3a1 1 0 0 0 1.4 0l5-5Z",
		}),
	);
}

/** Upstream's `CaretRightFilled`: a filled right-pointing triangle (cds Collapsible's caret, the sidebar group caret). */
function CaretRightFilled(props: GlyphProps) {
	return createElement(
		"svg",
		{viewBox: "0 0 14 14", ...svgAttributes(props)},
		createElement("path", {
			fill: "currentColor",
			d: "M5 3.4v7.2c0 .42.48.65.81.39l4.5-3.6a.5.5 0 0 0 0-.78l-4.5-3.6A.5.5 0 0 0 5 3.4Z",
		}),
	);
}

/** Upstream `_m`'s `*Filled` glyphs, drawn locally. */
export const FILLED_GLYPHS = {
	CaretRightFilled,
	CheckCircleFilled,
	StopFilled,
} satisfies Partial<Record<AnthropiconName, ComponentType<GlyphProps>>>;

/** Upstream `Cb`: the names that flip under `dir=rtl`. */
export const ICON_MIRRORED: ReadonlySet<AnthropiconName> = new Set<AnthropiconName>([
	"ArrowInSquare",
	"ArrowLeft",
	"ArrowLeftCircle",
	"ArrowOutSquare",
	"ArrowReturn",
	"ArrowRight",
	"ArrowRightCircle",
	"ArrowSplitRight",
	"ArrowUpRight",
	"CaretLeft",
	"CaretRight",
	"Logout",
	"PaperPlane",
	"ArrowBendUpRight",
	"ArrowDownLeft",
	"ArrowDownRight",
	"ArrowUpLeft",
	"ArrowBendUpLeft",
	"CaretRightFilled",
	"CaretLeftDouble",
	"CaretRightDouble",
	"Reply",
]);
