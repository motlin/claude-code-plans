/*
 * Upstream's live todo plan box (`EpitaxyTurnBox` `UF`, shell `zF`, plan body `KF`, exit hold `WF`; c9bd7af9c):
 * a ringed card in the transcript tail holding the session's checklist while a turn works on it. Local sessions
 * take upstream's task-list path, so the wrap-up next step (`[data-turn-next]`) and side-session chips are absent.
 */
import {type ReactNode, useEffect, useMemo, useRef} from "react";

import type {PlanTodo} from "../lib/session-plan-model";
import {planWindow} from "../lib/turn-plan-box";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import {TodoChecklist, type TodoChecklistItem} from "./tool-renderers/task-checklist-renderer";
import {cdsButtonClass} from "./ui/cds-button";

/** Upstream `Wx`: the plan box's spinner turns once every 1.6s. */
const PLAN_SPINNER_CLASS = "motion-safe:[&>span:last-child]:animate-[spin_1.6s_linear_infinite]";

/** Upstream `LF`: sessions whose box has been shown, so a remount finishes the fade instead of replaying it. */
const shownSessions = new Set<string>();

/** Upstream `RF`: finish the element's finite CSS animations. */
function finishAnimations(element: HTMLElement | null)
{
	if (element === null || typeof element.getAnimations !== "function") return;
	for (const animation of element.getAnimations(
		{
			subtree: true,
		},
	))
	{
		const end = animation.effect?.getComputedTiming().endTime ?? Number.POSITIVE_INFINITY;
		if (Number.isFinite(Number(end))) animation.finish();
	}
}

/** Upstream `zF`: the ringed card, hidden while it holds no visible item, button or caption. */
function TurnBoxShell({
	sessionId,
	isResponding,
	children,
}: {
	sessionId: string;
	isResponding: boolean;
	children: ReactNode;
})
{
	const ref = useRef<HTMLDivElement>(null);
	const respondedSinceMount = useRef(false);
	useEffect(() =>
	{
		if (isResponding) respondedSinceMount.current = true;
	}, [isResponding]);
	useEffect(() =>
	{
		const element = ref.current;
		if (element === null || typeof ResizeObserver === "undefined") return undefined;
		const seen = shownSessions.has(sessionId);
		let shown = false;
		const observer = new ResizeObserver((entries) =>
		{
			const visible = entries.some((entry) => entry.contentRect.height > 0);
			if (visible && !shown && seen && !respondedSinceMount.current) finishAnimations(element);
			if (visible) shownSessions.add(sessionId);
			shown = visible;
		});
		observer.observe(element);
		return () =>
		{
			observer.disconnect();
		};
	}, [sessionId]);
	return (
		<div
			ref={ref}
			data-turn-box=""
			className="mt-[var(--chat-turn-gap,15px)] epitaxy-root motion-safe:animate-fade-in text-body text-primary break-words overflow-clip rounded-card shadow-[inset_0_0_0_1px_var(--card-outline)] [&:not(:has(li:not([hidden]_li),button:not([hidden]_button):not([data-turn-dismiss]_button),p:not([hidden]_p)))]:hidden"
		>
			{children}
		</div>
	);
}

/** Upstream `YF`: the running background tasks, as a ghost button that opens their pane. */
function RunningTasksDetail({count}: {count: number})
{
	const host = useOptionalPaneHost();
	const label = count === 1 ? "1 running task" : `${count} running tasks`;
	if (host === null) return <span className="mt-0.5 flex items-center text-caption text-secondary">{label}</span>;
	return (
		<button
			type="button"
			data-size="xs"
			onClick={() =>
			{
				host.openPane("background-tasks");
			}}
			className={`${cdsButtonClass("ghost", "xs")} mt-0.5 max-w-full text-secondary`}
		>
			{label}
		</button>
	);
}

function earlierSteps(count: number): string
{
	return count === 1 ? "1 earlier step" : `${count} earlier steps`;
}

/** Upstream `KF`: the windowed checklist with its stale, earlier and more-to-go captions. */
function PlanBody({
	todos,
	stale,
	working,
	parked,
	agentsRunning,
}: {
	todos: readonly PlanTodo[];
	stale: false | "prompt";
	working: boolean;
	parked: boolean;
	agentsRunning: number;
})
{
	const window = useMemo(() => planWindow(todos), [todos]);
	const items = useMemo(
		(): TodoChecklistItem[] =>
			window.visible.map((todo, index) => (
			{
				id: String(window.hiddenBefore + index),
				content: todo.content,
				status: todo.status,
			})),
		[window],
	);
	const detailId =
		agentsRunning > 0 ? (items.find((item) => item.status === "in_progress") ?? items.at(-1))?.id : undefined;
	return (
		<div className="flex flex-col gap-1 p-4">
			{stale === "prompt" && (
				<p className="text-caption text-muted-as-secondary select-text">Plan from before your last message</p>
			)}
			{window.hiddenBefore > 0 && (
				<p className="ps-6 text-caption text-muted-as-secondary">{earlierSteps(window.hiddenBefore)}</p>
			)}
			<TodoChecklist
				items={items}
				mutedDone
				spin={stale === false && working && !parked}
				spinnerClassName={PLAN_SPINNER_CLASS}
				unpadded
				detail={(item) => (item.id === detailId ? <RunningTasksDetail count={agentsRunning} /> : null)}
			/>
			{window.openAfter > 0 && (
				<p className="ps-6 text-caption text-muted-as-secondary">{`${window.openAfter} more to go`}</p>
			)}
		</div>
	);
}

/** Upstream `UF` for a local session: the shell around the plan wrapper (`inert` and exiting while closing). */
export function TurnPlanBoxCard({
	sessionId,
	todos,
	closing,
	stale,
	working,
	parked,
	agentsRunning,
	isResponding = working,
}: {
	sessionId: string;
	todos: readonly PlanTodo[];
	closing: boolean;
	stale: false | "prompt";
	working: boolean;
	/** Upstream `parked`: compacting stops the spinner. */
	parked: boolean;
	/** Background calls launched this turn; shown only once the turn stops working. */
	agentsRunning: number;
	isResponding?: boolean;
})
{
	return (
		<TurnBoxShell sessionId={sessionId} isResponding={isResponding}>
			<div
				inert={closing}
				className={`${closing ? "epitaxy-plan-exit grid grid-rows-[1fr] overflow-clip" : ""} [&:has(+[data-turn-next]_button:not([hidden]_button):not([data-turn-dismiss]_button))]:hidden [&:has(+[data-turn-next]_p:not([hidden]_p))]:hidden`}
			>
				<div className="min-h-0 min-w-0">
					<PlanBody
						todos={todos}
						stale={stale}
						working={working}
						parked={parked}
						agentsRunning={working ? 0 : agentsRunning}
					/>
				</div>
			</div>
		</TurnBoxShell>
	);
}
