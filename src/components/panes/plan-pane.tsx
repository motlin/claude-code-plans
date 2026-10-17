import {useQuery} from "@tanstack/react-query";
import {ListChecks, Loader2} from "lucide-react";
import type {ReactNode} from "react";

import {planQueryOptions} from "../../lib/api/plans";
import {toMdSlug} from "../../lib/md-slug";
import type {PlanTodo, SessionPlanModel} from "../../lib/session-plan-model";
import {MarkdownView} from "../markdown-view";
import {TodoChecklist} from "../tool-renderers/task-checklist-renderer";

/**
 * Upstream's Plan pane: the session's plan (its linked plan file, else its latest ExitPlanMode or
 * plan-file Write text) as prose, then its checklist from TodoWrite or TaskCreate / TaskUpdate under
 * "Tasks"; with neither, upstream's "No plan yet" empty state.
 */
export function SessionPlanPane({planFilename, model}: {planFilename: string | undefined; model: SessionPlanModel}) {
	return planFilename === undefined ? (
		<PlanBody content={model.content} todos={model.todos} />
	) : (
		<LinkedPlanBody planFilename={planFilename} model={model} />
	);
}

/** The linked plan file's markdown, falling back to the transcript's plan text when the file is gone. */
function LinkedPlanBody({planFilename, model}: {planFilename: string; model: SessionPlanModel}) {
	const {data: plan, isPending} = useQuery(planQueryOptions(toMdSlug(planFilename)));
	if (isPending) {
		return (
			<div role="status" className="h-full">
				<PlanEmptyState
					icon={<Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-muted" />}
					title="Loading…"
				/>
			</div>
		);
	}
	return <PlanBody content={plan?.markdown ?? model.content} todos={model.todos} />;
}

function PlanBody({content, todos}: {content: string | null; todos: readonly PlanTodo[]}) {
	if (content === null && todos.length === 0) {
		return (
			<PlanEmptyState
				icon={<ListChecks aria-hidden="true" className="size-7 text-ink-muted" />}
				title="No plan yet"
				body="Claude writes the plan here as it explores. Keep chatting."
			/>
		);
	}
	return (
		<div
			data-testid="session-plan-pane"
			className="h-full select-text overflow-y-auto [contain:strict] [scrollbar-gutter:stable_both-edges] p-4"
		>
			<div className="mx-auto max-w-[68ch]">
				{content !== null && <MarkdownView markdown={content} />}
				{todos.length > 0 && <PlanTasks todos={todos} />}
			</div>
		</div>
	);
}

/** Upstream's "Tasks" section under the plan: a caption heading over the shared todo list (content, never activeForm). */
function PlanTasks({todos}: {todos: readonly PlanTodo[]}) {
	return (
		<section className="mt-4">
			<h2 className="mb-1.25 text-caption font-medium uppercase tracking-wide text-ink-muted">Tasks</h2>
			<TodoChecklist
				items={todos.map((todo, index) => ({id: `${index}`, content: todo.content, status: todo.status}))}
			/>
		</section>
	);
}

/** Upstream's centred pane empty state: a glyph, a title, and an optional secondary body. */
function PlanEmptyState({icon, title, body}: {icon: ReactNode; title: string; body?: string}) {
	return (
		<div
			data-testid="session-plan-pane"
			className="flex h-full flex-col items-center justify-center gap-3 px-4 py-4 text-center"
		>
			{icon}
			<div className="flex flex-col items-center gap-1">
				<p className="max-w-[36ch] text-pretty break-words text-body text-primary">{title}</p>
				{body !== undefined && (
					<p className="max-w-[36ch] text-pretty break-words text-footnote text-ink-muted">{body}</p>
				)}
			</div>
		</div>
	);
}
