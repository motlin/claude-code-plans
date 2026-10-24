import React from "react";
import {
	backgroundNoticeSummary,
	NOTICE_NOUNS,
	type NoticeKind,
	type NoticePart,
} from "../lib/background-notice-summary";
import type {BackgroundTaskStatus} from "../lib/background-tasks";
import {formatElapsed} from "../lib/working-marker";
import {useBackgroundTasksOpener} from "./background-tasks-opener-context";

/** One background task event a task-event row draws. */
export interface TaskEvent {
	taskId: string | null;
	status: BackgroundTaskStatus;
	kind: NoticeKind;
	description: string;
	durationMs: number | null;
	/** An agent's done phrase, which upstream draws in place of the "Background agent completed" label. */
	phrase?: string;
}

const INK = "text-secondary group-hover/tool:text-primary";

/** Upstream's `YX` settled single row: label, "·", description, then "· took {elapsed}". */
function SingleEvent({event}: {event: TaskEvent}) {
	const failed = event.status === "failed";
	return (
		<>
			{event.phrase === undefined ? (
				<>
					<span className={`text-body shrink-0 ${failed ? "text-danger-ink" : INK}`}>
						Background {NOTICE_NOUNS[event.kind][0]} {event.status}
					</span>
					{event.description !== "" && (
						<>
							<span className={`text-body ${INK} shrink-0`}>·</span>
							<span className={`text-body ${INK} min-w-0 truncate`}>{event.description}</span>
						</>
					)}
				</>
			) : (
				<span className={`text-body ${INK} min-w-0 truncate`}>{event.phrase}</span>
			)}
			{event.durationMs !== null && (
				<span className={`text-body ${INK} shrink-0 whitespace-nowrap tabular-nums`}>
					· took {formatElapsed(Math.round(event.durationMs / 1000))}
				</span>
			)}
		</>
	);
}

/** Upstream's `qX` parts: the lead part, then ", " and each later part, failed parts in danger ink. */
export function NoticeParts({parts}: {parts: readonly NoticePart[]}) {
	const [lead, ...rest] = parts;
	return (
		<>
			<span className={lead?.danger === true ? "text-danger-ink" : undefined}>{lead?.text}</span>
			{rest.map((part) => (
				<React.Fragment key={part.key}>
					<span>, </span>
					<span className={part.danger ? "whitespace-nowrap text-danger-ink" : "whitespace-nowrap"}>
						{part.text}
					</span>
				</React.Fragment>
			))}
		</>
	);
}

/** Upstream's run text, wrapping inside the row at narrow widths. */
function RunSummary({events}: {events: readonly TaskEvent[]}) {
	return (
		<span className={`text-body ${INK} min-w-0 break-words`}>
			<NoticeParts parts={backgroundNoticeSummary(events)} />
		</span>
	);
}

/**
 * The content of upstream's settled task-event row (`XX`): one event as "Background command
 * completed · <description> · took 12s", two or more as one "N background commands completed,
 * 1 failed" summary that wraps at narrow widths.
 */
export function TaskEventRun({events}: {events: readonly TaskEvent[]}) {
	const opener = useBackgroundTasksOpener();
	const [first] = events;
	if (first === undefined) return null;
	const content = (
		<span className="flex min-w-0 items-center gap-1 max-w-full">
			{events.length === 1 ? <SingleEvent event={first} /> : <RunSummary events={events} />}
		</span>
	);
	// Upstream's `JX`: a button opening Background tasks on the run's first task, with Finished
	// expanded since every local task event is settled; a plain div where no pane can host it.
	return (
		<div data-turn-status-marker="" className="ps-1 flex min-w-0 flex-col empty:hidden">
			{opener === null ? (
				<div className="flex flex-col gap-1 py-0 max-w-full items-start">{content}</div>
			) : (
				<button
					type="button"
					data-transcript-keeps-pin=""
					className="group/tool flex flex-col gap-1 py-0 max-w-full items-start text-start focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus rounded-sm"
					onClick={() => {
						opener.open(first.taskId === null ? {finished: true} : {taskId: first.taskId, finished: true});
					}}
				>
					{content}
				</button>
			)}
		</div>
	);
}
