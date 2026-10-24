import {useQueries} from "@tanstack/react-query";
import {useMemo} from "react";
import {type FileRefStatus, FileRefStatusSchema, fileRefStatusQueryOptions} from "../lib/api/file-refs";
import {type FileRef, fileRefStatCandidates, resolveFileRefs} from "../lib/file-refs";

interface ResolveOptions {
	/** Also link paths inside the roots that the server found missing, as upstream's prose does. */
	linkMissing?: boolean;
	/** Paths whose open already found no file; their refs block as `missing`. */
	missingFiles?: ReadonlySet<string>;
}

const NO_MISSING: ReadonlySet<string> = new Set();

/**
 * Resolve inline-code texts to refs, linking paths the server confirmed exist
 * inside the allowed file roots (and, with `linkMissing`, those it found
 * missing there) and blocking (`outside_roots`) those it placed outside them.
 * Relative paths try each base directory in order; the first that resolves wins.
 */
export function useResolvedFileRefs(
	texts: readonly string[],
	sessionPaths: readonly string[],
	bases: readonly (string | undefined)[],
	{linkMissing = false, missingFiles = NO_MISSING}: ResolveOptions = {},
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
					return status === undefined || (status === "missing" && !linkMissing) ? [] : [`${status}\t${path}`];
				})
				.join("\0"),
	});
	return useMemo(() => {
		if (statusKey === "") return EMPTY_REFS;
		const byStatus: Record<FileRefStatus, string[]> = {exists: [], missing: [], outside: []};
		for (const entry of statusKey.split("\0")) {
			const [status, path = ""] = entry.split("\t");
			const parsed = FileRefStatusSchema.safeParse(status);
			if (parsed.success) byStatus[parsed.data].push(path);
		}
		const refs = new Map<string, FileRef>();
		for (const base of basesKey.split("\0")) {
			const resolved = resolveFileRefs(
				texts,
				byStatus.exists,
				base === "" ? undefined : base,
				byStatus.outside,
				byStatus.missing,
			);
			for (const [text, found] of resolved) {
				const ref: FileRef =
					found.block === undefined && missingFiles.has(found.path) ? {...found, block: "missing"} : found;
				if (!refs.has(text) || (refs.get(text)?.block !== undefined && ref.block === undefined))
					refs.set(text, ref);
			}
		}
		return refs;
	}, [texts, statusKey, basesKey, missingFiles]);
}

export const EMPTY_REFS: ReadonlyMap<string, FileRef> = new Map();
