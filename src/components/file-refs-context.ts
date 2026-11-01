import {createContext, useContext} from "react";

import type {FileRef} from "../lib/file-refs";

interface FileRefsContextValue {
	/** Keys the session's missing-file set. */
	sessionId: string;
	/** The session's working directory; relative refs resolve against it first. */
	cwd: string | undefined;
	/** Absolute paths the session touched; a bare name can resolve to a unique one. */
	sessionPaths: readonly string[];
	open: (ref: FileRef) => void;
}

export const FileRefsContext = createContext<FileRefsContextValue | null>(null);

export const FileRefsProvider = FileRefsContext.Provider;

/** The surrounding {@link FileRefsProvider}'s working directory, if any. */
export function useFileRefsCwd(): string | undefined {
	return useContext(FileRefsContext)?.cwd;
}
