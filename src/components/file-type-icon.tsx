import {
	Database,
	File,
	FileArchive,
	FileCode,
	FileImage,
	Globe,
	type LucideIcon,
	Presentation,
	ScrollText,
	Sheet,
	StickyNote,
} from "lucide-react";
import type {ReactNode} from "react";
import {
	type FileTypeGlyph,
	type FileTypeIconNode,
	fileTypeGlyph,
	fileTypeIconSet,
	resolveFileTypeIcon,
} from "../lib/file-type-icons";

import {FILE_TYPE_ICON_SIZE_PX, type FileTypeIconSize} from "./file-type-icon-size";

/** Local stand-ins for upstream's monochrome cds glyphs. */
const GLYPH_ICONS: Readonly<Record<FileTypeGlyph, LucideIcon>> = {
	doc: File,
	code: FileCode,
	data: Database,
	sheet: Sheet,
	preso: Presentation,
	image: FileImage,
	archive: FileArchive,
	note: StickyNote,
	globe: Globe,
	skill: ScrollText,
};

const REACT_ATTRIBUTE_NAMES: Readonly<Record<string, string>> = {
	"fill-rule": "fillRule",
	"clip-rule": "clipRule",
	"stroke-width": "strokeWidth",
	"stroke-linecap": "strokeLinecap",
	"stroke-linejoin": "strokeLinejoin",
	"stroke-miterlimit": "strokeMiterlimit",
	"stroke-dasharray": "strokeDasharray",
};

/** `"$name"` → the palette's CSS variable (src/styles/file-type-icons.css); anything else is literal. */
function attributeValue(value: string): string {
	return value.startsWith("$") ? `var(--fti-${value.slice(1)})` : value;
}

function renderNode(node: FileTypeIconNode, key: number): ReactNode {
	const [Element, attributes, children] = node;
	const props: Record<string, string> = {};
	for (const [name, value] of Object.entries(attributes)) {
		props[REACT_ATTRIBUTE_NAMES[name] ?? name] = attributeValue(value);
	}
	return (
		<Element key={key} {...props}>
			{children?.map(renderNode)}
		</Element>
	);
}

/**
 * Upstream `FileTypeIcon`: the coloured file-type icon for a name, else the
 * coloured default icon for generic docs, else `fallback` or a monochrome
 * per-kind glyph.
 */
export function FileTypeIcon({
	fileName,
	size,
	className,
	fallback,
}: {
	fileName: string;
	size: FileTypeIconSize;
	className?: string;
	fallback?: ReactNode;
}): ReactNode {
	const px = `${FILE_TYPE_ICON_SIZE_PX[size]}px`;
	const style = {width: px, height: px};
	const classes = className ? `shrink-0 ${className}` : "shrink-0";
	const glyph = fileTypeGlyph(fileName);
	const id = resolveFileTypeIcon(fileName) ?? (glyph === "doc" ? fileTypeIconSet.defaultIcon : null);
	const tree = id === null ? undefined : fileTypeIconSet.icons[id];
	if (tree === undefined) {
		if (fallback !== undefined) return fallback;
		const Glyph = GLYPH_ICONS[glyph];
		return <Glyph aria-hidden="true" className={classes} style={style} />;
	}
	return (
		<svg
			aria-hidden="true"
			data-file-type-icon=""
			viewBox="0 0 16 16"
			fill="none"
			className={classes}
			style={style}
		>
			{tree.map(renderNode)}
		</svg>
	);
}
