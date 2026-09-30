import type {ThemedToken} from "@shikijs/core";
import {type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {useHighlightedLines} from "../hooks/use-shiki";
import type {FileViewerData} from "../lib/api/file";
import {detectLanguage} from "../lib/diff-utils";

export function parseFileLineHash(hash: string): number | null {
	return parseFileLineRangeHash(hash)?.line ?? null;
}

/** `#L12` or `#L12-L20`; null for anything else, including reversed ranges. */
function parseFileLineRangeHash(hash: string): {line: number; endLine: number} | null {
	const match = /^#L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(hash);
	if (!match) return null;
	const line = Number(match[1]);
	const endLine = match[2] === undefined ? line : Number(match[2]);
	if (!Number.isSafeInteger(line) || !Number.isSafeInteger(endLine) || endLine < line) return null;
	return {line, endLine};
}

export function fileViewerLanguage(path: string): string | null {
	return detectLanguage(path);
}

/** Files longer than this mount only the chunks of lines near the viewport. */
const VIRTUALIZE_OVER_LINES = 2000;
const CHUNK_LINES = 200;
const ESTIMATED_LINE_PX = 20;

function HighlightedLine({tokens}: {tokens: ThemedToken[]}) {
	return (
		<>
			{tokens.map((token, index) => (
				<span key={`${token.offset}-${index}`} style={{color: token.color}}>
					{token.content}
				</span>
			))}
		</>
	);
}

interface Selection {
	start: number;
	end: number;
	nonce: number;
}

export interface FileViewerProps {
	file: FileViewerData;
	/** Soft-wrap long lines instead of scrolling sideways. */
	wrap?: boolean;
	tabSize?: number;
	/** Scroll to and highlight this line (through `endLine`) whenever it changes. */
	line?: number | undefined;
	endLine?: number | undefined;
	/** Read and write `#L<n>` in the page URL; off inside panes that share the page. */
	hashNavigation?: boolean;
	/** Mount this line's chunk without selecting it, so find in file can reach it. */
	revealLine?: number | undefined;
}

/**
 * Which chunks of lines are mounted. One IntersectionObserver mounts chunks as
 * they near the viewport and unmounts them as they leave, remembering each
 * chunk's rendered height so the placeholder keeps the scroll position steady.
 */
function useMountedChunks(containerRef: RefObject<HTMLDivElement | null>, virtualized: boolean) {
	const [mounted, setMounted] = useState<ReadonlySet<number>>(() => new Set([0]));
	const heights = useRef(new Map<number, number>());

	useEffect(() => {
		if (!virtualized || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			(entries) => {
				setMounted((previous) => {
					let next: Set<number> | null = null;
					for (const entry of entries) {
						const chunk = Number((entry.target as HTMLElement).dataset["chunk"]);
						if (previous.has(chunk)) heights.current.set(chunk, entry.boundingClientRect.height);
						if (entry.isIntersecting === previous.has(chunk)) continue;
						next ??= new Set(previous);
						if (entry.isIntersecting) next.add(chunk);
						else next.delete(chunk);
					}
					return next ?? previous;
				});
			},
			{rootMargin: "1500px 0px"},
		);
		for (const element of containerRef.current?.querySelectorAll("[data-chunk]") ?? []) {
			observer.observe(element);
		}
		return () => observer.disconnect();
	}, [containerRef, virtualized]);

	const mount = useCallback((chunk: number) => {
		setMounted((previous) => (previous.has(chunk) ? previous : new Set(previous).add(chunk)));
	}, []);

	return {mounted, heights: heights.current, mount};
}

/** Read-only source lines with a line-number gutter, line targeting and optional wrap. */
export function FileViewer({
	file,
	wrap = false,
	tabSize = 4,
	line,
	endLine,
	hashNavigation = true,
	revealLine,
}: FileViewerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const lines = useMemo(() => file.content.split("\n"), [file.content]);
	const tokens = useHighlightedLines(file.content, fileViewerLanguage(file.path));
	const virtualized = lines.length > VIRTUALIZE_OVER_LINES;
	const chunks = useMountedChunks(containerRef, virtualized);
	const {mount} = chunks;
	const [selection, setSelection] = useState<Selection | null>(null);
	const nonceRef = useRef(0);
	const pendingScrollRef = useRef<number | null>(null);
	const lineCount = lines.length;

	const select = useCallback(
		(start: number, end: number) => {
			if (start > lineCount) {
				setSelection(null);
				return;
			}
			nonceRef.current += 1;
			pendingScrollRef.current = nonceRef.current;
			setSelection({
				start,
				end: Math.min(Math.max(start, end), lineCount),
				nonce: nonceRef.current,
			});
			mount(Math.floor((start - 1) / CHUNK_LINES));
		},
		[lineCount, mount],
	);

	useLayoutEffect(() => {
		if (selection === null || pendingScrollRef.current !== selection.nonce) return;
		const element = containerRef.current?.querySelector<HTMLElement>(`#L${selection.start}`);
		if (!element) return;
		pendingScrollRef.current = null;
		element.scrollIntoView({block: "center"});
	}, [selection, chunks.mounted]);

	useEffect(() => {
		if (!hashNavigation) return;
		const handleHashChange = () => {
			const range = parseFileLineRangeHash(window.location.hash);
			if (range === null) setSelection(null);
			else select(range.line, range.endLine);
		};
		handleHashChange();
		window.addEventListener("hashchange", handleHashChange);
		return () => window.removeEventListener("hashchange", handleHashChange);
	}, [hashNavigation, select, file.path]);

	useEffect(() => {
		if (line !== undefined) select(line, endLine ?? line);
	}, [line, endLine, select]);

	useEffect(() => {
		if (revealLine !== undefined) mount(Math.floor((revealLine - 1) / CHUNK_LINES));
	}, [revealLine, mount]);

	const selectLine = (lineNumber: number) => {
		if (hashNavigation) window.history.pushState(null, "", `#L${lineNumber}`);
		select(lineNumber, lineNumber);
	};

	const renderRow = (index: number) => {
		const lineNumber = index + 1;
		const lineId = `L${lineNumber}`;
		const isHighlighted = selection !== null && lineNumber >= selection.start && lineNumber <= selection.end;
		return (
			<div
				id={lineId}
				key={lineId}
				role="row"
				data-highlighted={isHighlighted ? "true" : undefined}
				className={`flex min-h-5 scroll-mt-16 ${isHighlighted ? "bg-accent-100/15" : ""}`}
			>
				<a
					href={`#${lineId}`}
					aria-current={isHighlighted && lineNumber === selection.start ? "location" : undefined}
					aria-label={`Go to line ${lineNumber}`}
					data-find-ignore=""
					className="w-14 shrink-0 select-none border-r border-strong pr-3 text-right text-t6 hover:text-accent-100"
					onClick={(event) => {
						event.preventDefault();
						selectLine(lineNumber);
					}}
					role="cell"
				>
					{lineNumber}
				</a>
				<code
					className={`block min-w-0 flex-1 px-4 text-primary ${
						wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
					}`}
					role="cell"
				>
					{tokens?.[index] ? <HighlightedLine tokens={tokens[index]} /> : lines[index]}
				</code>
			</div>
		);
	};

	const rowRange = (from: number, to: number) =>
		Array.from({length: to - from}, (_, offset) => renderRow(from + offset));

	return (
		<div ref={containerRef} className={`rounded-lg border border-strong ${wrap ? "" : "overflow-x-auto"}`}>
			<div
				data-file-source=""
				className={`bg-surface-1 py-2 font-mono text-xs leading-5 ${wrap ? "" : "min-w-max"}`}
				role="table"
				style={{tabSize}}
			>
				{virtualized
					? Array.from({length: Math.ceil(lines.length / CHUNK_LINES)}, (_, chunk) => {
							const from = chunk * CHUNK_LINES;
							const to = Math.min(from + CHUNK_LINES, lines.length);
							const isMounted = chunks.mounted.has(chunk);
							return (
								<div
									key={chunk}
									data-chunk={chunk}
									role="rowgroup"
									style={
										isMounted
											? undefined
											: {height: chunks.heights.get(chunk) ?? (to - from) * ESTIMATED_LINE_PX}
									}
								>
									{isMounted ? rowRange(from, to) : null}
								</div>
							);
						})
					: rowRange(0, lines.length)}
			</div>
		</div>
	);
}
