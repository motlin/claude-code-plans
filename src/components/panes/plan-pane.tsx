import {useQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {Circle, CircleCheck, CircleDot, ExternalLink} from "lucide-react";

import {planQueryOptions} from "../../lib/api/plans";
import {stripLeadingTitleHeading} from "../../lib/markdown-utils";
import {toMdSlug} from "../../lib/md-slug";
import type {PlanTodo, SessionPlanModel} from "../../lib/session-plan-model";
import {MarkdownView} from "../markdown-view";

/**
 * Upstream's Plan pane: the session's plan (its linked plan file, else its latest ExitPlanMode
 * plan text), then its checklist from TodoWrite or TaskCreate / TaskUpdate.
 */
export function SessionPlanPane({planFilename, model}: {planFilename: string | undefined; model: SessionPlanModel}) {
	return (
		<div data-testid="session-plan-pane" className="flex flex-col gap-3 px-4 py-3">
			{planFilename === undefined ? (
				model.content === null ? null : (
					<MarkdownView markdown={model.content} />
				)
			) : (
				<LinkedPlan planFilename={planFilename} />
			)}
			{model.todos.length > 0 && <PlanTodos todos={model.todos} />}
		</div>
	);
}

const TODO_ICONS = {completed: CircleCheck, in_progress: CircleDot} as const;

function PlanTodos({todos}: {todos: readonly PlanTodo[]}) {
	return (
		<ul aria-label="Todos" className="m-0 flex list-none flex-col gap-1.5 p-0">
			{todos.map((todo, index) => {
				const Icon =
					todo.status === "completed" || todo.status === "in_progress" ? TODO_ICONS[todo.status] : Circle;
				return (
					<li
						key={`${index}-${todo.content}`}
						data-todo-status={todo.status}
						className={`flex items-start gap-2 text-body ${todo.status === "completed" ? "text-ink-muted line-through" : "text-primary"}`}
					>
						<Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-secondary" />
						<span className="min-w-0">
							{todo.status === "in_progress" ? (todo.activeForm ?? todo.content) : todo.content}
						</span>
					</li>
				);
			})}
		</ul>
	);
}

/** The session's linked plan file, rendered as markdown with a link out to its plan page. */
function LinkedPlan({planFilename}: {planFilename: string}) {
	const slug = toMdSlug(planFilename);
	const {data: plan, isPending} = useQuery(planQueryOptions(slug));

	return (
		<>
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="min-w-0 truncate text-body font-semibold text-primary">{plan?.title ?? planFilename}</h2>
				<Link
					to="/plan/$filename"
					params={{filename: slug}}
					className="flex shrink-0 items-center gap-1 text-caption text-secondary underline-offset-2 hover:text-primary hover:underline"
				>
					Open plan
					<ExternalLink aria-hidden className="size-3" />
				</Link>
			</div>
			{plan ? (
				<MarkdownView markdown={stripLeadingTitleHeading(plan.markdown)} />
			) : (
				<p className="py-6 text-center text-body text-muted">
					{isPending ? "Loading plan…" : "This plan could not be found."}
				</p>
			)}
		</>
	);
}
