import {type ReactNode, useCallback, useContext, useSyncExternalStore} from "react";
import {
	type FileTypeGlyph,
	type FileTypeIconNode,
	type FileTypeIconSet,
	type FileTypeIconSetName,
	fileTypeGlyph,
	fileTypeIconDefault,
	fileTypeIconSetFor,
	loadFileTypeIconSet,
	loadedFileTypeIconSet,
	resolveFileTypeIcon,
	subscribeFileTypeIconSets,
} from "../lib/file-type-icons";

import {FileTypeIconSetContext} from "./file-type-icon-set-context";
import {FILE_TYPE_ICON_SIZE_PX, type FileTypeIconSize} from "./file-type-icon-size";
import {Icon, type IconName} from "./ui/icon";

/** Upstream's monochrome cds glyph per kind, drawn through the local Icon. */
const GLYPH_ICONS: Readonly<Record<FileTypeGlyph, IconName>> = {
	doc: "File",
	code: "Code",
	data: "Database",
	sheet: "Spreadsheet",
	preso: "Slides",
	image: "Image",
	archive: "Archive",
	note: "Note",
	globe: "Globe",
	skill: "Scroll",
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

/** The palette's CSS variable prefix (src/styles/file-type-icons.css): pierre's is unscoped, the others carry the set's name. */
function paletteVariablePrefix(setName: FileTypeIconSetName): string {
	return setName === "pierre" ? "--fti-" : `--fti-${setName}-`;
}

/** `"$name"` → the palette's CSS variable; anything else is literal. */
function attributeValue(value: string, prefix: string): string {
	return value.startsWith("$") ? `var(${prefix}${value.slice(1)})` : value;
}

function renderNodes(nodes: readonly FileTypeIconNode[], prefix: string): ReactNode[] {
	const rendered: ReactNode[] = [];
	for (const [key, [Element, attributes, children]] of nodes.entries()) {
		const props: Record<string, string> = {};
		for (const [name, value] of Object.entries(attributes)) {
			props[REACT_ATTRIBUTE_NAMES[name] ?? name] = attributeValue(value, prefix);
		}
		rendered.push(
			<Element key={key} {...props}>
				{children && renderNodes(children, prefix)}
			</Element>,
		);
	}
	return rendered;
}

/** Upstream `O[set]`: the named set once loaded (pierre at once), starting its load; undefined for no set. */
function useFileTypeIconSet(name: FileTypeIconSetName | null): FileTypeIconSet | undefined {
	const subscribe = useCallback(
		(listener: () => void) => {
			const unsubscribe = subscribeFileTypeIconSets(listener);
			if (name !== null) void loadFileTypeIconSet(name).catch(() => undefined);
			return unsubscribe;
		},
		[name],
	);
	const snapshot = () => (name === null ? undefined : loadedFileTypeIconSet(name));
	return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Upstream `FileTypeIcon`: inside a Files or Changes pane's icon set, the
 * coloured icon for a name, else the set's default icon for generic docs (or
 * every file, when the set says so); otherwise, and while a set loads,
 * `fallback` or a monochrome per-kind glyph.
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
	const activeSet = useContext(FileTypeIconSetContext);
	const setName = activeSet === null ? null : fileTypeIconSetFor(fileName, activeSet);
	const set = useFileTypeIconSet(setName);
	const px = `${FILE_TYPE_ICON_SIZE_PX[size]}px`;
	const style = {width: px, height: px};
	const glyph = fileTypeGlyph(fileName);
	const id =
		set === undefined
			? null
			: (resolveFileTypeIcon(fileName, set) ?? (glyph === "doc" ? fileTypeIconDefault(set) : null));
	const tree = id === null || set === undefined ? undefined : set.icons[id];
	if (tree === undefined || setName === null) {
		if (fallback !== undefined) return fallback;
		return (
			<Icon
				name={GLYPH_ICONS[glyph]}
				size={size}
				className={className ? `shrink-0 ${className}` : "shrink-0"}
				style={style}
			/>
		);
	}
	const classes = ["shrink-0", setName === "vscode" ? "overflow-visible" : null, className].filter(Boolean).join(" ");
	const prefix = paletteVariablePrefix(setName);
	return (
		<svg
			aria-hidden="true"
			data-file-type-icon=""
			viewBox="0 0 16 16"
			fill="none"
			className={classes}
			style={style}
		>
			{renderNodes(tree, prefix)}
		</svg>
	);
}
