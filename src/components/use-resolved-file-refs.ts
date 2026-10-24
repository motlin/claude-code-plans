import {useQueries} from "@tanstack/react-query";
import {useMemo} from "react";
import {fileRefStatusQueryOptions} from "../lib/api/file-refs";
import {type FileRef, fileRefStatCandidates, resolveFileRefs} from "../lib/file-refs";

/**
 * Resolve inline-code texts to refs, linking only paths the server confirmed
 * exist inside the allowed file roots and blocking (`outside_roots`) those it
 * placed outside them. Relative paths try each base directory in order; the
 * first that resolves wins.
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
	const statusKey = useQueries({
		queries: candidates.map((path) => fileRefStatusQueryOptions(path)),
		combine: (results) =>
			candidates
				.flatMap((path, index) => {
					const status = results[index]?.data;
					return status === "exists" || status === "outside" ? [`${status}\t${path}`] : [];
				})
				.join("\0"),
	});
	return useMemo(() => {
		if (statusKey === "") return EMPTY_REFS;
		const existing: string[] = [];
		const outside: string[] = [];
		for (const entry of statusKey.split("\0")) {
			const [status, path = ""] = entry.split("\t");
			(status === "exists" ? existing : outside).push(path);
		}
		const refs = new Map<string, FileRef>();
		for (const base of basesKey.split("\0")) {
			for (const [text, ref] of resolveFileRefs(texts, existing, base === "" ? undefined : base, outside)) {
				if (!refs.has(text) || (refs.get(text)?.block !== undefined && ref.block === undefined))
					refs.set(text, ref);
			}
		}
		return refs;
	}, [texts, statusKey, basesKey]);
}

export const EMPTY_REFS: ReadonlyMap<string, FileRef> = new Map();
