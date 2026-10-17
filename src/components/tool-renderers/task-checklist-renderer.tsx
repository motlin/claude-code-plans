import {Check, CircleDashed} from "lucide-react";
import {useMemo} from "react";

import {taskChecklist} from "../../lib/task-checklist";
import {MarkdownInline} from "../markdown-view";
import type {ToolRendererProps} from "./types";

function StatusIcon({status}: {status: string}) {
	if (status === "completed") {
		return (
			<>
				<Check aria-hidden="true" className="size-4 text-primary" />
				<span className="sr-only">done</span>
			</>
		);
	}
	if (status === "in_progress") {
		return (
			<>
				<span aria-hidden="true" data-running-spinner="" className="running-spinner inline-flex size-4" />
				<span className="sr-only">in progress</span>
			</>
		);
	}
	return <CircleDashed aria-hidden="true" className="size-4 text-ink-muted" />;
}

/** One checklist row: a status (`pending`, `in_progress` or `completed`; anything else reads as pending) and its markdown. */
export interface TodoChecklistItem {
	id: string;
	content: string;
	status: string;
}

/**
 * Upstream's todo list (shared by the task tool bodies and the Plan pane): a
 * 16px status slot, then the item as inline markdown, struck through once
 * done. An in-progress item always spins.
 */
export function TodoChecklist({items}: {items: readonly TodoChecklistItem[]}) {
	return (
		<ul className="m-0 flex list-none flex-col gap-1.5 p-0 py-1 text-body select-text">
			{items.map((item) => (
				<li
					key={item.id}
					data-todo-status={item.status}
					className={`flex items-start gap-1 ${item.status === "completed" ? "line-through decoration-1 text-secondary" : "text-primary"}`}
				>
					<span className="flex h-[1lh] w-4 shrink-0 items-center justify-center">
						<StatusIcon status={item.status} />
					</span>
					<div className="min-w-0 flex-1">
						<MarkdownInline markdown={item.content} />
					</div>
				</li>
			))}
		</ul>
	);
}

/** Upstream's checklist body for every task tool (TodoWrite and the Task* family), listing the call's own todos. */
export function TaskChecklistRenderer({toolCall}: ToolRendererProps) {
	const items = useMemo(() => taskChecklist(toolCall.name, toolCall.input), [toolCall.name, toolCall.input]);
	if (items.length === 0) return null;
	return <TodoChecklist items={items} />;
}
