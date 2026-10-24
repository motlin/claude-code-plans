import {useQuery} from "@tanstack/react-query";
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
import {inlineCodeTexts, mentionsArtifactUrl} from "../lib/client-markdown";
import {requestFileOpen} from "../lib/file-open-requests";
import {type FileRef} from "../lib/file-refs";
import type {SessionFiles} from "../lib/session-files";
import {MarkdownArticle} from "./markdown-article";
import {usePaneHost} from "./panes/pane-host-context";
import {useResolvedFileRefs, EMPTY_REFS} from "./use-resolved-file-refs";

interface FileRefsContextValue {
	/** The session's working directory; relative refs resolve against it first. */
	cwd: string | undefined;
	/** Absolute paths the session touched; a bare name can resolve to a unique one. */
	sessionPaths: readonly string[];
	open: (ref: FileRef) => void;
}

const FileRefsContext = createContext<FileRefsContextValue | null>(null);

export const FileRefsProvider = FileRefsContext.Provider;

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
}): ReactNode {
	const texts = useMemo(() => [path], [path]);
	const ref = useFileRefs(texts).get(path);
	return render(ref === undefined || ref.block !== undefined ? null : fileRefButtonProps(ref, open));
}

/**
 * Renders a tool path, handing `render` button props once the path is
 * confirmed to exist (null until then, for a blocked path, and always null
 * outside a provider).
 */
export function FileRefTarget({path, render}: {path: string; render: RenderFileRef}): ReactNode {
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

function LinkedProseMarkdown({
	markdown,
	open,
	smartQuotes,
}: {
	markdown: string;
	open: (ref: FileRef) => void;
	smartQuotes: boolean;
}) {
	const texts = useMemo(() => inlineCodeTexts(markdown), [markdown]);
	const refs = useFileRefs(texts);
	const artifactTitles = useArtifactTitles(markdown);
	return (
		<MarkdownArticle
			markdown={markdown}
			fileRefs={refs.size === 0 ? undefined : refs}
			onFileRef={open}
			artifactTitles={artifactTitles}
			smartQuotes={smartQuotes}
			zonedTimes={smartQuotes}
		/>
	);
}

/**
 * Assistant prose whose inline-code paths become clickable file refs; with
 * `smartQuotes`, its quotes curl and its zoned clock times underline as
 * upstream's assistant text does.
 */
export function ProseMarkdown({markdown, smartQuotes = false}: {markdown: string; smartQuotes?: boolean}) {
	const open = useOpenFileRef();
	return open === null ? (
		<MarkdownArticle markdown={markdown} smartQuotes={smartQuotes} zonedTimes={smartQuotes} />
	) : (
		<LinkedProseMarkdown markdown={markdown} open={open} smartQuotes={smartQuotes} />
	);
}
