/**
 * Upstream's composer items splitter (`shared-l-p-m-w-2` `zt`), kept apart from the cds collector in drop-collect.ts so
 * the page drop targets that ship with every route don't pull the folder walk along; only the lazy ⌘K palette needs it.
 */

/** The parts of a `DataTransferItem` the splitter and the collector read. */
export interface DropItem<Entry>
{
	readonly kind: string;
	getAsFile: () => File | null;
	webkitGetAsEntry?: (() => Entry | null) | undefined;
}

/** Upstream's `zt`: file items whose entry is a directory are folders; files without items pass through. */
export function splitDroppedItems(
	items:
		| ArrayLike<
				DropItem<
				{
					readonly isDirectory: boolean;
				}>
		  >
		| null
		| undefined,
	files: ArrayLike<File> | null | undefined,
):
{
	folders: File[];
	files: File[];
}
{
	const folders: File[] = [];
	const loose: File[] = [];
	if (items == null)
		return {
			folders,
			files: Array.from(files ?? []),
		};
	for (const item of Array.from(items))
	{
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (file === null) continue;
		(item.webkitGetAsEntry?.()?.isDirectory === true ? folders : loose).push(file);
	}
	return {
		folders,
		files: loose,
	};
}
