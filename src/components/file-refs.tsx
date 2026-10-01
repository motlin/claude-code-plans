import {useQueries, useQuery} from "@tanstack/react-query";
import {
	createContext,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
} from "react";

import {type ArtifactSummary, artifactsQueryOptions} from "../lib/api/artifacts";
import {fileExistsQueryOptions} from "../lib/api/file-refs";
import {inlineCodeTexts, mentionsArtifactUrl} from "../lib/client-markdown";
import {requestFileOpen} from "../lib/file-open-requests";
import {type FileRef, fileRefStatCandidates, resolveFileRefs} from "../lib/file-refs";
import type {SessionFiles} from "../lib/session-files";
import {MarkdownArticle} from "./markdown-article";
import {usePaneHost} from "./panes/tile-host";

interface FileRefsContextValue {
	/** The session's working directory; relative refs resolve against it first. */
	cwd: string | undefined;
	/** Absolute paths the session touched; a bare name can resolve to a unique one. */
	sessionPaths: readonly string[];
	open: (ref: FileRef) => void;
}

const FileRefsContext = createContext<FileRefsContextValue | null>(null);

export const FileRefsProvider = FileRefsContext.Provider;

const EMPTY_REFS: ReadonlyMap<string, FileRef> = new Map();

/**
 * Transcript file refs for a session page: clicking one opens the file as a
 * preview tab in the Files pane, opening the pane first when it is closed.
 */
export function SessionFileRefs({
	sessionId,
	cwd,
	sessionFiles,
	children,
}: {
	sessionId: string;
	cwd: string | undefined;
	sessionFiles: SessionFiles;
	children: ReactNode;
}) {
	const host = usePaneHost();
	const {openPane} = host;
	const sessionPaths = useMemo(() => sessionFiles.files.map((file) => file.absolutePath), [sessionFiles]);
	const open = useCallback(
		(ref: FileRef) => {
			requestFileOpen(sessionId, ref);
			openPane("files");
		},
		[sessionId, openPane],
	);
	const value = useMemo(() => ({cwd, sessionPaths, open}), [cwd, sessionPaths, open]);
	return <FileRefsProvider value={value}>{children}</FileRefsProvider>;
}

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

const NO_PATHS: readonly string[] = [];

/** {@link useResolvedFileRefs} against the surrounding {@link FileRefsProvider}; empty outside one. */
function useFileRefs(texts: readonly string[]): ReadonlyMap<string, FileRef> {
	const context = useContext(FileRefsContext);
	const refs = useResolvedFileRefs(context === null ? NO_PATHS : texts, context?.sessionPaths ?? NO_PATHS, [
		context?.cwd,
	]);
	return context === null ? EMPTY_REFS : refs;
}

/** The open handler of the surrounding {@link FileRefsProvider}, if any. */
function useOpenFileRef(): ((ref: FileRef) => void) | null {
	return useContext(FileRefsContext)?.open ?? null;
}

interface FileRefButtonProps {
	role: "button";
	tabIndex: 0;
	"data-file-ref": "";
	onClick: (event: MouseEvent) => void;
	onKeyDown: (event: KeyboardEvent) => void;
}

function fileRefButtonProps(ref: FileRef, open: (ref: FileRef) => void): FileRefButtonProps {
	return {
		role: "button",
		tabIndex: 0,
		"data-file-ref": "",
		onClick: (event) => {
			event.stopPropagation();
			open(ref);
		},
		onKeyDown: (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			event.stopPropagation();
			open(ref);
		},
	};
}

type RenderFileRef = (props: FileRefButtonProps | null) => ReactNode;

function ResolvedFileRefTarget({
	path,
	open,
	render,
}: {
	path: string;
	open: (ref: FileRef) => void;
	render: RenderFileRef;
}) {
	const texts = useMemo(() => [path], [path]);
	const ref = useFileRefs(texts).get(path);
	return render(ref === undefined ? null : fileRefButtonProps(ref, open));
}

/**
 * Renders a tool path, handing `render` button props once the path is
 * confirmed to exist (null until then, and always null outside a provider).
 */
export function FileRefTarget({path, render}: {path: string; render: RenderFileRef}) {
	const open = useOpenFileRef();
	return open === null ? render(null) : <ResolvedFileRefTarget path={path} open={open} render={render} />;
}

function artifactTitlesById(artifacts: ArtifactSummary[]): ReadonlyMap<string, string> {
	return new Map(artifacts.map((artifact) => [artifact.id, artifact.title]));
}

/** Indexed artifact titles, fetched only when the prose links to an artifact. */
function useArtifactTitles(markdown: string): ReadonlyMap<string, string> | undefined {
	const {data} = useQuery({
		...artifactsQueryOptions,
		enabled: mentionsArtifactUrl(markdown),
		select: artifactTitlesById,
	});
	return data;
}

function LinkedProseMarkdown({markdown, open}: {markdown: string; open: (ref: FileRef) => void}) {
	const texts = useMemo(() => inlineCodeTexts(markdown), [markdown]);
	const refs = useFileRefs(texts);
	const artifactTitles = useArtifactTitles(markdown);
	return (
		<MarkdownArticle
			markdown={markdown}
			fileRefs={refs.size === 0 ? undefined : refs}
			onFileRef={open}
			artifactTitles={artifactTitles}
		/>
	);
}

/** Assistant prose whose inline-code paths become clickable file refs. */
export function ProseMarkdown({markdown}: {markdown: string}) {
	const open = useOpenFileRef();
	return open === null ? (
		<MarkdownArticle markdown={markdown} />
	) : (
		<LinkedProseMarkdown markdown={markdown} open={open} />
	);
}
