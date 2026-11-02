import {createContext, use, useMemo} from "react";

import {type DiffFileMark, type DiffMarkScope, useFileMark} from "../../lib/diff-file-marks";

/**
 * Upstream c44d00c7f `gs` (was `mu` in the 2026-11-05 build): the Changes pane's marks scope and each file's
 * patch, provided only when some file's patch can be marked. Without it nothing shows a mark.
 */
export interface DiffMarksContextValue
{
	scope: DiffMarkScope;
	patches: ReadonlyMap<string, string | null>;
}

export const DiffMarksContext = createContext<DiffMarksContextValue | undefined>(undefined);

/** Upstream `zs` with the tree row's patch from the context's map. */
export function useTreeFileMark(path: string): DiffFileMark | undefined
{
	const marks = use(DiffMarksContext);
	return useFileMark(marks?.scope, path, marks?.patches.get(path));
}

/** Upstream `Bs`: the file's mark from the context's patch map; a path missing from the map reads as markable. */
export function useDiffFileMark(path: string | undefined): DiffFileMark | undefined
{
	const marks = use(DiffMarksContext);
	const known = path !== undefined && marks?.patches.has(path) === true;
	const mark = useFileMark(
		path === undefined ? undefined : marks?.scope,
		path ?? "",
		path === undefined ? undefined : marks?.patches.get(path),
	);
	return useMemo(
		() =>
			mark !== undefined && !known
				?
					{
						...mark,
						canMark: true,
					}
				: mark,
		[mark, known],
	);
}
