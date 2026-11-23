import
{
	Archive,
	ArrowDown,
	ArrowRight,
	ArrowUp,
	Bot,
	Calendar,
	ChartColumn,
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	CircleAlert,
	CircleCheck,
	CircleDashed,
	CircleEllipsis,
	CircleX,
	Clapperboard,
	CodeXml,
	Copy,
	CornerDownLeft,
	Database,
	Ellipsis,
	Expand,
	Eye,
	EyeOff,
	File,
	FileDiff,
	Files,
	Folder,
	GitMerge,
	GitMergeConflict,
	GitPullRequest,
	GitPullRequestArrow,
	GitPullRequestClosed,
	GitPullRequestDraft,
	Globe,
	Image,
	Info,
	type LucideIcon,
	type LucideProps,
	MapPin,
	Maximize2,
	MessageSquare,
	Palette,
	PanelBottom,
	PanelLeft,
	PanelRight,
	PanelTop,
	Paperclip,
	Pencil,
	Play,
	Plus,
	Presentation,
	RotateCcw,
	Scroll,
	Search,
	Settings,
	Shapes,
	Sheet,
	ShieldCheck,
	Shrink,
	Square,
	StickyNote,
	Trash2,
	TriangleAlert,
	Workflow,
	X,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import {createElement, type ComponentType} from "react";

import type {AnthropiconName} from "./anthropicon-names";

/*
 * The lucide stand-in for each Anthropicons glyph the app draws. Only the drawings differ from upstream:
 * `Icon` copies the size, stroke, mirror and rotate contract around them. Every entry ships in the cold
 * bundle wherever `Icon` is used, so add a name only when a surface starts drawing it.
 */
export const ICON_GLYPHS =
{
	Add: Plus,
	Agent: Bot,
	AgentsSimple: Bot,
	Animation: Clapperboard,
	Archive,
	Artifacts: Shapes,
	ArrowCounterClockwise: RotateCcw,
	ArrowReturn: CornerDownLeft,
	ArrowDown,
	ArrowRight,
	ArrowUp,
	Attachment: Paperclip,
	CaretDown: ChevronDown,
	ChatSimple: MessageSquare,
	CaretLeft: ChevronLeft,
	CaretRight: ChevronRight,
	Calendar,
	CaretUp: ChevronUp,
	ChangesPlusMinus: FileDiff,
	Chart: ChartColumn,
	Check,
	CheckCircle: CircleCheck,
	Code: CodeXml,
	Collapse: Shrink,
	Copy,
	Database,
	Diagram: Workflow,
	DotsCircle: CircleEllipsis,
	DotsHorizontal: Ellipsis,
	Edit: Pencil,
	Expand,
	Eye,
	EyeSlash: EyeOff,
	File,
	Files,
	Folder,
	GitMergeConflict,
	GitMergeQueue: GitPullRequestArrow,
	GitMergedSimple: GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	Globe,
	Image,
	Info,
	MapPin,
	Note: StickyNote,
	PaneBottom: PanelBottom,
	PaneFill: Maximize2,
	PaneLeft: PanelLeft,
	PaneRight: PanelRight,
	PaneTop: PanelTop,
	Palette,
	Placeholder: CircleDashed,
	Play,
	Scroll,
	Search,
	Settings,
	SidebarRight: PanelRight,
	Slides: Presentation,
	Spreadsheet: Sheet,
	Stop: Square,
	Trash: Trash2,
	Trust: ShieldCheck,
	Warning: TriangleAlert,
	WarningCircle: CircleAlert,
	X,
	XCircle: CircleX,
	ZoomIn,
	ZoomOut,
} satisfies Partial<Record<AnthropiconName, LucideIcon>>;

type GlyphProps = Omit<LucideProps, "ref">;

/** Strips lucide's sizing props so a hand-drawn svg takes only the shared attributes. */
function svgAttributes({size: _size, strokeWidth: _stroke, ...rest}: GlyphProps)
{
	return rest;
}

/** Upstream's `StopFilled`: a filled rounded square about 12px inside the 20px icon box. */
function StopFilled(props: GlyphProps)
{
	return createElement(
		"svg",
		{
			viewBox: "0 0 20 20",
			...svgAttributes(props),
		},
		createElement(
			"rect",
			{
				x: 4,
				y: 4,
				width: 12,
				height: 12,
				rx: 2.5,
				fill: "currentColor",
			},
		),
	);
}

/** Upstream's `CheckCircleFilled`: a solid disc with the check knocked out. */
function CheckCircleFilled(props: GlyphProps)
{
	return createElement(
		"svg",
		{
			viewBox: "0 0 24 24",
			...svgAttributes(props),
		},
		createElement(
			"path",
			{
				fill: "currentColor",
				fillRule: "evenodd",
				d: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.7 7.7a1 1 0 0 0-1.4-1.4L11 12.6l-2.3-2.3a1 1 0 1 0-1.4 1.4l3 3a1 1 0 0 0 1.4 0l5-5Z",
			},
		),
	);
}

/** Upstream's `CaretRightFilled`: a filled right-pointing triangle (cds Collapsible's caret, the sidebar group caret). */
function CaretRightFilled(props: GlyphProps)
{
	return createElement(
		"svg",
		{
			viewBox: "0 0 14 14",
			...svgAttributes(props),
		},
		createElement(
			"path",
			{
				fill: "currentColor",
				d: "M5 3.4v7.2c0 .42.48.65.81.39l4.5-3.6a.5.5 0 0 0 0-.78l-4.5-3.6A.5.5 0 0 0 5 3.4Z",
			},
		),
	);
}

/** Upstream's `CaretDownFilled`: CaretRightFilled's triangle pointing down (the cds Banner details caret). */
function CaretDownFilled(props: GlyphProps)
{
	return createElement(
		"svg",
		{
			viewBox: "0 0 14 14",
			...svgAttributes(props),
		},
		createElement(
			"path",
			{
				fill: "currentColor",
				d: "M3.4 5h7.2c.42 0 .65.48.39.81l-3.6 4.5a.5.5 0 0 1-.78 0l-3.6-4.5A.5.5 0 0 1 3.4 5Z",
			},
		),
	);
}

/**
 * Upstream's `CaretDownSmall` (Anthropicons U+F003): a short down chevron drawn well inside the box,
 * smaller than `CaretDown`. Stroked at the Icon's scaled width like a lucide glyph.
 */
function CaretDownSmall({strokeWidth, ...props}: GlyphProps)
{
	return createElement(
		"svg",
		{
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth,
			strokeLinecap: "round",
			strokeLinejoin: "round",
			...svgAttributes(props),
		},
		createElement(
			"path",
			{
				d: "M7.8 9.9 12 14.1l4.2-4.2",
			},
		),
	);
}

/** Glyphs lucide has no match for (upstream `_m`'s `*Filled` set and `CaretDownSmall`), drawn locally. */
/**
 * Upstream's `Reorder` (Anthropicons U+E0CF): three horizontal bars, measured live in a 16px box at x 2→14 and
 * y ≈ 3.2 / 8 / 12.8, scaled to the 24-unit box and stroked at the Icon's width.
 */
function Reorder({strokeWidth, ...props}: GlyphProps)
{
	return createElement(
		"svg",
		{
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth,
			strokeLinecap: "round",
			...svgAttributes(props),
		},
		createElement(
			"path",
			{
				d: "M3 4.8h18M3 12h18M3 19.2h18",
			},
		),
	);
}

/** Upstream's `UsageGauge*` dial: lucide Gauge's arc with the needle at the level the name gives. */
function usageGauge(needle: string)
{
	return function UsageGauge({strokeWidth, ...props}: GlyphProps)
	{
		return createElement(
			"svg",
			{
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				...svgAttributes(props),
			},
			createElement(
				"path",
				{
					d: "M3.34 19a10 10 0 1 1 17.32 0",
				},
			),
			createElement(
				"path",
				{
					d: needle,
				},
			),
		);
	};
}

/** Upstream's `UsageGaugeMiddle` (approaching a limit): the needle straight up. */
const UsageGaugeMiddle = usageGauge("M12 14V8");

/** Upstream's `UsageGaugeHigh` (limit reached): the needle swung toward the dial's high end. */
const UsageGaugeHigh = usageGauge("m12 14 5.2-2.6");

export const DRAWN_GLYPHS =
{
	CaretDownFilled,
	CaretDownSmall,
	CaretRightFilled,
	CheckCircleFilled,
	Reorder,
	StopFilled,
	UsageGaugeHigh,
	UsageGaugeMiddle,
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
