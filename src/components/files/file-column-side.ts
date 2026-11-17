import {useTileRowEnd} from "../panes/tile-row-end-context";
import {type FileColumnPosition, useSettings} from "../settings-context";

/** Upstream c9bd7af9c `VT`: the submenu's row labels, also its trigger hint. */
export const FILE_COLUMN_POSITION_LABELS: Record<FileColumnPosition, string> =
{
	auto: "Automatic",
	left: "Left",
	right: "Right",
};

export interface FileColumnSideInput
{
	position: FileColumnPosition;
	rowEnd: boolean;
	rtl: boolean;
}

/**
 * Upstream cf3dc7910 `ce`: Automatic follows the row-end tile context; Left and Right keep their
 * physical side, so in RTL (where the column's inline-start is the right) "Right" resolves false.
 */
export function resolveFileColumnOnRight({position, rowEnd, rtl}: FileColumnSideInput): boolean
{
	return position === "auto" ? rowEnd : (position === "right") !== rtl;
}

/** Whether this pane's file column renders at its inline end (the right, in LTR). */
export function useFileColumnOnRight(): boolean
{
	const {settings} = useSettings();
	const rowEnd = useTileRowEnd();
	return resolveFileColumnOnRight(
		{
			position: settings.fileColumnPosition,
			rowEnd,
			rtl: document.documentElement.dir === "rtl",
		},
	);
}
