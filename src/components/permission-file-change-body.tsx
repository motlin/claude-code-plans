import type {FileOptions} from "@pierre/diffs/react";
import {File} from "@pierre/diffs/react";
import {type CSSProperties, type ReactNode, useEffect, useMemo, useState} from "react";

import {useCodeThemeBackground} from "../hooks/use-code-theme-background";
import {useCodeThemes} from "../hooks/use-code-themes";
import {fileContentUrl, FileViewerResponse} from "../lib/api/file";
import {resolveUrl} from "../lib/api/client";
import {buildMultiEditHunk, buildPatchFromHunks, buildUnifiedHunk} from "../lib/diff-utils";
import {asRecord} from "../lib/narrow";
import {analyzeFileChange, type FileChangeRead, shownFileChangeNote} from "../lib/permission-file-change";
import {DIFFS_HOST_CLASS, INLINE_DIFFS_STYLE_OVERRIDES} from "./changes/diffs-config";
import {useResolvedTheme} from "./theme-context";
import {InlinePatchDiff} from "./tool-renderers/inline-diff";

/** Upstream's `Hx`/`Ux`: each row reserves 16px of the scroller, which caps at 400px. */
const ROW_RESERVE_PX = 16;
const SCROLLER_MAX_PX = 400;
/** Upstream's `Sb`: the skeleton is at most 16 lines tall. */
const SKELETON_MAX_LINES = 16;

/** Upstream's in-card `Yx` scroller (`Lx` + the code card); local's `card-ring` stands in for `epitaxy-code-card`'s ring. */
const SCROLLER_CLASS = "max-h-[400px] overflow-y-auto epitaxy-diff card-ring rounded-lg overflow-clip";

function stringField(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

/** Each read file's result, once per tool input (upstream's `Du` WeakMap). */
const settledReads = new WeakMap<object, FileChangeRead>();
const pendingReads = new WeakMap<object, Promise<FileChangeRead>>();

/** Upstream's `Eu`: the file's text, unreadable when the server refuses the path, else nothing to compare. */
async function readFileChange(name: string, input: Record<string, unknown>, path: string): Promise<FileChangeRead> {
	try {
		const response = await fetch(resolveUrl(fileContentUrl(path)), {credentials: "same-origin"});
		if (response.status === 403) return {kind: "unreadable"};
		if (!response.ok) return {kind: "none"};
		const {content} = FileViewerResponse.parse(await response.json());
		return content.includes("\0")
			? {kind: "none"}
			: {kind: "read", analysis: analyzeFileChange(name, input, content)};
	} catch {
		return {kind: "none"};
	}
}

/** Upstream's `Ou`/`ku`: only a Write or Edit reads its file; null while the read is pending. */
function useFileChangeRead(name: string, input: Record<string, unknown>): FileChangeRead | null {
	const path = stringField(input, "file_path");
	const reads = path !== undefined && (name === "Write" || name === "Edit");
	const [read, setRead] = useState<FileChangeRead | null>(() =>
		reads ? (settledReads.get(input) ?? null) : {kind: "none"},
	);
	useEffect(() => {
		if (!reads) {
			setRead({kind: "none"});
			return undefined;
		}
		const settled = settledReads.get(input);
		if (settled !== undefined) {
			setRead(settled);
			return undefined;
		}
		let cancelled = false;
		let pending = pendingReads.get(input);
		if (pending === undefined) {
			pending = readFileChange(name, input, path).then((result) => {
				settledReads.set(input, result);
				return result;
			});
			pendingReads.set(input, pending);
		}
		void pending.then((result) => {
			if (!cancelled) setRead(result);
		});
		return () => {
			cancelled = true;
		};
	}, [reads, name, input, path]);
	return read;
}

/**
 * Upstream's `cx`: a previewed Write/Edit/MultiEdit card's path detail (drawn by the card, with the note the
 * file read earns) and then the change itself, or upstream's skeleton while the file read is pending.
 */
export function PermissionFileChangePreview({
	toolName,
	toolInput,
	copyNote,
	drawDetail,
}: {
	toolName: string;
	toolInput: Record<string, unknown>;
	/** The copy's own note ("Replaces every match in the file."), which a disk note replaces. */
	copyNote: string | null;
	drawDetail: (note: string | null) => ReactNode;
}) {
	const read = useFileChangeRead(toolName, toolInput);
	return (
		<>
			{drawDetail(read === null ? copyNote : shownFileChangeNote(read, copyNote))}
			{read === null ? (
				<FileChangeSkeleton toolInput={toolInput} />
			) : (
				<FileChangeBody toolName={toolName} toolInput={toolInput} read={read} />
			)}
		</>
	);
}

function countNewlines(text: string): number {
	return text.split("\n").length - 1;
}

/** Upstream's `lx`: a placeholder as tall as the change's first 16 lines. */
function FileChangeSkeleton({toolInput}: {toolInput: Record<string, unknown>}) {
	const content = toolInput["content"];
	const text = typeof content === "string" ? content : (stringField(toolInput, "new_string") ?? "");
	const lines = Math.min(countNewlines(text) + 1, SKELETON_MAX_LINES);
	return (
		<div
			aria-hidden
			className="rounded-lg bg-alpha-1"
			style={{height: `calc(${lines} * var(--upstream-leading-code) + 2 * var(--cds-pad-md, 8px))`}}
		/>
	);
}

/** Upstream's `Jx`: the rows a text draws, a final newline not starting another. */
function textRows(text: string): number {
	return text.split("\n").length - (text.endsWith("\n") && text !== "" ? 1 : 0);
}

/** The rows of a patch's hunks: every line after the first hunk header that isn't another hunk header. */
function patchRows(patch: string): number {
	const lines = patch.split("\n");
	const first = lines.findIndex((line) => line.startsWith("@@"));
	return first === -1 ? 0 : lines.slice(first).filter((line) => /^[ +-]/.test(line)).length;
}

type FileChangeView =
	| {kind: "patch"; patch: string; numbered: boolean; rows: number}
	| {kind: "additions"; content: string; rows: number};

function fileChangeView(name: string, input: Record<string, unknown>, read: FileChangeRead): FileChangeView {
	const path = String(input["file_path"]);
	const fileName = path.replace(/^.*[\\/]/, "");
	const fromDisk = read.kind === "read" ? read.analysis.patch : undefined;
	if (fromDisk !== undefined) {
		const {patch} = buildPatchFromHunks(fromDisk.hunks, fileName);
		return {kind: "patch", patch, numbered: true, rows: patchRows(patch)};
	}
	if (name === "Write") {
		const content = stringField(input, "content") ?? "";
		return {kind: "additions", content, rows: textRows(content)};
	}
	if (name === "MultiEdit") {
		const edits = (Array.isArray(input["edits"]) ? input["edits"] : []).flatMap((edit: unknown) => {
			const record = asRecord(edit);
			const oldString = record === undefined ? undefined : stringField(record, "old_string");
			const newString = record === undefined ? undefined : stringField(record, "new_string");
			return oldString === undefined || newString === undefined ? [] : [{oldString, newString}];
		});
		const patch = buildMultiEditHunk(edits, fileName);
		return {kind: "patch", patch, numbered: false, rows: patchRows(patch)};
	}
	const patch = buildUnifiedHunk(
		stringField(input, "old_string") ?? "",
		stringField(input, "new_string") ?? "",
		fileName,
	);
	return {kind: "patch", patch, numbered: false, rows: patchRows(patch)};
}

/**
 * Upstream's `Yx` in a card (`inCard`, `hideFileHeader`): no header, and the change in a 400px Code scroller
 * on the code theme's background, its height reserved up front at 16px a row.
 */
function FileChangeBody({
	toolName,
	toolInput,
	read,
}: {
	toolName: string;
	toolInput: Record<string, unknown>;
	read: FileChangeRead;
}) {
	const view = useMemo(() => fileChangeView(toolName, toolInput, read), [toolName, toolInput, read]);
	const background = useCodeThemeBackground();
	const hostStyle = useMemo(() => ({"--cds-filediff-bg": background}), [background]);
	return (
		<div data-file-change-body="" className="group/body flex w-full flex-col">
			<div
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's Code scroller (`Z`) is a tab stop for keyboard scrolling
				tabIndex={0}
				role="group"
				aria-label="Code"
				className={SCROLLER_CLASS}
				style={{background, minHeight: Math.min(view.rows * ROW_RESERVE_PX, SCROLLER_MAX_PX)}}
			>
				{view.kind === "patch" ? (
					<InlinePatchDiff patch={view.patch} disableLineNumbers={!view.numbered} hostStyle={hostStyle} />
				) : (
					<PureAdditions path={String(toolInput["file_path"])} content={view.content} hostStyle={hostStyle} />
				)}
			</div>
		</div>
	);
}

/** Upstream's `Fx`: the headerless file's base sheet. */
const FILE_BASE_CSS =
	"[data-line]{min-height:1lh} [data-code]{padding-bottom:var(--diffs-gap-block, var(--diffs-gap-fallback));overflow:clip}";
/**
 * Upstream's `QS` additions tint: every line on the addition background, a `+ ` sign before each line number
 * (`ro`, measured rgba(0,0,0,.6) in light).
 */
const ADDITIONS_CSS =
	'[data-line]{background:var(--diffs-bg-addition);}[data-line-number-content]::before{content:"+ ";display:inline-block;min-width:1ch;color:light-dark(rgb(0 0 0 / 0.6),rgb(255 255 255 / 0.6));}';

/** Upstream's `QS` pure side: a new file's lines, every one an addition, numbered from 1. */
function PureAdditions({path, content, hostStyle}: {path: string; content: string; hostStyle: CSSProperties}) {
	const themeType = useResolvedTheme();
	const theme = useCodeThemes();
	const file = useMemo(() => {
		const name = path.replace(/^.*[\\/]/, "");
		return {name, contents: content, cacheKey: `permission-write:${path}:${content}`};
	}, [path, content]);
	const options = useMemo<FileOptions<undefined, undefined>>(
		() => ({theme, themeType, disableFileHeader: true, overflow: "wrap", unsafeCSS: FILE_BASE_CSS + ADDITIONS_CSS}),
		[theme, themeType],
	);
	const style = useMemo(() => ({...INLINE_DIFFS_STYLE_OVERRIDES, ...hostStyle}), [hostStyle]);
	return (
		<div data-cds="FileDiff" dir="ltr" className={DIFFS_HOST_CLASS} style={style}>
			<File file={file} options={options} disableWorkerPool />
		</div>
	);
}
