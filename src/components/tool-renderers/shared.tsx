import {type ReactNode, useCallback, useMemo, useState, useSyncExternalStore} from "react";
import {renderMarkdownWithHighlighting} from "../../lib/client-markdown";
import {getHighlighterSync, getHighlighterVersion, subscribeHighlighter} from "../../hooks/use-shiki";
import {useCodeThemes} from "../../hooks/use-code-themes";
import {parseAnsiCodes} from "../../lib/ansi-codes";
import {handleCodeCopyClick} from "../../lib/code-copy";
import {formatDuration} from "../../lib/format-duration";
import {CHECK_ICON_PATH, COPY_ICON_PATH} from "../../lib/icon-paths";
import {FileRefTarget} from "../file-refs";
import markdownStyles from "../markdown-article.module.css";
import {Tooltip} from "../ui/tooltip";
import {TOOL_OUTPUT_REGION} from "./tool-output-region";

export function AnsiText({content}: {content: string}) {
	const parts = parseAnsiCodes(content);

	return (
		<>
			{parts.map((part, i) => (
				<span
					key={i}
					style={{
						color: part.fg,
						backgroundColor: part.bg,
						fontWeight: part.bold ? "bold" : undefined,
						opacity: part.dim ? 0.7 : undefined,
						fontStyle: part.italic ? "italic" : undefined,
						textDecoration: part.underline ? "underline" : undefined,
					}}
				>
					{part.text}
				</span>
			))}
		</>
	);
}

/** Link styling for a tool path that opens in the Files pane. */
const FILE_REF_CLASSES = "cursor-pointer hover:text-accent-000 hover:underline";

function withFileRefClasses(className: string, linked: boolean): string {
	return linked ? `${className} ${FILE_REF_CLASSES}` : className;
}

export function FilePath({path}: {path: string}) {
	return (
		<FileRefTarget
			path={path}
			render={(refProps) => (
				<code
					className={withFileRefClasses(
						"text-xs font-mono bg-surface-0 px-1.5 py-0.5 rounded truncate",
						refProps !== null,
					)}
					{...refProps}
				>
					{path}
				</code>
			)}
		/>
	);
}

/**
 * Split a file path into a truncatable prefix and a suffix.
 * The suffix always includes the filename and enough parent directories
 * to land near the midpoint of the full path on a `/` boundary.
 */
function splitPath(filePath: string): {prefix: string; suffix: string} {
	const midpoint = Math.floor(filePath.length / 2);
	let splitIndex = -1;

	for (let i = midpoint; i >= 0; i--) {
		if (filePath[i] === "/") {
			splitIndex = i;
			break;
		}
	}

	if (splitIndex <= 0) {
		return {prefix: "", suffix: filePath};
	}

	return {
		prefix: filePath.slice(0, splitIndex + 1),
		suffix: filePath.slice(splitIndex + 1),
	};
}

/**
 * File-path header for a tool card: the path splits near its midpoint so the
 * leading directories ellipsize first. Both halves are truncatable — upstream
 * lets the tail ellipsize too, so a long final segment shrinks instead of
 * pushing the copy button out of the card.
 */
export function TruncatedFilePathHeader({filePath}: {filePath: string}) {
	const {prefix, suffix} = splitPath(filePath);

	return (
		<FileRefTarget
			path={filePath}
			render={(refProps) => (
				<span
					className={withFileRefClasses(
						"flex flex-1 min-w-0 overflow-hidden whitespace-nowrap text-body text-secondary",
						refProps !== null,
					)}
					title={filePath}
					{...refProps}
				>
					<span className="min-w-0 truncate">{prefix}</span>
					<span className="max-w-full shrink-0 truncate">{suffix}</span>
				</span>
			)}
		/>
	);
}

/**
 * Inline diff stats matching upstream claude.ai/code:
 *   span.inline-flex > span.flex.gap-g1 > span.text-git-added "+N"
 *                                       > span.text-git-removed  "−M" (U+2212)
 * `tabular-nums` keeps the digits aligned when Edit rows stack.
 */
const DIFF_STAT_SEGMENT = "flex items-center gap-[1px] px-1";

/**
 * Upstream's group-header diff stat: a 16px, 10px/500 pill of two segments on
 * the git added/removed tints, both drawn even when one side is 0, with the
 * counts spelled out for screen readers.
 */
export function DiffStatPill({added, removed}: {added: number; removed: number}) {
	return (
		<span
			data-diff-stat-pill=""
			className="ms-1 inline-flex h-[1lh] shrink-0 items-center text-ink-muted tabular-nums"
		>
			<span
				aria-hidden="true"
				className="inline-flex h-4 overflow-clip rounded-r3 text-[10px]/[13px] font-medium"
			>
				<span data-diff-stat-segment="" className={`${DIFF_STAT_SEGMENT} text-diff-added bg-diff-added/20`}>
					<span>+</span>
					<span>{added}</span>
				</span>
				<span data-diff-stat-segment="" className={`${DIFF_STAT_SEGMENT} text-diff-removed bg-diff-removed/20`}>
					<span>−</span>
					<span>{removed}</span>
				</span>
			</span>
			<span className="sr-only">
				{added} added, {removed} removed
			</span>
		</span>
	);
}

export function DiffStats({added, removed}: {added: number; removed: number}) {
	if (added === 0 && removed === 0) return null;
	return (
		<span className="inline-flex">
			<span className="flex gap-g1 items-center text-body tabular-nums shrink-0">
				<span className="text-diff-added">+{added}</span>
				<span className="text-diff-removed">−{removed}</span>
			</span>
		</span>
	);
}

/**
 * Upstream recolors a failed tool body instead of indenting it behind a rail:
 * the whole body renders in `text-danger-ink` (upstream danger red), with no border or padding
 * shift anywhere.
 */
export function ErrorBorder({isError, children}: {isError?: boolean | undefined; children: ReactNode}) {
	if (!isError) return <>{children}</>;
	return <div className="text-danger-ink">{children}</div>;
}

/**
 * Output of a local `!command`. Upstream has no badge and no filled code slab:
 * failure reads as danger-red body text, so the exit code renders as one more line of
 * the same mono `text-code` type and the output takes the Bash card's body
 * treatment — wrapped, and capped at 400px with its own scroller.
 */
export function TerminalOutput({content}: {content: string}) {
	// Extract exit code if present at the start of the content
	const exitCodeMatch = content.match(/^Exit code (\d+)\n?/);
	const exitCode = exitCodeMatch?.[1] ? parseInt(exitCodeMatch[1], 10) : null;
	const contentWithoutExitCode = exitCodeMatch ? content.replace(/^Exit code \d+\n?/, "") : content;
	const inkClass = exitCode !== null && exitCode !== 0 ? "text-danger-ink" : "text-secondary";

	return (
		<div className="text-code font-mono">
			{exitCode !== null && <div className={inkClass}>Exit code {exitCode}</div>}
			<pre
				{...TOOL_OUTPUT_REGION}
				className={`max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all ${inkClass}`}
			>
				<AnsiText content={contentWithoutExitCode} />
			</pre>
		</div>
	);
}

/**
 * Wraps tall content in a soft cap: shows up to `maxLines` worth of height,
 * with a gradient fade + "Show all N lines" button when overflow. Click to
 * reveal the rest inline — no inner scrollbar.
 */
export function ExpandableBlock({
	lineCount,
	maxLines = 20,
	children,
}: {
	lineCount: number;
	maxLines?: number;
	children: ReactNode;
}) {
	const [expanded, setExpanded] = useState(false);
	const needsCap = lineCount > maxLines;

	if (!needsCap || expanded) {
		return <div>{children}</div>;
	}

	// ~1.4rem per line of text-xs leading-relaxed. Keep this tight so the
	// fade/button appear just below the cutoff.
	const maxHeight = `${maxLines * 1.4}rem`;

	return (
		<div>
			<div className="relative overflow-hidden" style={{maxHeight}}>
				{children}
				<div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface-2 to-transparent pointer-events-none" />
			</div>
			<button
				type="button"
				onClick={() => {
					setExpanded(true);
				}}
				className="mt-1 text-xs text-t6 hover:text-primary transition cursor-pointer"
			>
				Show all {lineCount} lines
			</button>
		</div>
	);
}

export function ChevronIcon({expanded, size = 14}: {expanded: boolean; size?: number}) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="shrink-0">
			<path
				d={
					expanded
						? "M10.2249 6.22426C10.469 5.98056 10.8647 5.98045 11.1087 6.22426C11.3528 6.46833 11.3528 6.86494 11.1087 7.10902L8.9134 9.30434C8.40899 9.80852 7.5906 9.80863 7.08626 9.30434L4.89094 7.10902C4.64687 6.86494 4.64687 6.46833 4.89094 6.22426C5.13502 5.98018 5.53163 5.98018 5.77571 6.22426L7.97102 8.41957C7.98728 8.43578 8.01338 8.43581 8.02962 8.41957L10.2249 6.22426Z"
						: "M6.34364 4.80476C6.58772 4.56068 6.98433 4.56068 7.22841 4.80476L9.42372 7.00007C9.92802 7.50442 9.92791 8.32281 9.42372 8.82722L7.22841 11.0225C6.98433 11.2666 6.58772 11.2666 6.34364 11.0225C6.09984 10.7786 6.09994 10.3828 6.34364 10.1387L8.53895 7.94343C8.55519 7.92719 8.55516 7.9011 8.53895 7.88484L6.34364 5.68953C6.09956 5.44545 6.09956 5.04884 6.34364 4.80476Z"
				}
				fill="currentColor"
			/>
		</svg>
	);
}

const TOOL_CALL_DETAILS_REGION = {role: "group", "aria-label": "Tool call details", tabIndex: 0} as const;

function CopyIcon({size}: {size: number}) {
	return (
		<svg width={size} height={size} viewBox="0 0 12 12" fill="none" className="shrink-0">
			<path d={COPY_ICON_PATH} fill="currentColor" />
		</svg>
	);
}

function CheckIcon({size}: {size: number}) {
	return (
		<svg width={size} height={size} viewBox="0 0 12 12" fill="none" className="shrink-0">
			<path
				d={CHECK_ICON_PATH}
				stroke="currentColor"
				strokeWidth={1.5}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

/**
 * Hover-visible copy button matching upstream claude.ai/code: 24x24 with a
 * 16px icon (20x20 with a 12px icon at `size="xs"`), under the dark "Copy" tooltip.
 *
 * Requires a `group/body` ancestor for the hover reveal.
 * Copies the provided `text` to the clipboard on click.
 */
export function CopyButton({text, label = "Copy", size}: {text: string; label?: string; size?: "xs"}) {
	const [copied, setCopied] = useState(false);

	const handleClick = useCallback(() => {
		void navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => {
			setCopied(false);
		}, 1500);
	}, [text]);
	const iconSize = size === "xs" ? 12 : 16;

	return (
		<div className="opacity-0 group-hover/body:opacity-100 focus-within:opacity-100 [transition:opacity_150ms_cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none">
			<Tooltip content={label}>
				<button
					type="button"
					aria-label={label}
					onClick={handleClick}
					className={`inline-flex ${size === "xs" ? "size-5" : "size-6"} items-center justify-center border-0 cursor-default select-none rounded-r4 text-secondary hover:text-primary hover:bg-t2 transition-colors`}
				>
					{copied ? <CheckIcon size={iconSize} /> : <CopyIcon size={iconSize} />}
				</button>
			</Tooltip>
		</div>
	);
}

/**
 * Outer layout for renderers that draw their own body instead of going through
 * KeyValueCard. Upstream attaches a copy control to every expanded body, so the
 * custom MCP renderers mirror KeyValueCard's row here: content column plus a
 * hover-revealed CopyButton sibling.
 *
 * The button sits outside any `ErrorBorder`, so a failed call recolors its body
 * without recoloring the copy affordance.
 */
export function CopyableBody({copyText, children}: {copyText: string; children: ReactNode}) {
	return (
		<div className="flex w-full">
			<div className="flex-1 min-w-0">{children}</div>
			<CopyButton text={copyText} />
		</div>
	);
}

export function CollapsibleSection({
	label,
	defaultOpen = false,
	children,
}: {
	label: ReactNode;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div>
			<button
				type="button"
				onClick={() => {
					setOpen(!open);
				}}
				className="flex items-center gap-1 text-xs text-t6 hover:text-primary cursor-pointer"
			>
				<ChevronIcon expanded={open} />
				{label}
			</button>
			{open && (
				<div className="flow-root">
					<div className="mt-1">{children}</div>
				</div>
			)}
		</div>
	);
}

/**
 * Inline markdown renderer for KeyValueCard param values.
 * Memoizes the HTML output to avoid re-rendering on every parent render.
 */
function InlineMarkdown({text}: {text: string}) {
	const highlighterVersion = useSyncExternalStore(subscribeHighlighter, getHighlighterVersion, () => 0);
	const codeThemes = useCodeThemes();
	const html = useMemo(() => {
		void highlighterVersion;
		return renderMarkdownWithHighlighting(text, getHighlighterSync(), {codeThemes});
	}, [text, codeThemes, highlighterVersion]);
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegates clicks from the rendered links and copy buttons inside it, which are keyboard-reachable themselves
		<div
			className={markdownStyles["markdown"]}
			onClick={handleCodeCopyClick}
			dangerouslySetInnerHTML={{__html: html}}
		/>
	);
}

export interface KeyValueParam {
	key: string;
	value: string;
	/** When true, render the value as markdown instead of plain text. */
	markdown?: boolean;
}

/**
 * Upstream-style key-value card used by Grep, Glob, Agent, WebFetch,
 * WebSearch, and most non-file tools.
 *
 * Layout:
 *   flex w-full
 *     flex-1 column
 *       max-h-[400px] scroller (error + params + result + children)
 *     CopyButton (hover-visible, outside the scroller)
 *
 * A failed call drops the column's `text-secondary` and renders the
 * result as a danger-red error message above the params, matching upstream.
 */
export function KeyValueCard({
	params,
	result,
	markdownResult,
	copyText,
	isError,
	children,
}: {
	params: KeyValueParam[];
	result?: string | undefined;
	markdownResult?: boolean | undefined;
	/** Overrides the default params + result copy payload. */
	copyText?: string | undefined;
	/** Renders the result as the failure message: danger red, above the params. */
	isError?: boolean | undefined;
	children?: ReactNode;
}) {
	const derivedCopyText = [...params.map((p) => `${p.key}: ${p.value}`), ...(result ? [result] : [])].join("\n");
	const errorMessage = isError ? result : undefined;
	const body = isError ? undefined : result;

	return (
		<div className="flex w-full">
			<div
				className={`flex-1 min-w-0 flex flex-col gap-g4 text-body${isError ? "" : " text-secondary"} whitespace-pre-wrap break-words`}
			>
				<div {...TOOL_CALL_DETAILS_REGION} className="max-h-[400px] overflow-y-auto flex flex-col gap-g4">
					{errorMessage && <div className="text-danger-ink">{errorMessage}</div>}
					{params.length > 0 && (
						<div className="text-secondary flex flex-col gap-g2">
							{params.map((p) => (
								<div key={p.key} className="break-words">
									{/* Upstream's generic row: a muted mono key, a space, then the value as plain body text. */}
									<span className="text-[12px]/[17px] font-mono opacity-70">{`${p.key}:`}</span>{" "}
									{p.markdown ? <InlineMarkdown text={p.value} /> : p.value}
								</div>
							))}
						</div>
					)}
					{body && (markdownResult ? <InlineMarkdown text={body} /> : <div>{body}</div>)}
					{children}
				</div>
			</div>
			<CopyButton text={copyText ?? derivedCopyText} />
		</div>
	);
}

export function ToolMeta({children}: {children: ReactNode}) {
	return <span className="text-xs text-t6">{children}</span>;
}

export function DurationBadge({duration}: {duration: number}) {
	return <span className="text-xs text-t6 ml-1.5">{formatDuration(duration)}</span>;
}
