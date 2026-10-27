import {useQuery, useQueryClient} from "@tanstack/react-query";
import {
	createContext,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useSyncExternalStore,
} from "react";

import {type ArtifactSummary, artifactsQueryOptions} from "../lib/api/artifacts";
import {type FileRefStatus, fileRefStatusQueryOptions} from "../lib/api/file-refs";
import {fileRefTexts, mentionsArtifactUrl} from "../lib/client-markdown";
import {requestFileOpen} from "../lib/file-open-requests";
import type {FileRef} from "../lib/file-refs";
import {markFileRefMissing, missingFileRefs, subscribeMissingFileRefs} from "../lib/missing-file-refs";
import type {SessionFiles} from "../lib/session-files";
import {relativeToCwd} from "./files/mention-path";
import {MarkdownArticle} from "./markdown-article";
import {usePaneHost} from "./panes/pane-host-context";
import {useOpenInDefaultApp} from "./use-open-in-default-app";
import {useResolvedFileRefs, EMPTY_REFS} from "./use-resolved-file-refs";

interface FileRefsContextValue {
	/** Keys the session's missing-file set. */
	sessionId: string;
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
	const value = useMemo(() => ({sessionId, cwd, sessionPaths, open}), [sessionId, cwd, sessionPaths, open]);
	return <FileRefsProvider value={value}>{children}</FileRefsProvider>;
}

const NO_PATHS: readonly string[] = [];

const NO_SESSION = "";

/**
 * {@link useResolvedFileRefs} against the surrounding {@link FileRefsProvider};
 * empty outside one. With `linkMissing`, paths not found inside the roots link
 * too, until a click finds them missing.
 */
function useFileRefs(texts: readonly string[], linkMissing = false): ReadonlyMap<string, FileRef> {
	const context = useContext(FileRefsContext);
	const sessionId = context?.sessionId ?? NO_SESSION;
	const missingFiles = useSyncExternalStore(
		subscribeMissingFileRefs,
		() => missingFileRefs(sessionId),
		() => missingFileRefs(sessionId),
	);
	const refs = useResolvedFileRefs(
		context === null ? NO_PATHS : texts,
		context?.sessionPaths ?? NO_PATHS,
		[context?.cwd],
		{linkMissing, missingFiles},
	);
	return context === null ? EMPTY_REFS : refs;
}

/** Upstream's 150ms before a slow existence check marks the clicked ref busy. */
const BUSY_DELAY_MS = 150;

type CheckedOpenResult = "opened" | "missing" | "outside";

/**
 * Upstream's `rr` click for an optimistically linked ref: a file already known
 * to exist opens at once; otherwise its existence is rechecked (the ref turns
 * `aria-busy` if that takes over 150ms), then it opens or joins the session's
 * missing files, which re-renders it blocked.
 */
function useCheckedOpen(
	sessionId: string,
	open: (ref: FileRef) => void,
): (ref: FileRef, element: HTMLElement) => Promise<CheckedOpenResult> {
	const queryClient = useQueryClient();
	return useCallback(
		async (ref, element) => {
			const options = fileRefStatusQueryOptions(ref.path);
			if (queryClient.getQueryData(options.queryKey) === "exists") {
				open(ref);
				return "opened";
			}
			const busy = setTimeout(() => {
				element.setAttribute("aria-busy", "true");
			}, BUSY_DELAY_MS);
			let status: FileRefStatus;
			try {
				status = await queryClient.query({...options, staleTime: 0});
			} catch {
				// A failed check opens anyway; the Files pane reports what went wrong.
				status = "exists";
			} finally {
				clearTimeout(busy);
				element.removeAttribute("aria-busy");
			}
			if (status === "exists") {
				open(ref);
				return "opened";
			}
			if (status === "missing") markFileRefMissing(sessionId, ref.path);
			return status;
		},
		[queryClient, sessionId, open],
	);
}

/** The surrounding {@link FileRefsProvider}'s working directory, if any. */
export function useFileRefsCwd(): string | undefined {
	return useContext(FileRefsContext)?.cwd;
}

/**
 * Upstream `Yn`'s ⌘/Ctrl-click: a ref inside the cwd opens with its default
 * app instead of the Files pane. Returns whether it took the click.
 */
function useDefaultAppOpen(): (ref: FileRef) => boolean {
	const cwd = useFileRefsCwd();
	const openInDefaultApp = useOpenInDefaultApp();
	return useCallback(
		(ref) => {
			if (relativeToCwd(ref.path, cwd) === null) return false;
			openInDefaultApp(ref.path);
			return true;
		},
		[cwd, openInDefaultApp],
	);
}

/** The open handler of the surrounding {@link FileRefsProvider}, if any. */
function useOpenFileRef(): ((ref: FileRef) => void) | null {
	return useContext(FileRefsContext)?.open ?? null;
}

interface FileRefButtonProps {
	role: "button";
	tabIndex: 0;
	"data-file-ref": "";
	"data-file-path": string;
	"data-file-line"?: number;
	onClick: (event: MouseEvent) => void;
	onKeyDown: (event: KeyboardEvent) => void;
}

function fileRefButtonProps(
	ref: FileRef,
	open: (ref: FileRef) => void,
	openDefaultApp: (ref: FileRef) => boolean,
): FileRefButtonProps {
	return {
		role: "button",
		tabIndex: 0,
		"data-file-ref": "",
		"data-file-path": ref.path,
		...(ref.line === undefined ? {} : {"data-file-line": ref.line}),
		onClick: (event) => {
			event.stopPropagation();
			if ((event.metaKey || event.ctrlKey) && openDefaultApp(ref)) return;
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
	const openDefaultApp = useDefaultAppOpen();
	return render(ref === undefined || ref.block !== undefined ? null : fileRefButtonProps(ref, open, openDefaultApp));
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
	sessionId,
	open,
	smartQuotes,
}: {
	markdown: string;
	sessionId: string;
	open: (ref: FileRef) => void;
	smartQuotes: boolean;
}) {
	const texts = useMemo(() => fileRefTexts(markdown), [markdown]);
	const refs = useFileRefs(texts, true);
	const checkedOpen = useCheckedOpen(sessionId, open);
	const openDefaultApp = useDefaultAppOpen();
	const artifactTitles = useArtifactTitles(markdown);
	return (
		<MarkdownArticle
			markdown={markdown}
			fileRefs={refs}
			onFileRef={checkedOpen}
			onFileRefDefaultApp={openDefaultApp}
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
	const context = useContext(FileRefsContext);
	return context === null ? (
		<MarkdownArticle markdown={markdown} smartQuotes={smartQuotes} zonedTimes={smartQuotes} />
	) : (
		<LinkedProseMarkdown
			markdown={markdown}
			sessionId={context.sessionId}
			open={context.open}
			smartQuotes={smartQuotes}
		/>
	);
}
