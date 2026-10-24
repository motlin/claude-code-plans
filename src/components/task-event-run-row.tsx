import React from "react";
import {backgroundNoticeSummary, NOTICE_NOUNS, type NoticeKind} from "../lib/background-notice-summary";
import type {BackgroundTaskStatus} from "../lib/background-tasks";
import {formatElapsed} from "../lib/working-marker";

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

/** Upstream's `qX` run text: the lead part, then ", " and each later part, failed parts in danger ink. */
function RunSummary({events}: {events: readonly TaskEvent[]}) {
	const [lead, ...rest] = backgroundNoticeSummary(events);
	return (
		<span className={`text-body ${INK} min-w-0 break-words`}>
			<span className={lead?.danger === true ? "text-danger-ink" : undefined}>{lead?.text}</span>
			{rest.map((part) => (
				<React.Fragment key={part.key}>
					<span>, </span>
					<span className={part.danger ? "whitespace-nowrap text-danger-ink" : "whitespace-nowrap"}>
						{part.text}
					</span>
				</React.Fragment>
			))}
		</span>
	);
}

/**
 * The content of upstream's settled task-event row (`XX`): one event as "Background command
 * completed · <description> · took 12s", two or more as one "N background commands completed,
 * 1 failed" summary that wraps at narrow widths.
 */
export function TaskEventRun({events}: {events: readonly TaskEvent[]}) {
	const [first] = events;
	if (first === undefined) return null;
	return (
		<div data-turn-status-marker="" className="ps-1 flex min-w-0 flex-col empty:hidden">
			<span className="flex min-w-0 items-center gap-1 max-w-full">
				{events.length === 1 ? <SingleEvent event={first} /> : <RunSummary events={events} />}
			</span>
		</div>
	);
}
