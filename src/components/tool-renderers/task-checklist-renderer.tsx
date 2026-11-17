import {Check, CircleDashed} from "lucide-react";
import {type ReactNode, useMemo} from "react";

import {taskChecklist} from "../../lib/task-checklist";
import {MarkdownInline} from "../markdown-view";
import {Icon} from "../ui/icon";
import type {ToolRendererProps} from "./types";

function StatusIcon({status, spinnerClassName}: {status: string; spinnerClassName?: string | undefined})
{
	if (status === "completed")
	{
		return (
			<>
				<Check aria-hidden="true" className="size-4 text-primary" />
				<span className="sr-only select-none">done</span>
			</>
		);
	}
	if (status === "in_progress")
	{
		return (
			<>
				<span
					aria-hidden="true"
					data-running-spinner=""
					className={`running-spinner inline-flex size-4${spinnerClassName === undefined ? "" : ` ${spinnerClassName}`}`}
				/>
				<span className="sr-only select-none">in progress</span>
			</>
		);
	}
	return (
		<>
			<CircleDashed aria-hidden="true" className="size-4 text-ink-muted" />
			<span className="sr-only select-none">not done</span>
		</>
	);
}

/** Upstream `Td`'s mark slot: one markdown first line tall and 1rem wide. */
const MUTED_MARK_CLASS =
	"epitaxy-markdown-first-line shrink-0 w-[calc(1rem*var(--cds-rem-scale,1))] flex items-center justify-center";

/** Upstream `Td` with `mutedDone`: a filled check in secondary ink, a spinner or a still dots circle, a placeholder ring. */
function MutedStatusMark({
	status,
	spin,
	spinnerClassName,
}: {
	status: string;
	spin: boolean;
	spinnerClassName?: string | undefined;
})
{
	if (status === "completed")
	{
		return (
			<span data-find-omitted="" className={`${MUTED_MARK_CLASS} text-secondary`}>
				<Icon name="CheckCircleFilled" size="sm" aria-hidden />
				<span className="sr-only select-none">done</span>
			</span>
		);
	}
	if (status === "in_progress")
	{
		return (
			<span data-find-omitted="" className={`${MUTED_MARK_CLASS} text-primary`}>
				{spin ? (
					<StatusIcon status={status} spinnerClassName={spinnerClassName} />
				) : (
					<>
						<Icon name="DotsCircle" size="sm" aria-hidden />
						<span className="sr-only select-none">in progress</span>
					</>
				)}
			</span>
		);
	}
	return (
		<span data-find-omitted="" className={MUTED_MARK_CLASS}>
			<Icon name="Placeholder" size="sm" className="text-muted-as-secondary" aria-hidden />
			<span className="sr-only select-none">not done</span>
		</span>
	);
}

/** One checklist row: a status (`pending`, `in_progress` or `completed`; anything else reads as pending) and its markdown. */
export interface TodoChecklistItem
{
	id: string;
	content: string;
	status: string;
}

/** Upstream `AS`'s options beyond the default (struck-through) list. */
export interface TodoChecklistVariant
{
	/** Upstream `mutedDone`: done items keep their text, in secondary ink with a filled check (the turn plan box). */
	mutedDone?: boolean;
	/** Whether an in-progress item spins (upstream `spin`, default true); still, it shows a dots circle. */
	spin?: boolean;
	/** Extra classes on the spinner (upstream `spinnerClassName`). */
	spinnerClassName?: string;
	/** Upstream `unpadded`: no block padding around the list. */
	unpadded?: boolean;
	/** Upstream `detail`: extra content under an item's markdown. */
	detail?: (item: TodoChecklistItem) => ReactNode;
}

function MutedTodoChecklist({
	items,
	spin = true,
	spinnerClassName,
	unpadded = false,
	detail,
}:
{
	items: readonly TodoChecklistItem[];
} & TodoChecklistVariant)
{
	return (
		<ul
			role="list"
			className={`m-0 list-none p-0 flex flex-col text-body select-text gap-xs${unpadded ? "" : " py-xs"}`}
		>
			{items.map((item) => (
				<li
					key={item.id}
					data-todo-status={item.status}
					className={`flex items-start gap-1 ${item.status === "completed" ? "[--code-chip-ink:currentColor] text-secondary" : "text-primary"}`}
				>
					<MutedStatusMark status={item.status} spin={spin} spinnerClassName={spinnerClassName} />
					<div className="epitaxy-markdown-inherit-color min-w-0 flex-1">
						<MarkdownInline markdown={item.content} />
						{detail?.(item)}
					</div>
				</li>
			))}
		</ul>
	);
}

/**
 * Upstream's todo list (shared by the task tool bodies and the Plan pane): a
 * 16px status slot, then the item as inline markdown, struck through once
 * done. An in-progress item always spins. `mutedDone` draws the turn plan box's variant instead.
 */
export function TodoChecklist({
	items,
	...variant
}:
{
	items: readonly TodoChecklistItem[];
} & TodoChecklistVariant)
{
	if (variant.mutedDone === true) return <MutedTodoChecklist items={items} {...variant} />;
	return (
		<ul className="m-0 flex list-none flex-col gap-1.5 p-0 py-1 text-body select-text">
			{items.map((item) => (
				<li
					key={item.id}
					data-todo-status={item.status}
					className={`flex items-start gap-1 ${item.status === "completed" ? "line-through decoration-1 text-secondary" : "text-primary"}`}
				>
					<span data-find-omitted="" className="flex h-[1lh] w-4 shrink-0 items-center justify-center">
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
export function TaskChecklistRenderer({toolCall}: ToolRendererProps)
{
	const items = useMemo(() => taskChecklist(toolCall.name, toolCall.input), [toolCall.name, toolCall.input]);
	if (items.length === 0) return null;
	return <TodoChecklist items={items} />;
}
