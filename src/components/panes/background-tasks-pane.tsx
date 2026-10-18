import {useQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {ChevronRight, Trash2} from "lucide-react";
import {useId, useState} from "react";

import {taskOutputQueryOptions} from "../../lib/api/task-output";
import {type BackgroundTask, type BackgroundTaskGroups, backgroundTaskMeta} from "../../lib/background-tasks";
import {HighlightedCommand} from "../tool-renderers/bash-renderer";
import {AnsiText} from "../tool-renderers/shared";
import {Tooltip} from "../ui/tooltip";
import {nonEmpty} from "../../lib/non-empty";

const EMPTY_COPY = "No background tasks in this session.";

const SECTION_HEADING = "text-caption font-medium text-secondary";
// Upstream's 20x20 ghost icon button for "Clear finished tasks".
const ICON_BUTTON =
	"flex size-5 cursor-pointer items-center justify-center rounded-r4 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary";
const REGION_CAP = "max-h-[200px] overflow-auto";
const OUTPUT_REGION = `${REGION_CAP} whitespace-pre-wrap break-all rounded-r6 bg-fill-control px-2 py-[5px] font-mono text-[12px]/[17px] text-secondary`;
const NOTE = "text-caption text-ink-muted";
const MISSING_COPY = "Output no longer available";

function taskTitle(task: BackgroundTask): string {
	return nonEmpty(task.description) ?? nonEmpty(task.command) ?? task.id;
}

function OutputRegion({title, output}: {title: string; output: string}) {
	return (
		<pre role="region" aria-label={`Output for ${title}`} className={OUTPUT_REGION}>
			<AnsiText content={output} />
		</pre>
	);
}

/** Output the transcript itself carries: TaskOutput reads, Monitor events, or an agent's result. */
function InlineOutput({task, title}: {task: BackgroundTask; title: string}) {
	if (task.output === null) return <p className={NOTE}>{task.summary ?? "No output recorded."}</p>;
	return <OutputRegion title={title} output={task.output} />;
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
}) {
	const {data, isError} = useQuery(taskOutputQueryOptions(sessionId, file, task.status === "running"));
	if (data === undefined) return isError ? <InlineOutput task={task} title={title} /> : null;
	if (data.status === "missing") {
		return task.output === null ? (
			<p className={NOTE}>{MISSING_COPY}</p>
		) : (
			<InlineOutput task={task} title={title} />
		);
	}
	return (
		<>
			{data.truncated && <p className={NOTE}>Showing the last 64 KB of output.</p>}
			<OutputRegion title={title} output={data.output} />
		</>
	);
}

/**
 * Upstream's task card: a 5% ink fill with no border, the title in muted 13px
 * with the chevron right after it, and the kind/status meta beneath. Expanding
 * reveals labelled, height-capped "Command for" and "Output for" regions.
 */
function BackgroundTaskCard({task, sessionId}: {task: BackgroundTask; sessionId: string | undefined}) {
	const [expanded, setExpanded] = useState(false);
	const detailsId = useId();
	const title = taskTitle(task);
	// Upstream renders a failed or stopped task's summary inline on touch, where there is no tooltip.
	const inlineSummary = task.status === "failed" || task.status === "stopped" ? nonEmpty(task.summary) : undefined;
	return (
		<li className="flex flex-col gap-g5 rounded-r6 bg-fill-ghost-hover p-2">
			<button
				type="button"
				data-background-task=""
				aria-label={`Background task: ${title}`}
				aria-expanded={expanded}
				aria-controls={detailsId}
				onClick={() => {
					setExpanded((value) => !value);
				}}
				className="flex w-full min-w-0 cursor-pointer flex-col text-left"
			>
				<span className="flex min-w-0 items-center gap-0.5 text-footnote text-ink-muted">
					<span className="truncate">{title}</span>
					<ChevronRight
						aria-hidden="true"
						className={`size-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
					/>
				</span>
				<span className="block text-caption/[15px] text-ink-muted">{backgroundTaskMeta(task)}</span>
				{inlineSummary !== undefined && (
					<span
						data-background-task-summary=""
						className="hidden [@media(pointer:coarse)]:block text-body text-secondary truncate min-w-0"
					>
						{inlineSummary}
					</span>
				)}
			</button>
			{expanded && (
				<div id={detailsId} className="flex flex-col gap-g5">
					{task.command !== null && (
						<div
							role="region"
							aria-label={`Command for ${title}`}
							className={`${REGION_CAP} rounded-r6 bg-surface-1 px-2 py-[5px] font-mono text-[12px]/[17px]`}
						>
							<HighlightedCommand command={task.command} />
						</div>
					)}
					{sessionId !== undefined && task.outputFile !== null && task.kind !== "agent" ? (
						<OutputFile sessionId={sessionId} file={task.outputFile} task={task} title={title} />
					) : (
						<InlineOutput task={task} title={title} />
					)}
				</div>
			)}
		</li>
	);
}

function TaskCards({tasks, sessionId}: {tasks: readonly BackgroundTask[]; sessionId: string | undefined}) {
	return (
		<ul className="flex flex-col gap-1.5">
			{tasks.map((task) => (
				<BackgroundTaskCard key={task.id} task={task} sessionId={sessionId} />
			))}
		</ul>
	);
}

/**
 * Upstream's Background tasks pane: "N running" then a collapsible
 * "Finished N ›" section (collapsed until clicked) whose trash button hides the rows it lists for this
 * view only (the transcript still has them).
 */
export function BackgroundTasksList({
	groups,
	subagents,
	sessionId,
}: {
	groups: BackgroundTaskGroups;
	/** The session whose task output files the cards may read. */
	sessionId?: string;
	/** The session's subagents, linked to their tree/Gantt page. */
	subagents?: {sessionId: string; count: number};
}) {
	const [finishedOpen, setFinishedOpen] = useState(false);
	const [clearedIds, setClearedIds] = useState<ReadonlySet<string>>(new Set());
	const finished = groups.finished.filter((task) => !clearedIds.has(task.id));
	const subagentCount = subagents?.count ?? 0;

	if (groups.running.length === 0 && finished.length === 0 && subagentCount === 0) {
		return <p className="px-3 py-6 text-center text-body text-muted">{EMPTY_COPY}</p>;
	}
	return (
		<div className="flex flex-col gap-4 px-3 py-2">
			{groups.running.length > 0 && (
				<section className="flex flex-col gap-1.5">
					<h3 className={SECTION_HEADING}>{groups.running.length} running</h3>
					<TaskCards tasks={groups.running} sessionId={sessionId} />
				</section>
			)}
			{finished.length > 0 && (
				<section className="flex flex-col gap-1.5">
					<div className="flex items-center justify-between gap-2">
						<h3 className="text-caption/[15px] text-ink-muted">
							<button
								type="button"
								aria-expanded={finishedOpen}
								onClick={() => {
									setFinishedOpen((open) => !open);
								}}
								className="flex cursor-pointer items-center gap-0.5 hover:text-primary"
							>
								Finished {finished.length}
								<ChevronRight
									aria-hidden="true"
									className={`size-3.5 transition-transform ${finishedOpen ? "rotate-90" : ""}`}
								/>
							</button>
						</h3>
						<Tooltip content="Clear finished tasks">
							<button
								type="button"
								aria-label="Clear finished tasks"
								onClick={() => {
									setClearedIds(new Set([...clearedIds, ...finished.map((task) => task.id)]));
								}}
								className={ICON_BUTTON}
							>
								<Trash2 aria-hidden="true" className="size-3.5" />
							</button>
						</Tooltip>
					</div>
					{finishedOpen && <TaskCards tasks={finished} sessionId={sessionId} />}
				</section>
			)}
			{subagents !== undefined && subagentCount > 0 && (
				<Link
					to="/session/$id/subagents"
					params={{id: subagents.sessionId}}
					className="self-start text-caption text-secondary underline-offset-2 hover:text-primary hover:underline"
				>
					{subagentCount} subagent{subagentCount === 1 ? "" : "s"}
				</Link>
			)}
		</div>
	);
}
