import {memo, useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";

import {assertNever} from "../../lib/assert-never";
import type {TerminalLine, TerminalToolLine} from "../../lib/terminal-lines";
import type {ChecklistItem} from "../../lib/task-checklist";
import {ExitTerminalViewButton} from "./terminal-hold";

/** Upstream `ae`, `Y`, `oe`: braille frames one per 100ms, the verb rotating every 4s. */
const SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const FRAME_MS = 100;
const VERB_MS = 4000;
/** Upstream's six spinner verbs are secret labels; these are the CLI's. */
const TERMINAL_SPINNER_VERBS = [
	"Thinking…",
	"Pondering…",
	"Cogitating…",
	"Brewing…",
	"Clauding…",
	"Computing…",
] as const;
/** Upstream `X`: within this many px of the bottom the view is pinned to new output. */
const PIN_SLOP_PX = 48;
/** Upstream `le`: an unpinned view this close to the top loads the earlier page. */
const NEAR_TOP_PX = 200;

export type LoadEarlierTrigger = "pill" | "retry_row" | "near_top";

export interface TerminalEarlierPages
{
	hasEarlier: boolean;
	isLoading: boolean;
	error: boolean;
	loadEarlier: (trigger: LoadEarlierTrigger) => void;
}

export interface TerminalTranscriptViewProps
{
	lines: readonly TerminalLine[];
	isWorking: boolean;
	/** The running turn's start (ms since epoch); the spinner counts from mount without it. */
	turnStartedAt?: number | undefined;
	/** The session waits on a permission prompt, answered in the normal view. */
	pendingApproval?: boolean | undefined;
	earlier?: TerminalEarlierPages | undefined;
	onPinnedChange?: ((pinned: boolean) => void) | undefined;
}

/**
 * Upstream `EpitaxyTerminalView` (`ue`, chunk cf6989767): a read-only, CLI-look transcript that
 * focuses itself so the browser's own keys scroll it, stays pinned to new output within 48px of the
 * bottom, and keeps its distance from the bottom when an earlier page is prepended.
 */
export function TerminalTranscriptView({
	lines,
	isWorking,
	turnStartedAt,
	pendingApproval = false,
	earlier,
	onPinnedChange,
}: TerminalTranscriptViewProps)
{
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() =>
	{
		ref.current?.focus(
			{
				preventScroll: true,
			},
		);
	}, []);
	const pinned = useRef(true);
	const setPinned = useCallback(
		(next: boolean) =>
		{
			pinned.current = next;
			onPinnedChange?.(next);
		},
		[onPinnedChange],
	);
	const distanceFromBottom = useRef(0);
	const firstId = useRef<string | undefined>(undefined);
	const unpin = useCallback(() =>
	{
		setPinned(false);
	}, [setPinned]);
	const onScroll = () =>
	{
		const element = ref.current;
		if (!element) return;
		const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < PIN_SLOP_PX;
		setPinned(atBottom);
		distanceFromBottom.current = element.scrollHeight - element.scrollTop;
		if (
			!atBottom &&
			element.scrollTop < NEAR_TOP_PX &&
			earlier !== undefined &&
			earlier.hasEarlier &&
			!earlier.isLoading &&
			!earlier.error
		)
			earlier.loadEarlier("near_top");
	};
	const headId = lines[0]?.id;
	useLayoutEffect(() =>
	{
		const element = ref.current;
		if (!element) return;
		const prepended = firstId.current !== headId;
		firstId.current = headId;
		if (pinned.current) element.scrollTop = element.scrollHeight;
		else if (prepended) element.scrollTop = element.scrollHeight - distanceFromBottom.current;
		distanceFromBottom.current = element.scrollHeight - element.scrollTop;
	}, [lines, headId, isWorking]);

	return (
		<div
			ref={ref}
			onScroll={onScroll}
			// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's terminal view is a Tab stop so the browser's own keys scroll it
			tabIndex={0}
			role="region"
			aria-label="Transcript"
			className="epitaxy-terminal-view draggable-none relative h-full overflow-y-auto overflow-x-hidden"
		>
			<div className="epitaxy-terminal-view-column">
				{earlier?.hasEarlier === true && (
					<button
						type="button"
						className="terminal-line terminal-dim terminal-expand"
						disabled={earlier.isLoading}
						onClick={() =>
						{
							earlier.loadEarlier(earlier.error ? "retry_row" : "pill");
						}}
					>
						{earlier.isLoading ? "Loading earlier messages…" : "Load earlier messages"}
					</button>
				)}
				{lines.map((line) => (
					<TerminalLineRow key={line.id} line={line} onUserExpand={unpin} />
				))}
				<TerminalSpinner isWorking={isWorking} startedAt={turnStartedAt} />
				{pendingApproval && (
					<div className="terminal-line">
						<span className="terminal-dot-running">⏺ </span>
						Claude needs your permission{" "}
						<ExitTerminalViewButton className="terminal-expand">
							Open the normal view
						</ExitTerminalViewButton>
					</div>
				)}
			</div>
		</div>
	);
}

/** Upstream `Q`: one terminal line. */
const TerminalLineRow = memo(function TerminalLineRow({
	line,
	onUserExpand,
}: {
	line: TerminalLine;
	onUserExpand: () => void;
})
{
	switch (line.kind)
	{
		case "prompt":
			return <div className="terminal-line terminal-prompt">{line.text}</div>;
		case "assistant":
			return <div className="terminal-line">{line.text}</div>;
		case "thinking":
			return <div className="terminal-line terminal-thinking">{line.text}</div>;
		case "error":
			return <div className="terminal-line terminal-error">{line.text}</div>;
		case "tool":
			return <TerminalToolRow line={line} onUserExpand={onUserExpand} />;
		case "todos":
			return <div className="terminal-line">{line.items.map(todoRow)}</div>;
		case "prompt_blocked":
			return <div className="terminal-line terminal-error">Prompt blocked: {line.reason}</div>;
		case "event":
			return (
				<div className="terminal-line terminal-dim">
					◈ {line.label.kind === "text" ? line.label.text : line.label.itemKind}
				</div>
			);
		case "chapter":
			return <div className="terminal-line terminal-chapter">── {line.title}</div>;
		default:
			return assertNever(line);
	}
});

/** Upstream `de`. */
function todoRow(item: ChecklistItem)
{
	const done = item.status === "completed";
	return (
		<div key={item.id} className={done ? "terminal-todo-done" : "terminal-todo-active"}>
			{done ? "☒ " : "☐ "}
			{item.content}
		</div>
	);
}

function dotClass(line: TerminalToolLine): string
{
	if (line.interrupted || line.rejected) return "terminal-dot-neutral";
	if (line.status === "error") return "terminal-dot-error";
	return line.status === "completed" ? "terminal-dot-completed" : "terminal-dot-running";
}

/** Upstream `E`: a ⏺ tool row with its ⎿ result, expandable once (it never collapses back). */
function TerminalToolRow({line, onUserExpand}: {line: TerminalToolLine; onUserExpand: () => void})
{
	const [expanded, setExpanded] = useState(false);
	const full = expanded ? line.resultFullText : undefined;
	let result: React.ReactNode = null;
	if (line.rejected) result = <div className="terminal-result">⎿ Rejected</div>;
	else if (line.interrupted) result = <div className="terminal-result">⎿ Interrupted</div>;
	else if (line.resultSummary !== undefined)
		result = (
			<div
				className={`terminal-result ${line.isError ? "terminal-error" : ""} ${full === undefined ? "" : "terminal-result-expanded"}`}
			>
				{full === undefined ? (
					<>
						⎿ {line.resultSummary}
						{line.resultFullText !== undefined && (
							<>
								{" "}
								<button
									type="button"
									className="terminal-expand"
									onClick={() =>
									{
										setExpanded(true);
										onUserExpand();
									}}
								>
									{line.resultExtraLineCount > 0
										? `+${line.resultExtraLineCount} lines`
										: "Show more"}
								</button>
							</>
						)}
					</>
				) : (
					<>
						<span className="terminal-result-glyph">⎿ </span>
						<div className="terminal-result-full">{full}</div>
					</>
				)}
			</div>
		);
	return (
		<div className="terminal-line">
			<span className={dotClass(line)}>⏺ </span>
			<span className="terminal-tool-name [font-variation-settings:normal]">{line.name}</span>
			{line.arg !== undefined && <span className="terminal-dim">({line.arg})</span>}
			{result}
		</div>
	);
}

/**
 * Upstream `se`: while working, a braille spinner, a rotating verb and the turn's elapsed seconds;
 * once a turn ends, a green ⏺ with its final seconds until unmount. Nothing before the first turn.
 */
export function TerminalSpinner({isWorking, startedAt}: {isWorking: boolean; startedAt?: number | undefined})
{
	const [elapsed, setElapsed] = useState<number | null>(null);
	const start = useRef<number | null>(null);
	useEffect(() =>
	{
		if (!isWorking)
		{
			start.current = null;
			return undefined;
		}
		const from = startedAt ?? start.current ?? Date.now();
		start.current = from;
		const timer = window.setInterval(() =>
		{
			setElapsed(Math.max(0, Date.now() - from));
		}, FRAME_MS);
		return () =>
		{
			window.clearInterval(timer);
		};
	}, [isWorking, startedAt]);
	if (isWorking)
	{
		const ms = elapsed ?? 0;
		return (
			<div className="terminal-line terminal-spinner">
				<span aria-hidden="true">{`${SPINNER_FRAMES[Math.floor(ms / FRAME_MS) % SPINNER_FRAMES.length]} `}</span>
				<span role="status">
					{TERMINAL_SPINNER_VERBS[Math.floor(ms / VERB_MS) % TERMINAL_SPINNER_VERBS.length]}
				</span>
				<span aria-hidden="true">{` ${Math.floor(ms / 1000)}s`}</span>
			</div>
		);
	}
	if (elapsed !== null)
		return (
			<div className="terminal-line terminal-done" role="status">
				⏺ {Math.max(0, Math.round(elapsed / 1000))}s
			</div>
		);
	return null;
}
