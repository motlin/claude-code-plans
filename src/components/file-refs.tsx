import {useQuery} from "@tanstack/react-query";
import {type ReactNode, useCallback, useContext, useMemo} from "react";

import {type ArtifactSummary, artifactsQueryOptions} from "../lib/api/artifacts";
import {fileRefTexts, mentionsArtifactUrl} from "../lib/client-markdown";
import {requestFileOpen} from "../lib/file-open-requests";
import type {FileRef} from "../lib/file-refs";
import type {SessionFiles} from "../lib/session-files";
import {MarkdownArticle, PlainTextArticle} from "./markdown-article";
import {BlockedFileRef} from "./blocked-file-ref";
import {RenderErrorBoundary} from "./render-error-boundary";
import {useFocusSlot} from "./use-focus-slot";
import {usePaneHost} from "./panes/pane-host-context";
import {FileRefsContext, FileRefsProvider} from "./file-refs-context";
import
{
	type FileRefButtonProps,
	fileRefButtonProps,
	useCheckedOpen,
	useDefaultAppOpen,
	useFileRefs,
	useOpenFileRef,
} from "./use-file-ref-link";

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
})
{
	const host = usePaneHost();
	const {openPane} = host;
	const sessionPaths = useMemo(() => sessionFiles.files.map((file) => file.absolutePath), [sessionFiles]);
	const open = useCallback(
		(ref: FileRef) =>
		{
			requestFileOpen(sessionId, ref);
			openPane("files");
		},
		[sessionId, openPane],
	);
	const value = useMemo(
		() => (
		{
			sessionId,
			cwd,
			sessionPaths,
			open,
		}),
		[sessionId, cwd, sessionPaths, open],
	);
	return <FileRefsProvider value={value}>{children}</FileRefsProvider>;
}

type RenderFileRef = (props: FileRefButtonProps | null) => ReactNode;

function ResolvedFileRefTarget({
	path,
	open,
	render,
	wrapBlocked,
}: {
	path: string;
	open: (ref: FileRef) => void;
	render: RenderFileRef;
	wrapBlocked: boolean;
}): ReactNode
{
	const texts = useMemo(() => [path], [path]);
	const ref = useFileRefs(texts).get(path);
	const openDefaultApp = useDefaultAppOpen();
	const focusSlot = useFocusSlot();
	if (ref?.block !== undefined && wrapBlocked)
		return (
			<BlockedFileRef path={ref.path} block={ref.block} focusSlot={focusSlot}>
				{render(null)}
			</BlockedFileRef>
		);
	return render(ref === undefined || ref.block !== undefined ? null : fileRefButtonProps(ref, open, openDefaultApp));
}

/**
 * Renders a tool path, handing `render` button props once the path is
 * confirmed to exist (null until then, for a blocked path, and always null
 * outside a provider). With `wrapBlocked`, a blocked path's fallback sits in
 * upstream's disabled-reason wrapper (`Ia` > `Jr`).
 */
export function FileRefTarget({
	path,
	render,
	wrapBlocked = false,
}: {
	path: string;
	render: RenderFileRef;
	wrapBlocked?: boolean;
}): ReactNode
{
	const open = useOpenFileRef();
	return open === null ? (
		render(null)
	) : (
		<ResolvedFileRefTarget path={path} open={open} render={render} wrapBlocked={wrapBlocked} />
	);
}

function artifactTitlesById(artifacts: ArtifactSummary[]): ReadonlyMap<string, string>
{
	return new Map(artifacts.map((artifact) => [artifact.id, artifact.title]));
}

/** Indexed artifact titles, fetched only when the prose links to an artifact. */
function useArtifactTitles(markdown: string): ReadonlyMap<string, string> | undefined
{
	const {data} = useQuery(
		{
			...artifactsQueryOptions,
			enabled: mentionsArtifactUrl(markdown),
			select: artifactTitlesById,
		},
	);
	return data;
}

function LinkedProseMarkdown({
	markdown,
	sessionId,
	open,
	smartQuotes,
	diagrams,
}: {
	markdown: string;
	sessionId: string;
	open: (ref: FileRef) => void;
	smartQuotes: boolean;
	diagrams: boolean;
})
{
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
			diagrams={diagrams}
		/>
	);
}

/**
 * Assistant prose whose inline-code paths become clickable file refs; with
 * `smartQuotes`, its quotes curl and its zoned clock times underline as
 * upstream's assistant text does. With `diagrams` (upstream's "diagram" context, assistant transcript text
 * only), mermaid fences draw as diagrams.
 */
export function ProseMarkdown({
	markdown,
	smartQuotes = false,
	diagrams = false,
}: {
	markdown: string;
	smartQuotes?: boolean;
	diagrams?: boolean;
})
{
	const context = useContext(FileRefsContext);
	// Upstream's ChatText boundary (`bS`): a markdown crash falls back to the plain text until the text changes.
	return (
		<RenderErrorBoundary
			resetOn={markdown}
			fallback={<PlainTextArticle text={markdown} />}
			report={reportProseCrash}
		>
			{context === null ? (
				<MarkdownArticle
					markdown={markdown}
					smartQuotes={smartQuotes}
					zonedTimes={smartQuotes}
					diagrams={diagrams}
				/>
			) : (
				<LinkedProseMarkdown
					markdown={markdown}
					sessionId={context.sessionId}
					open={context.open}
					smartQuotes={smartQuotes}
					diagrams={diagrams}
				/>
			)}
		</RenderErrorBoundary>
	);
}

function reportProseCrash(error: unknown)
{
	console.error("[chat-text]", error);
}
