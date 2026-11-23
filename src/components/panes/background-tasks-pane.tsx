import {useQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState} from "react";

import {type BackgroundTaskStop, useStoppingTaskIds} from "../../hooks/use-background-task-stop";
import {useNow} from "../../hooks/use-now";
import type {SessionWorkflowRun} from "../../lib/api/session-workflow-runs";
import {taskOutputQueryOptions} from "../../lib/api/task-output";
import
{
	type BackgroundTaskFocus,
	onBackgroundTaskFocusRequest,
	setFinishedExpanded,
	setTaskRowsOpen,
	takePendingBackgroundTaskFocus,
	useFinishedExpanded,
	useOpenTaskRows,
} from "../../lib/background-task-focus";
import
{
	type BackgroundTask,
	type BackgroundTaskGroups,
	type BackgroundTaskStatusText,
	backgroundTaskStatus,
} from "../../lib/background-tasks";
import {requestSubagentFocus} from "../../lib/subagent-focus-requests";
import {BackgroundTaskStopButton, STOPPING_LABEL} from "../background-task-stop-button";
import {CommandTokens} from "../tool-renderers/bash-renderer";
import {AnsiText} from "../tool-renderers/shared";
import {Icon} from "../ui/icon";
import {OverflowTooltip} from "../ui/overflow-tooltip";
import {nonEmpty} from "../../lib/non-empty";
import {type ArtifactWordLink, plainSegmentsText, taskDescriptionSegments} from "../../lib/task-description-segments";
import {TaskDescriptionLinks, TEXT_LINK} from "../task-event-run-row";
import {useOptionalPaneHost} from "./pane-host-context";
import {WorkflowTaskCard} from "./workflow-task-card";

const NO_WORKFLOW_RUNS: readonly SessionWorkflowRun[] = [];

/** Upstream `gap-xs` (6px, 8px comfortable): between a section's heading, rows and pieces. */
const GAP_XS = "gap-g5 comfortable:gap-g6";
/** Upstream `KL`'s heading. */
const SECTION_HEADING = "flex min-h-5 items-center text-footnote text-muted-as-secondary";
/** Upstream `IC`: a task's rounded fill-card piece. */
const PIECE = "relative flex min-w-0 flex-col rounded-t-[10px] rounded-b-[10px] bg-fill-card";
/** Upstream `RC.first`: the 44px row around the 36px opener. */
const ROW = "group/row relative flex h-11 min-w-0 items-center px-1.5 scroll-mb-24";
/** Upstream's list item around each task: the first one clears the sticky heading when scrolled to. */
const LIST_ITEM = "first:scroll-mt-7";
/** Upstream `zC` + `text-body`: the opener's box, at the row's `--task-step` indent. */
const OPENER =
	"flex h-9 w-full min-w-0 items-center gap-g5 rounded ps-[calc(var(--task-step,0)*1.25rem+0.375rem)] pe-1.5 text-start text-body comfortable:gap-g6";
/** Upstream `VC`: the opener's hover, focus and press paint, only when it is a button. */
const OPENER_ACTION =
	"cursor-pointer hover:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden active:bg-alpha-2 not-touch:group-has-[[data-task-stop]:hover]/row:bg-fill-ghost-hover";
/** Upstream `GC` + `ew`: the title line, medium weight in the Running section. */
const LABEL = "flex min-w-0 flex-1 items-center gap-1 text-start";
/** Upstream `WC` + `nw`: the disclosure caret's box. */
const CARET = "flex h-[1lh] w-4 shrink-0 items-center justify-center text-ink-muted";
/** Upstream's cds Collapsible caret motion: a 60ms turn, none under reduced motion. */
const CARET_ICON_MOTION = "transition-transform duration-fast motion-reduce:transition-none";
/** Upstream `gw`: the trailing status column. */
const STATUS = "shrink-0 text-end text-footnote text-muted-as-secondary tabular-nums";
/** Upstream `HC`: the Stop's slot over the row's end. */
const STOP_SLOT = "absolute inset-y-0 end-0 flex w-10 items-center justify-end pe-3";
/** Upstream `QC`: content under the row, indented one step past the row's own. */
const UNDER_ROW = "ps-[calc(var(--task-step,0)*1.25rem+0.75rem)]";
const DETAIL = `flex flex-col pe-p6 pb-p6 ${UNDER_ROW} select-text comfortable:pe-p8 comfortable:pb-p8 [&>div]:leading-5`;
/** Upstream `iL`: the detail's plain, height-capped pres. */
const TASK_PRE =
	"max-h-[200px] overflow-y-auto rounded-sm font-mono text-code leading-5 text-muted-as-secondary focus-visible:shadow-focus focus-visible:outline-hidden whitespace-pre-wrap break-all";
const NOTE = "text-footnote text-muted-as-secondary";
const SUMMARY = "text-footnote text-secondary whitespace-pre-wrap break-words";
const VIEW_TRANSCRIPT =
	"relative inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-r4 text-primary hide-focus-ring hover:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden";
const SHOW_MORE =
	"flex min-h-6.5 w-full min-w-0 cursor-pointer items-center rounded px-p5 text-start text-muted-as-secondary hover:text-primary focus-visible:shadow-focus focus-visible:outline-hidden";
/** Upstream `mv`: rows shown per page of a section's flat list. */
const LIST_PAGE = 100;
/** Upstream `aL`: how far above the bottom the user must scroll before output stops following its tail. */
const TAIL_SLACK = 16;
/** Tasks whose output the user scrolled up from, so a re-render doesn't yank them back to the tail. */
const scrolledUpTasks = new Map<string, boolean>();

function taskTypeOf(task: BackgroundTask): string
{
	return task.kind === "bash" ? "local_bash" : task.kind;
}

/**
 * Upstream's row title `F`: the description's plain text (link words kept, URLs dropped) when it
 * names an artifact, else the description, command or id; plus the first artifact link, which
 * upstream draws as a separate "View artifact" row.
 */
function taskTitle(task: BackgroundTask):
{
	title: string;
	artifact: ArtifactWordLink | undefined;
}
{
	const description = nonEmpty(task.description);
	const segments = description === undefined ? undefined : taskDescriptionSegments(description, taskTypeOf(task));
	if (segments === undefined)
	{
		return {
			title: description ?? nonEmpty(task.command) ?? task.id,
			artifact: undefined,
		};
	}
	return {
		title: plainSegmentsText(segments),
		artifact: segments.find((segment) => typeof segment !== "string"),
	};
}

/** Upstream `gL`: shell and monitor tasks open onto their output, others only when they carry a distinct summary. */
function isExpandable(task: BackgroundTask): boolean
{
	if (task.kind === "bash" || task.kind === "monitor") return true;
	const summary = nonEmpty(task.summary);
	return summary !== undefined && summary !== task.description;
}

function Caret({open}: {open: boolean})
{
	return (
		<span data-task-caret="" className={CARET}>
			<Icon
				name="CaretDown"
				size="sm"
				aria-hidden="true"
				className={open ? CARET_ICON_MOTION : `${CARET_ICON_MOTION} -rotate-90 page-rtl:rotate-90`}
			/>
		</span>
	);
}

/**
 * Upstream `aL`: an output pre that follows its tail as it grows, unless the user scrolled up more than 16px
 * or is selecting inside it. A finished task's trailing newline is trimmed.
 */
function OutputRegion({task, title, output}: {task: BackgroundTask; title: string; output: string})
{
	const ref = useRef<HTMLPreElement>(null);
	const shown = task.status === "running" ? output : output.replace(/\n$/, "");
	useLayoutEffect(() =>
	{
		const pre = ref.current;
		if (pre === null || scrolledUpTasks.get(task.id) === true) return;
		const selection = document.getSelection();
		if (selection !== null && !selection.isCollapsed && pre.contains(selection.anchorNode)) return;
		pre.scrollTop = pre.scrollHeight;
	}, [shown, task.id]);
	return (
		<pre
			ref={ref}
			// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's scrollable output region takes focus so it scrolls by keyboard
			tabIndex={0}
			role="region"
			aria-label={`Output for ${title}`}
			onScroll={(event) =>
			{
				const pre = event.currentTarget;
				scrolledUpTasks.set(task.id, pre.scrollHeight - pre.scrollTop - pre.clientHeight > TAIL_SLACK);
			}}
			className={TASK_PRE}
		>
			<AnsiText content={shown} />
		</pre>
	);
}

/** Output the transcript itself carries: TaskOutput reads, Monitor events, or an agent's result; else its summary or a note. */
function InlineOutput({task, title}: {task: BackgroundTask; title: string})
{
	if (task.output !== null) return <OutputRegion task={task} title={title} output={task.output} />;
	const summary = nonEmpty(task.summary);
	if (summary !== undefined && summary !== task.description)
	{
		const segments = taskDescriptionSegments(summary, taskTypeOf(task));
		return (
			<div className={SUMMARY}>
				{segments === undefined ? summary : <TaskDescriptionLinks segments={segments} />}
			</div>
		);
	}
	return <p className={NOTE}>{task.status === "running" ? "No output yet" : "No output captured."}</p>;
}

/**
 * The tail of the CLI's output file, fetched only while the card is open and
 * re-read while the task runs.
 */
function OutputFile({
	sessionId,
	file,
	task,
	title,
}: {
	sessionId: string;
	file: string;
	task: BackgroundTask;
	title: string;
})
{
	const {data, isError} = useQuery(taskOutputQueryOptions(sessionId, file, task.status === "running"));
	if (isError || data?.status === "missing")
	{
		return task.output === null ? (
			<p className={NOTE}>Output unavailable</p>
		) : (
			<InlineOutput task={task} title={title} />
		);
	}
	if (data === undefined) return <p className={NOTE}>Loading output…</p>;
	return (
		<>
			{data.truncated && <p className={NOTE}>Showing the last 64 KB of output.</p>}
			<OutputRegion task={task} title={title} output={data.output} />
		</>
	);
}

/** Upstream `oL`: the open row's command and output, one step in. */
function TaskDetail({task, title, sessionId}: {task: BackgroundTask; title: string; sessionId: string | undefined})
{
	return (
		<div
			className={DETAIL}
			style={
			{
				"--task-step": 1,
			}}
		>
			{task.command !== null && (
				<pre
					dir="ltr"
					// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's scrollable command region takes focus so it scrolls by keyboard
					tabIndex={0}
					role="region"
					aria-label={`Command for ${title}`}
					className={TASK_PRE}
				>
					<span aria-hidden="true" className="select-none">
						$&nbsp;
					</span>
					<CommandTokens command={task.command} />
				</pre>
			)}
			{sessionId !== undefined && task.outputFile !== null && task.kind !== "agent" ? (
				<OutputFile sessionId={sessionId} file={task.outputFile} task={task} title={title} />
			) : (
				<InlineOutput task={task} title={title} />
			)}
		</div>
	);
}

/** Upstream `ie`: a plain agent row's trailing caret button, opening the agent's transcript in the Subagents pane. */
function ViewTranscriptButton({task, title, sessionId}: {task: BackgroundTask; title: string; sessionId: string})
{
	const host = useOptionalPaneHost();
	if (host === null) return null;
	return (
		<button
			type="button"
			data-task-opener=""
			aria-label={`View transcript for ${title}`}
			onClick={() =>
			{
				requestSubagentFocus(sessionId, task.id);
				host.openPane("subagents");
			}}
			className={VIEW_TRANSCRIPT}
		>
			<Icon name="CaretRight" size="xs" />
		</button>
	);
}

/** Upstream `gw`: Failed, Stopped, or a duration hidden in a narrow pane; a running task's clock ticks each second. */
function useTaskStatus(task: BackgroundTask)
{
	const now = useNow(task.status === "running");
	return backgroundTaskStatus(task, now);
}

/**
 * Upstream's top-level task row `_L`: a rounded fill-card piece around a 44px row whose 36px opener holds the
 * caret, the title and the trailing status; an open row shows its detail inside the piece.
 */
function BackgroundTaskRow({
	task,
	sessionId,
	inRunning,
	expanded,
	onToggle,
	stop,
	stopping,
}: {
	task: BackgroundTask;
	sessionId: string | undefined;
	inRunning: boolean;
	expanded: boolean;
	onToggle: () => void;
	/** Upstream's `onStop`; null when the session can't take writes. */
	stop: BackgroundTaskStop | null;
	stopping: boolean;
})
{
	const titleId = useId();
	const {title, artifact} = taskTitle(task);
	const expandable = isExpandable(task);
	const taskStatus = useTaskStatus(task);
	const stoppable = task.status === "running" && stop !== null;
	// Upstream: a stopping row's status reads "Stopping…" in place of its elapsed time.
	const status: BackgroundTaskStatusText | null =
		stopping && task.status === "running"
			?
				{
					text: STOPPING_LABEL,
					tone: "plain",
					hideNarrow: false,
				}
			: taskStatus;
	// Upstream renders a failed or stopped task's summary inline on touch, where there is no tooltip.
	const inlineSummary = task.status === "failed" || task.status === "stopped" ? nonEmpty(task.summary) : undefined;
	const label = (
		<span
			className={`${LABEL} ${inRunning || task.status === "running" ? "text-body-medium" : "text-body"} text-primary`}
		>
			{expandable && <Caret open={expanded} />}
			<span id={titleId} data-task-title="" className="flex min-w-0">
				<OverflowTooltip className="min-w-0">{title}</OverflowTooltip>
			</span>
			{!expandable && task.kind === "agent" && sessionId !== undefined && (
				<ViewTranscriptButton task={task} title={title} sessionId={sessionId} />
			)}
		</span>
	);
	const statusColumn = status !== null && (
		<span className={STATUS}>
			<span className={status.tone === "danger" ? "text-danger" : status.hideNarrow ? "@max-[296px]:hidden" : ""}>
				{status.text}
			</span>
		</span>
	);
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<div data-task-piece="" className={PIECE}>
				<div
					data-task-line=""
					className={ROW}
					style={
					{
						"--task-step": 0,
					}}
				>
					{expandable ? (
						<button
							type="button"
							data-background-task=""
							data-task-opener=""
							aria-expanded={expanded}
							onClick={onToggle}
							className={`${OPENER}${stoppable ? " pe-9.5" : ""} ${OPENER_ACTION}`}
						>
							{label}
							{statusColumn}
						</button>
					) : (
						<div data-background-task="" className={`${OPENER}${stoppable ? " pe-9.5" : ""}`}>
							{label}
							{statusColumn}
						</div>
					)}
					{stoppable && (
						<span
							{...(expandable
								?
									{
										"data-task-stop": "",
									}
								: {})}
							className={STOP_SLOT}
						>
							<BackgroundTaskStopButton
								variant="secondary"
								busy={stopping}
								describedBy={titleId}
								onStop={() =>
								{
									stop.stop(task);
								}}
							/>
						</span>
					)}
				</div>
				{artifact !== undefined && (
					<div
						data-task-artifact-row=""
						className={`${UNDER_ROW} pe-md flex min-h-5 items-center pb-sm text-footnote`}
						style={
						{
							"--task-step": expandable ? 1 : 0,
						}}
					>
						<a href={artifact.href} target="_blank" rel="noreferrer" className={`shrink-0 ${TEXT_LINK}`}>
							View artifact
						</a>
					</div>
				)}
				{inlineSummary !== undefined && (
					<div
						data-background-task-summary=""
						className={`hidden truncate pe-p6 pb-p5 ${UNDER_ROW} text-body text-secondary [@media(pointer:coarse)]:block`}
					>
						{inlineSummary}
					</div>
				)}
				{expandable && expanded && <TaskDetail task={task} title={title} sessionId={sessionId} />}
			</div>
		</div>
	);
}

/** The run a workflow task launched: by its harness task id, else by any of the run's launches. */
function runOf(task: BackgroundTask, runs: readonly SessionWorkflowRun[]): SessionWorkflowRun | undefined
{
	return (
		runs.find((run) => run.taskId === task.id) ??
		(task.toolUseId === null ? undefined : runs.find((run) => run.toolUseIds.includes(task.toolUseId ?? "")))
	);
}

/**
 * Upstream `mv`: the first page of rows plus any later row that must stay (running, focus-requested, keyboard-focused
 * or open), in order.
 */
function visibleTasks(
	tasks: readonly BackgroundTask[],
	limit: number,
	keep: (task: BackgroundTask) => boolean,
): readonly BackgroundTask[]
{
	return tasks.filter((task, index) => index < limit || keep(task));
}

/** Upstream's section body: each task in a `display: contents` wrapper, then the Show more / Show less toggle. */
function TaskCards({
	tasks,
	sessionId,
	inRunning,
	openRows,
	setRowOpen,
	workflowRuns,
	keepIds,
	stop,
	stoppingIds,
}: {
	tasks: readonly BackgroundTask[];
	sessionId: string | undefined;
	inRunning: boolean;
	openRows: ReadonlyMap<string, boolean>;
	setRowOpen: (taskId: string, open: boolean) => void;
	workflowRuns: readonly SessionWorkflowRun[];
	/** Rows kept past the limit besides running and open ones: the focus target and the keyboard-focused row. */
	keepIds: ReadonlySet<string>;
	stop: BackgroundTaskStop | null;
	stoppingIds: ReadonlySet<string>;
})
{
	const listRef = useRef<HTMLDivElement>(null);
	const [limit, setLimit] = useState(LIST_PAGE);
	const [revealFrom, setRevealFrom] = useState<string | null>(null);
	const shown = visibleTasks(
		tasks,
		limit,
		(task) => task.status === "running" || openRows.get(task.id) === true || keepIds.has(task.id),
	);

	useEffect(() =>
	{
		if (revealFrom === null) return;
		listRef.current
			?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(revealFrom)}"] [data-task-opener]`)
			?.focus();
		setRevealFrom(null);
	}, [revealFrom]);

	const allShown = shown.length === tasks.length;
	return (
		<div ref={listRef} data-task-list="" className={`@container flex flex-col ${GAP_XS}`}>
			<div role="list" className={`@container flex flex-col ${GAP_XS}`}>
				{shown.map((task) =>
				{
					if (task.kind === "workflow")
					{
						return (
							<div key={task.id} role="listitem" className={LIST_ITEM}>
								<div data-task-id={task.id} className="contents">
									<WorkflowTaskCard task={task} run={runOf(task, workflowRuns)} />
								</div>
							</div>
						);
					}
					const expanded = openRows.get(task.id) === true;
					return (
						<div key={task.id} role="listitem" className={LIST_ITEM}>
							<div data-task-id={task.id} className="contents">
								<BackgroundTaskRow
									task={task}
									sessionId={sessionId}
									inRunning={inRunning}
									expanded={expanded}
									onToggle={() =>
									{
										setRowOpen(task.id, !expanded);
									}}
									stop={stop}
									stopping={stoppingIds.has(task.id)}
								/>
							</div>
						</div>
					);
				})}
			</div>
			{tasks.length > LIST_PAGE && (
				<button
					// A fresh button per label, like upstream's Show more / Show less pair.
					key={allShown ? "less" : "more"}
					type="button"
					aria-expanded={allShown}
					onKeyDown={(event) =>
					{
						if (event.key === "Enter" && event.repeat) event.preventDefault();
					}}
					onClick={() =>
					{
						if (allShown)
						{
							setLimit(LIST_PAGE);
							return;
						}
						const firstHidden = tasks.find((task, index) => index >= limit && !shown.includes(task));
						setLimit(limit + LIST_PAGE);
						if (firstHidden !== undefined) setRevealFrom(firstHidden.id);
					}}
					className={SHOW_MORE}
				>
					<span className="min-w-0 truncate">{allShown ? "Show less" : "Show more"}</span>
				</button>
			)}
		</div>
	);
}

/**
 * Finished-open and per-row open state: the session's in-memory store (kept
 * across pane remounts until reload, like upstream), or component state when
 * there is no session.
 */
function usePaneViewState(sessionId: string | undefined)
{
	const sessionFinished = useFinishedExpanded(sessionId);
	const sessionRows = useOpenTaskRows(sessionId);
	const [localFinished, setLocalFinished] = useState<boolean | undefined>(undefined);
	const [localRows, setLocalRows] = useState<ReadonlyMap<string, boolean>>(new Map());
	if (sessionId === undefined)
	{
		return {
			finishedExpanded: localFinished,
			setFinished: setLocalFinished,
			openRows: localRows,
			setRowOpen: (taskId: string, open: boolean) =>
			{
				setLocalRows((rows) => new Map(rows).set(taskId, open));
			},
		};
	}
	return {
		finishedExpanded: sessionFinished,
		setFinished: (open: boolean) =>
		{
			setFinishedExpanded(sessionId, open);
		},
		openRows: sessionRows,
		setRowOpen: (taskId: string, open: boolean) =>
		{
			setTaskRowsOpen(sessionId, [taskId], open);
		},
	};
}

/**
 * Upstream's tasks-pane focus: a requested task (and, when finished, the
 * Finished section) opens, then after the commit, in a frame, the row scrolls
 * to the top of the pane. Keyboard focus stays where it was.
 */
function useTaskFocusRequests(
	sessionId: string | undefined,
	finished: readonly BackgroundTask[],
	rootRef: RefObject<HTMLDivElement | null>,
)
{
	const finishedRef = useRef(finished);
	finishedRef.current = finished;
	const [scrollTarget, setScrollTarget] = useState<
	{
		taskId: string;
	} | null>(null);

	useEffect(() =>
	{
		if (sessionId === undefined) return undefined;
		const handle = ({taskId}: BackgroundTaskFocus) =>
		{
			if (taskId === undefined) return;
			setTaskRowsOpen(sessionId, [taskId], true);
			if (finishedRef.current.some((task) => task.id === taskId)) setFinishedExpanded(sessionId, true);
			setScrollTarget(
				{
					taskId,
				},
			);
		};
		const pending = takePendingBackgroundTaskFocus(sessionId);
		if (pending !== null) handle(pending);
		return onBackgroundTaskFocusRequest(sessionId, handle);
	}, [sessionId]);

	useEffect(() =>
	{
		if (scrollTarget === null) return undefined;
		const frame = requestAnimationFrame(() =>
		{
			// The wrapper is `display: contents`, so upstream scrolls its row.
			rootRef.current
				?.querySelector(`[data-task-id="${CSS.escape(scrollTarget.taskId)}"]`)
				?.firstElementChild?.scrollIntoView(
					{
						block: "start",
					},
				);
		});
		return () =>
		{
			cancelAnimationFrame(frame);
		};
	}, [scrollTarget, rootRef]);
	return scrollTarget?.taskId;
}

/** Upstream `KL`'s heading: "Running" and the muted count. */
function RunningHeading({count}: {count: number})
{
	return (
		<div className="flex">
			<h3 className={SECTION_HEADING}>
				<span className="flex items-center gap-1">
					<span>Running</span>
					<span className="text-ink-muted">{count}</span>
				</span>
			</h3>
		</div>
	);
}

/** Upstream `Yd`: the pane placeholder, centred in the pane. */
/**
 * Upstream's pane body: a focusable group that scrolls with a gutter on one edge only, led by the polite status its
 * loop and server stops announce through.
 */
function PaneScroller({children}: {children: ReactNode})
{
	return (
		<div
			tabIndex={-1}
			role="group"
			className="h-full overflow-y-auto scroll-py-2.5 outline-none [scrollbar-gutter:stable]"
		>
			<span className="sr-only" role="status" />
			{children}
		</div>
	);
}

function EmptyPlaceholder()
{
	return (
		<div className="grid h-full min-h-0 grid-cols-1 grid-rows-1">
			<div className="col-start-1 row-start-1 flex flex-col overflow-y-auto px-p8 text-center before:min-h-2 before:flex-[1_1_12px] before:content-[''] after:min-h-2 after:flex-[1_1_12px] after:content-['']">
				<div className="flex flex-col items-center gap-p6">
					<Icon name="AgentsSimple" size="lg" className="!size-7 text-muted-as-secondary" />
					<p className="max-w-[36ch] text-pretty break-words text-body text-primary">
						Background tasks appear here
					</p>
				</div>
			</div>
		</div>
	);
}

/** The task row holding keyboard focus, which the list limit keeps shown. */
function useFocusedTaskId(rootRef: RefObject<HTMLDivElement | null>): string | undefined
{
	const [focused, setFocused] = useState<string | undefined>(undefined);
	useEffect(() =>
	{
		const root = rootRef.current;
		if (root === null) return undefined;
		const onFocus = (event: FocusEvent) =>
		{
			const row = event.target instanceof Element ? event.target.closest("[data-task-id]") : null;
			setFocused(row?.getAttribute("data-task-id") ?? undefined);
		};
		root.addEventListener("focusin", onFocus);
		return () =>
		{
			root.removeEventListener("focusin", onFocus);
		};
	});
	return focused;
}

/**
 * Upstream's Background tasks pane: a "Running" section, then a collapsible "Finished" one (open by default when
 * nothing runs). The groups arrive without the tasks the header's "Clear finished tasks" dismissed.
 */
export function BackgroundTasksList({
	groups,
	subagents,
	sessionId,
	workflowRuns = NO_WORKFLOW_RUNS,
	stop = null,
}: {
	groups: BackgroundTaskGroups;
	/** The session's workflow runs, whose progress the workflow cards draw. */
	workflowRuns?: readonly SessionWorkflowRun[];
	/** The session whose task output files the cards may read. */
	sessionId?: string;
	/** The session's subagents, linked to their tree/Gantt page. */
	subagents?:
	{
		sessionId: string;
		count: number;
	};
	/** Per-row Stop through the session's live CLI; null (no Stop) when it can't take writes. */
	stop?: BackgroundTaskStop | null;
})
{
	const stoppingIds = useStoppingTaskIds(sessionId ?? "");
	const rowStop = sessionId === undefined ? null : stop;
	const finished = groups.finished;
	const subagentCount = subagents?.count ?? 0;
	const {finishedExpanded, setFinished, openRows, setRowOpen} = usePaneViewState(sessionId);
	// Upstream: the section's own state, else open when nothing runs or while it holds an open row.
	const finishedOpen =
		finishedExpanded ?? (groups.running.length === 0 || finished.some((task) => openRows.get(task.id) === true));
	const rootRef = useRef<HTMLDivElement>(null);
	const focusTarget = useTaskFocusRequests(sessionId, finished, rootRef);
	const focusedId = useFocusedTaskId(rootRef);
	const keepIds = new Set([focusTarget, focusedId].filter((id) => id !== undefined));

	if (groups.running.length === 0 && finished.length === 0 && subagentCount === 0)
		return (
			<PaneScroller>
				<EmptyPlaceholder />
			</PaneScroller>
		);
	return (
		<PaneScroller>
			<div
				ref={rootRef}
				className="flex min-w-[220px] flex-col gap-8 px-p6 py-p6 comfortable:px-p8 comfortable:py-p8"
			>
				{groups.running.length > 0 && (
					<section className={`flex flex-col ${GAP_XS}`}>
						<RunningHeading count={groups.running.length} />
						<TaskCards
							tasks={groups.running}
							sessionId={sessionId}
							inRunning
							openRows={openRows}
							setRowOpen={setRowOpen}
							workflowRuns={workflowRuns}
							keepIds={keepIds}
							stop={rowStop}
							stoppingIds={stoppingIds}
						/>
					</section>
				)}
				{finished.length > 0 && (
					<section className={`flex flex-col ${GAP_XS}`}>
						<h3 className={SECTION_HEADING}>
							<button
								type="button"
								aria-expanded={finishedOpen}
								onClick={() =>
								{
									setFinished(!finishedOpen);
								}}
								className="-mx-1.5 flex min-h-5 cursor-pointer items-center gap-1 rounded px-1.5 hide-focus-ring hover:text-secondary-control focus-visible:shadow-focus focus-visible:outline-hidden"
							>
								<Caret open={finishedOpen} />
								<span>Finished</span>
								<span className="text-ink-muted">{finished.length}</span>
							</button>
						</h3>
						{finishedOpen && (
							// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream's capture latch: a press on a control inside keeps the section open
							<div
								className="contents"
								onClickCapture={(event) =>
								{
									if (event.target instanceof Element && event.target.closest("button, a") !== null)
										setFinished(true);
								}}
							>
								<TaskCards
									tasks={finished}
									sessionId={sessionId}
									inRunning={false}
									openRows={openRows}
									setRowOpen={setRowOpen}
									workflowRuns={workflowRuns}
									keepIds={keepIds}
									stop={rowStop}
									stoppingIds={stoppingIds}
								/>
							</div>
						)}
					</section>
				)}
				{subagents !== undefined && subagentCount > 0 && (
					<Link
						to="/session/$id/subagents"
						params={
						{
							id: subagents.sessionId,
						}}
						className="self-start text-caption text-secondary underline-offset-2 hover:text-primary hover:underline"
					>
						{subagentCount} subagent{subagentCount === 1 ? "" : "s"}
					</Link>
				)}
			</div>
		</PaneScroller>
	);
}
