import {useQuery} from "@tanstack/react-query";
import {ListChecks, Loader2, MessageCircle} from "lucide-react";
import {type ReactNode, useRef} from "react";

import {planQueryOptions} from "../../lib/api/plans";
import {toMdSlug} from "../../lib/md-slug";
import type {PlanTodo, SessionPlanModel} from "../../lib/session-plan-model";
import {MarkdownView} from "../markdown-view";
import {TodoChecklist} from "../tool-renderers/task-checklist-renderer";
import {PlanCommentsLayer} from "./plan-comments-layer";

/**
 * Upstream's Plan pane: the session's plan (its linked plan file, else its latest ExitPlanMode or
 * plan-file Write text) as prose, then its checklist from TodoWrite or TaskCreate / TaskUpdate under
 * "Tasks"; with neither, upstream's "No plan yet" empty state. Plan text is headed by upstream's
 * comment hint, whose wording follows `commentsEnabled` (plan mode, or a plan waiting for approval).
 */
export function SessionPlanPane({
	sessionId,
	planFilename,
	model,
	commentsEnabled,
}: {
	sessionId: string;
	planFilename: string | undefined;
	model: SessionPlanModel;
	commentsEnabled: boolean;
}) {
	return planFilename === undefined ? (
		<PlanBody sessionId={sessionId} content={model.content} todos={model.todos} commentsEnabled={commentsEnabled} />
	) : (
		<LinkedPlanBody
			sessionId={sessionId}
			planFilename={planFilename}
			model={model}
			commentsEnabled={commentsEnabled}
		/>
	);
}

/** The linked plan file's markdown, falling back to the transcript's plan text when the file is gone. */
function LinkedPlanBody({
	sessionId,
	planFilename,
	model,
	commentsEnabled,
}: {
	sessionId: string;
	planFilename: string;
	model: SessionPlanModel;
	commentsEnabled: boolean;
}) {
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
	return (
		<PlanBody
			sessionId={sessionId}
			content={plan?.markdown ?? model.content}
			todos={model.todos}
			commentsEnabled={commentsEnabled}
		/>
	);
}

function PlanBody({
	sessionId,
	content,
	todos,
	commentsEnabled,
}: {
	sessionId: string;
	content: string | null;
	todos: readonly PlanTodo[];
	commentsEnabled: boolean;
}) {
	const commentsRef = useRef<HTMLDivElement>(null);
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
			data-plan-scroll=""
			className="h-full select-text overflow-y-auto [contain:strict] [scrollbar-gutter:stable_both-edges] p-3"
		>
			<div className="mx-auto max-w-[68ch]">
				{content !== null && <PlanCommentHint commentsEnabled={commentsEnabled} />}
				{content !== null && (
					<div ref={commentsRef}>
						<MarkdownView markdown={content} />
					</div>
				)}
				{todos.length > 0 && <PlanTasks todos={todos} />}
			</div>
			<PlanCommentsLayer rootRef={commentsRef} sessionId={sessionId} commentsEnabled={commentsEnabled} />
		</div>
	);
}

/** Upstream's caption row above the plan, telling the user whether they can comment on it right now. */
function PlanCommentHint({commentsEnabled}: {commentsEnabled: boolean}) {
	return (
		<div data-plan-hint className="mb-[var(--chat-item-gap)] flex items-center gap-1 text-caption text-ink-muted">
			<MessageCircle aria-hidden="true" className="size-3 shrink-0" />
			{commentsEnabled
				? "Select any text to leave a comment for Claude"
				: "You can comment on the plan in plan mode, or when Claude asks you to approve it."}
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
