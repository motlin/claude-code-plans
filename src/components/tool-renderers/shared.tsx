import {type ReactNode, useCallback, useContext, useMemo, useState} from "react";
import {ansiPartStyle, parseAnsiCodes} from "../../lib/ansi-codes";
import {maskSecrets, maskUrlSecrets, secretToggleLabel} from "../../lib/secret-mask";
import {paramValueText} from "../../lib/param-value-text";
import {pageIsRtl} from "../../lib/page-direction";
import {revealSpoofing} from "../../lib/visible-text";
import {type SecretReveal, useSecretReveal} from "./use-secret-reveal";
import {formatDuration} from "../../lib/format-duration";
import {CHECK_ICON_PATH, COPY_ICON_PATH} from "../../lib/icon-paths";
import {TOUCH_REVEAL} from "../../lib/touch-reveal";
import {useTimedFlag} from "../../hooks/use-timed-flag";
import {FileRefTarget} from "../file-refs";
import {FILE_LINK_CLASS} from "./file-link-class";
import {linkifyToolText} from "../linkify-plain";
import {PlainText} from "./plain-text";
import * as Collapsible from "../ui/collapsible";
import {Icon} from "../ui/icon";
import {Tooltip} from "../ui/tooltip";
import {TOOL_OUTPUT_REGION} from "./tool-output-region";
import {BlockedCallContext, type PolicyDenial} from "./blocked-call-context";
import {ToolAwaitingResultContext} from "./tool-awaiting-result-context";
import {InlineMarkdown} from "./inline-markdown";
import {LabelledSection, ToolOutputSection} from "./tool-output-section";
import type {ClientToolCall} from "./types";
import {allowsMarkdownBody} from "../../lib/tool-body-kind";
import {resolveToolOutput, toolOutputCopyText} from "../../lib/tool-output-resolve";

type AnsiPart = ReturnType<typeof parseAnsiCodes>[number];

/**
 * Upstream's ansi code card masks secrets on the visible text with offsets carried across the styled
 * runs (c5071af19 `Ft`). Masking keeps the text length, so each run takes its slice of the masked text.
 */
function maskAnsiParts(parts: AnsiPart[]): AnsiPart[]
{
	const plain = parts.map((part) => part.text).join("");
	const masked = maskSecrets(plain);
	if (masked === plain) return parts;
	let pos = 0;
	return parts.map((part) =>
	{
		const text = masked.slice(pos, pos + part.text.length);
		pos += part.text.length;
		return {
			...part,
			text,
		};
	});
}

const NAVIGATE_URL_CLASS = "text-body text-accent-100 truncate min-w-0";

/**
 * A navigate call's target URL. Upstream masks a URL that holds a secret
 * (`$2`, keeping the host legible) and does not link it.
 */
export function NavigateUrl({url}: {url: string})
{
	const masked = maskUrlSecrets(url);
	if (masked !== url)
	{
		return (
			<span data-navigate-url className={NAVIGATE_URL_CLASS}>
				{masked}
			</span>
		);
	}
	return (
		<a
			data-navigate-url
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			className={`${NAVIGATE_URL_CLASS} hover:underline`}
		>
			{url}
		</a>
	);
}

/** Draws ANSI-styled output; secrets are masked unless `masked` is false (revealed). */
export function AnsiText({content, masked = true}: {content: string; masked?: boolean})
{
	const parsed = parseAnsiCodes(content);
	const parts = masked ? maskAnsiParts(parsed) : parsed;

	return (
		<>
			{parts.map((part, i) => (
				<span key={i} style={ansiPartStyle(part)}>
					{part.text}
				</span>
			))}
		</>
	);
}

/** Link styling for a tool path that opens in the Files pane. */
const FILE_REF_CLASSES = "cursor-pointer hover:text-accent-000 hover:underline";

function withFileRefClasses(className: string, linked: boolean): string
{
	return linked ? `${className} ${FILE_REF_CLASSES}` : className;
}

export function FilePath({path}: {path: string})
{
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
function splitPath(filePath: string):
{
	prefix: string;
	suffix: string;
}
{
	const midpoint = Math.floor(filePath.length / 2);
	let splitIndex = -1;

	for (let i = midpoint; i >= 0; i--)
	{
		if (filePath[i] === "/")
		{
			splitIndex = i;
			break;
		}
	}

	if (splitIndex <= 0)
	{
		return {
			prefix: "",
			suffix: filePath,
		};
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
export function TruncatedFilePathHeader({filePath}: {filePath: string})
{
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
export function DiffStatPill({added, removed}: {added: number; removed: number})
{
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

export function DiffStats({added, removed}: {added: number; removed: number})
{
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
export function ErrorBorder({isError, children}: {isError?: boolean | undefined; children: ReactNode})
{
	if (!isError) return <>{children}</>;
	return <div className="text-danger-ink">{children}</div>;
}

/**
 * Output of a local `!command`. Upstream has no badge and no filled code slab:
 * failure reads as danger-red body text, so the exit code renders as one more line of
 * the same mono `text-code` type and the output takes the Bash card's body
 * treatment — wrapped, and capped at 400px with its own scroller.
 */
export function TerminalOutput({content}: {content: string})
{
	// Extract exit code if present at the start of the content
	const exitCodeMatch = content.match(/^Exit code (\d+)\n?/);
	const exitCode = exitCodeMatch?.[1] ? parseInt(exitCodeMatch[1], 10) : null;
	const contentWithoutExitCode = exitCodeMatch ? content.replace(/^Exit code \d+\n?/, "") : content;
	const inkClass = exitCode !== null && exitCode !== 0 ? "text-danger-ink" : "text-secondary";
	const secrets = useSecretReveal([contentWithoutExitCode]);
	const exitLine = exitCode !== null && <div className={inkClass}>Exit code {exitCode}</div>;

	return (
		<div className="text-code font-mono">
			{secrets.count > 0 ? (
				<div className="flex items-start justify-between gap-g3">
					{exitLine || <span />}
					<SecretRevealButton {...secrets} />
				</div>
			) : (
				exitLine
			)}
			<pre
				{...TOOL_OUTPUT_REGION}
				className={`max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all ${inkClass}`}
			>
				<AnsiText content={contentWithoutExitCode} masked={!secrets.revealed} />
			</pre>
		</div>
	);
}

/**
 * Upstream's block toggle (cb557955f `D`): a ghost icon button, Eye / EyeSlash, "Reveal N secrets" /
 * "Hide N secrets", pressed while revealed with the fill-control accent. Sized like {@link CopyButton}
 * and placed before it. Nothing renders when there is no secret.
 */
export function SecretRevealButton({
	count,
	revealed,
	onToggle,
	size,
}: Pick<SecretReveal, "count" | "revealed" | "onToggle"> &
{
	size?: "xs";
})
{
	if (count === 0) return null;
	const label = secretToggleLabel(count, revealed);
	return (
		<Tooltip content={label}>
			<button
				type="button"
				data-reveal-secrets=""
				aria-pressed={revealed}
				aria-label={label}
				onMouseDown={(event) =>
				{
					event.preventDefault();
				}}
				onClick={onToggle}
				className={`inline-flex ${size === "xs" ? "size-5" : "size-6"} shrink-0 items-center justify-center border-0 cursor-default select-none rounded-r4 hover:text-primary hover:bg-t2 transition-colors ${revealed ? "bg-fill-control text-primary" : "text-secondary"}`}
			>
				<Icon name={revealed ? "EyeSlash" : "Eye"} size={size === "xs" ? "xs" : "sm"} />
			</button>
		</Tooltip>
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
})
{
	const [expanded, setExpanded] = useState(false);
	const needsCap = lineCount > maxLines;

	if (!needsCap || expanded)
	{
		return <div>{children}</div>;
	}

	// ~1.4rem per line of text-xs leading-relaxed. Keep this tight so the
	// fade/button appear just below the cutoff.
	const maxHeight = `${maxLines * 1.4}rem`;

	return (
		<div>
			<div
				className="relative overflow-hidden"
				style={
				{
					maxHeight,
				}}
			>
				{children}
				<div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface-2 to-transparent pointer-events-none" />
			</div>
			<button
				type="button"
				onClick={() =>
				{
					setExpanded(true);
				}}
				className="mt-1 text-xs text-t6 hover:text-primary transition cursor-pointer"
			>
				Show all {lineCount} lines
			</button>
		</div>
	);
}

export function ChevronIcon({expanded, size = 14}: {expanded: boolean; size?: number})
{
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

const TOOL_CALL_DETAILS_REGION =
{
	role: "group",
	"aria-label": "Tool call details",
	tabIndex: 0,
} as const;
/** Upstream's `Z slot="details-input"`. */
const TOOL_CALL_INPUT_REGION =
{
	role: "group",
	"aria-label": "Tool call input",
	tabIndex: 0,
} as const;

function CopyIcon({size}: {size: number})
{
	return (
		<svg width={size} height={size} viewBox="0 0 12 12" fill="none" className="shrink-0">
			<path d={COPY_ICON_PATH} fill="currentColor" />
		</svg>
	);
}

function CheckIcon({size}: {size: number})
{
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
export function CopyButton({
	text,
	label = "Copy",
	size,
	onCopied,
	copiedLabel = label,
	resetMs = 1500,
}: {
	text: string;
	label?: string;
	size?: "xs";
	onCopied?: () => void;
	/** Label and tooltip while the Check icon shows, like upstream's "Copied". */
	copiedLabel?: string;
	resetMs?: number;
})
{
	const [copied, showCopied] = useTimedFlag(resetMs);

	const handleClick = useCallback(() =>
	{
		void navigator.clipboard.writeText(text);
		onCopied?.();
		showCopied();
	}, [text, onCopied, showCopied]);
	const currentLabel = copied ? copiedLabel : label;
	const iconSize = size === "xs" ? 12 : 16;

	return (
		<div
			className={`opacity-0 group-hover/body:opacity-100 focus-within:opacity-100 [transition:opacity_150ms_cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none ${TOUCH_REVEAL}`}
		>
			<Tooltip content={currentLabel}>
				<button
					type="button"
					aria-label={currentLabel}
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
export function CopyableBody({copyText, children}: {copyText: string; children: ReactNode})
{
	return (
		<div className="flex w-full">
			<div className="flex-1 min-w-0">{children}</div>
			<CopyButton text={copyText} />
		</div>
	);
}

/** Upstream's generic cds fold (`kT` with `text-footnote`): filled caret first, `text-secondary`, height-animated panel. */
export function CollapsibleSection({
	label,
	defaultOpen = false,
	children,
}: {
	label: ReactNode;
	defaultOpen?: boolean;
	children: ReactNode;
})
{
	return (
		<Collapsible.Root defaultOpen={defaultOpen}>
			<Collapsible.Trigger className="text-footnote">{label}</Collapsible.Trigger>
			<Collapsible.Panel>
				<div className="flow-root">
					<div className="mt-1">{children}</div>
				</div>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

export interface KeyValueParam
{
	key: string;
	value: string;
	/** When true, render the value as markdown instead of plain text. */
	markdown?: boolean;
}

const POLICY_REASON_CLASS = "text-primary whitespace-pre-wrap break-words select-text";

/**
 * Upstream's `Ox`: why an auto-mode-blocked call did not run, drawn where its
 * error output would go. Find skips the "Blocked by auto mode" prefix but
 * matches the reason. Upstream's empty retry slot only hosts its gated Retry
 * button, so it is left out. The reason is masked with spoofing characters revealed, as cf67ed396's
 * `u9(ME(reason))` (2026-11-10).
 */
export function PolicyDenialReason({call}: {call: PolicyDenial})
{
	return (
		<div className="flex flex-col items-start gap-xs font-sans text-body text-secondary">
			{call.blockedNoVerdict === "unanswered" ? (
				<bdi data-find-included="" className={POLICY_REASON_CLASS}>
					This did not run because auto mode’s check had no usable answer.
				</bdi>
			) : call.blockedReason === undefined ? (
				<div data-find-omitted="">Blocked by auto mode</div>
			) : (
				<div data-find-omitted="">
					Blocked by auto mode:{" "}
					<bdi data-find-included="" className={POLICY_REASON_CLASS}>
						{revealSpoofing(maskSecrets(call.blockedReason))}
					</bdi>
				</div>
			)}
		</div>
	);
}

/** Upstream's `Wv` (cb6930dae): the input keys whose string value is drawn as a path. */
const PATH_PARAM_KEYS = new Set(["file_path", "notebook_path"]);

/**
 * Upstream's `Xv` (cb6930dae, 2026-11-10): a path param as `u9(ME(path))`, a `cds-inline-code` chip until the
 * transcript's file refs confirm it, then a span inside the inline file link that opens it in the Files pane; a
 * blocked path keeps the chip inside the disabled-reason wrapper (`Ia` > `Jr`). Both are left-to-right on a
 * right-to-left page.
 */
function PathParamValue({path}: {path: string})
{
	const text = revealSpoofing(maskSecrets(path));
	const dir = pageIsRtl() ? "ltr" : undefined;
	return (
		<span className="min-w-0 break-words">
			<FileRefTarget
				path={path}
				wrapBlocked
				render={(refProps) =>
					refProps === null ? (
						<code className="cds-inline-code" dir={dir}>
							{text}
						</code>
					) : (
						<span {...refProps} className={FILE_LINK_CLASS}>
							<span dir={dir}>{text}</span>
						</span>
					)
				}
			/>
		</span>
	);
}

/**
 * Upstream's `Zv` (cb6930dae, 2026-11-10): any other plain value through the transcript's plain renderer (`eo`),
 * each secret cloaked behind its own reveal button and its URLs linked (`Iv`).
 */
function PlainParamValue({value}: {value: string})
{
	return (
		<span className="min-w-0 break-words">
			<PlainText renderPlain={linkifyToolText}>{value}</PlainText>
		</span>
	);
}

/**
 * The param rows: a muted mono key, a space, then the value (upstream's generic row). Every string value first
 * goes through upstream's `fm` (`paramValueText`); a path key's value is drawn as `Xv`, any other as `Zv`.
 */
function ParamRows({params}: {params: KeyValueParam[]})
{
	return (
		<div className="text-secondary flex flex-col gap-g2">
			{params.map((p) => (
				<div key={p.key} className="break-words">
					<span className="text-[12px]/[17px] font-mono opacity-70">{`${p.key}:`}</span>{" "}
					{p.markdown ? (
						<InlineMarkdown text={p.value} />
					) : PATH_PARAM_KEYS.has(p.key) ? (
						<PathParamValue path={paramValueText(p.value)} />
					) : (
						<PlainParamValue value={paramValueText(p.value)} />
					)}
				</div>
			))}
		</div>
	);
}

/** The bits of a tool call the output section reads. */
export type KeyValueCardCall = Pick<ClientToolCall, "name" | "outputShape" | "resultJson">;

/**
 * Upstream-style key-value card used by Grep, Glob, Agent, WebFetch,
 * WebSearch, and most non-file tools.
 *
 * Layout (upstream `Q` content column > `qx`):
 *   flex w-full
 *     flex-1 column (gap-sm)
 *       flex flex-col gap-sm
 *         "Input" section: the param rows in a max-h-40 "Tool call input" scroller (only with params)
 *         output section (`ToolOutputSection`), labelled "Output" and ruled only below an Input section
 *         children
 *     CopyButton (hover-visible; none for a paramless "No output")
 *
 * A failed call drops the column's `text-secondary` and renders the
 * result as a danger-red error message above the params in one scroller, matching upstream's error branch.
 */
export function KeyValueCard({
	params,
	result,
	call,
	copyText,
	isError,
	children,
}: {
	params: KeyValueParam[];
	result?: string | undefined;
	/** The call the result belongs to: its name gates markdown, and its output shape and full JSON shape the body. */
	call?: KeyValueCardCall | undefined;
	/** Overrides the default params + result copy payload. */
	copyText?: string | undefined;
	/** Renders the result as the failure message: danger red, above the params. */
	isError?: boolean | undefined;
	children?: ReactNode;
})
{
	// A blocked call's raw denial gives way to upstream's reason line (`kx`).
	const blocked = useContext(BlockedCallContext);
	const shownResult = blocked === null ? result : undefined;
	const failed = isError === true || blocked !== null;
	const outputShape = call?.outputShape;
	const resultJson = call?.resultJson;
	const allowMarkdown = call === undefined || allowsMarkdownBody(call.name);
	const awaitingResult = useContext(ToolAwaitingResultContext);
	const hasParams = params.length > 0;
	const output = useMemo(() =>
	{
		if (failed) return {};
		// Upstream `Hp`'s waiting status, shown (`Lv`) only while `xu` holds and only below an Input section (`ym`).
		if (!shownResult && outputShape === undefined)
			return awaitingResult && hasParams
				?
					{
						status: "waiting" as const,
					}
				: {};
		return resolveToolOutput(
			outputShape ??
				(shownResult
					?
						{
							body: shownResult,
						}
					: {}),
			{
				allowMarkdown,
				json: resultJson,
			},
		);
	}, [failed, outputShape, shownResult, allowMarkdown, resultJson, awaitingResult, hasParams]);

	if (failed)
	{
		const derivedCopyText = [
			...params.map((p) => `${p.key}: ${p.value}`),
			...(shownResult ? [shownResult] : []),
		].join("\n");
		return (
			<div className="flex w-full">
				<div
					className={`flex-1 min-w-0 flex flex-col gap-g4 text-body${isError ? "" : " text-secondary"} whitespace-pre-wrap break-words`}
				>
					<div {...TOOL_CALL_DETAILS_REGION} className="max-h-[400px] overflow-y-auto flex flex-col gap-g4">
						{blocked !== null && <PolicyDenialReason call={blocked} />}
						{isError && shownResult && <div className="text-danger-ink">{shownResult}</div>}
						{params.length > 0 && <ParamRows params={params} />}
						{children}
					</div>
				</div>
				<CopyButton text={copyText ?? derivedCopyText} />
			</div>
		);
	}

	// Upstream `ym`: a body with no input rows and no output, short of "No output", draws nothing.
	if (!hasParams && Object.keys(output).length === 0 && children === undefined) return null;
	// Upstream `q_` over `I_` and `J_`: the input lines, a blank line, then the output's copy text.
	const derivedCopyText = [
		params.map((p) => `${p.key}: ${p.value}`).join("\n"),
		toolOutputCopyText(output, shownResult),
	]
		.filter(Boolean)
		.join("\n\n");
	const copyButton =
		!hasParams && output.status === "empty" ? null : <CopyButton text={copyText ?? derivedCopyText} />;

	return (
		<div className="flex w-full">
			<div className="flex-1 min-w-0 flex flex-col justify-center gap-sm text-body text-secondary whitespace-pre-wrap break-words">
				<div className="flex flex-col gap-sm">
					{hasParams && (
						<LabelledSection label="Input">
							<div {...TOOL_CALL_INPUT_REGION} className="max-h-40 overflow-y-auto">
								<ParamRows params={params} />
							</div>
						</LabelledSection>
					)}
					<ToolOutputSection output={output} label={hasParams ? "Output" : undefined} />
					{children}
				</div>
			</div>
			{copyButton}
		</div>
	);
}

export function ToolMeta({children}: {children: ReactNode})
{
	return <span className="text-xs text-t6">{children}</span>;
}

export function DurationBadge({duration}: {duration: number})
{
	return <span className="text-xs text-t6 ml-1.5">{formatDuration(duration)}</span>;
}
