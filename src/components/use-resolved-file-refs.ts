import {useQueries} from "@tanstack/react-query";
import {useMemo} from "react";
import {fileExistsQueryOptions} from "../lib/api/file-refs";
import {type FileRef, fileRefStatCandidates, resolveFileRefs} from "../lib/file-refs";

/**
 * Resolve inline-code texts to refs, linking only paths the server confirmed
 * exist inside the allowed file roots. Relative paths try each base directory
 * in order; the first that resolves wins.
 */
export function useResolvedFileRefs(
	texts: readonly string[],
	sessionPaths: readonly string[],
	bases: readonly (string | undefined)[],
): ReadonlyMap<string, FileRef> {
	const basesKey = bases.map((base) => base ?? "").join("\0");
	const candidates = useMemo(() => {
		const all = new Set<string>();
		for (const base of basesKey.split("\0")) {
			for (const path of fileRefStatCandidates(texts, sessionPaths, base === "" ? undefined : base))
				all.add(path);
		}
		return [...all];
	}, [texts, sessionPaths, basesKey]);
	const existingKey = useQueries({
		queries: candidates.map((path) => fileExistsQueryOptions(path)),
		combine: (results) => candidates.filter((_path, index) => results[index]?.data === true).join("\0"),
	});
	return useMemo(() => {
		if (existingKey === "") return EMPTY_REFS;
		const existing = existingKey.split("\0");
		const refs = new Map<string, FileRef>();
		for (const base of basesKey.split("\0")) {
			for (const [text, ref] of resolveFileRefs(texts, existing, base === "" ? undefined : base)) {
				if (!refs.has(text)) refs.set(text, ref);
			}
		}
		return refs;
	}, [texts, existingKey, basesKey]);
}

export const EMPTY_REFS: ReadonlyMap<string, FileRef> = new Map();
