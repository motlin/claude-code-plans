import {useCallback, useLayoutEffect, useRef, useState, type MouseEvent} from "react";

import {prefillEmptyComposer, useHasComposer} from "../../lib/context-attach";
import {formatCount} from "../../lib/pluralize";
import {goalTurnsSummary, type SessionGoal} from "../../lib/session-goal";
import {useToast} from "../toast-context";
import {cdsButtonClass} from "../ui/cds-button";
import {Icon} from "../ui/icon";
import {Tooltip} from "../ui/tooltip";
import {ShowMoreButton} from "./rail-row";
import {useShowMore} from "./use-show-more";

/** Upstream `VI`'s second line: the turn count with the last check's reason, which has no `=0` branch. */
function goalStatusLine({iterations, lastReason}: SessionGoal): string
{
	return lastReason === undefined
		? goalTurnsSummary(iterations)
		: `${formatCount(iterations, "turn")} · last check: ${lastReason}`;
}

/** Upstream's refusal toasts (`NF`), by action and prefill result. */
const GOAL_PREFILL_REFUSALS =
{
	edit:
	{
		has_draft: "Can’t edit the goal while the message box has a draft. You can send or clear it first.",
		unavailable: "Can’t edit the goal until the message box is ready. Try again in a moment.",
	},
	clear:
	{
		has_draft: "Can’t clear the goal while the message box has a draft. You can send or clear the draft first.",
		unavailable: "Can’t clear the goal until the message box is ready. Try again in a moment.",
	},
} as const;

/** Upstream's actions wrapper: hidden until the card is hovered, holds keyboard focus, or on touch. */
const GOAL_ACTIONS_CLASS =
	"flex shrink-0 opacity-0 empty:hidden group-hover/railcard:opacity-100 group-has-[:focus-visible]/railcard:opacity-100 touch:opacity-100";

/** Upstream's ghost xs icon-only Button. */
const GOAL_ACTION_CLASS = `${cdsButtonClass("ghost", "xs")} aspect-square shrink-0 !px-0`;

/** Upstream `ME`: a click the keyboard raised (no pointer and no click count). */
function fromKeyboard(event: MouseEvent): boolean
{
	const native = event.nativeEvent;
	return (
		event.detail === 0 &&
		!("pointerType" in native && typeof native.pointerType === "string" && native.pointerType !== "")
	);
}

/** Upstream `NF`: Edit goal and Clear goal prefill the composer with `/goal …`, never sending. */
function GoalActions({sessionId, goal}: {sessionId: string; goal: SessionGoal})
{
	const toast = useToast();
	const openToast = useRef<AbortController | null>(null);
	const edit = goal.editText === undefined ? undefined : `/goal ${goal.editText}`;
	const prefill = (action: "edit" | "clear", event: MouseEvent) =>
	{
		const result =
			action === "edit"
				? prefillEmptyComposer(
						sessionId,
						edit ?? "",
						{
							replaceable: "/goal clear",
							ignoreStrayEnter: fromKeyboard(event),
						},
					)
				: prefillEmptyComposer(
						sessionId,
						"/goal clear",
						{
							replaceable: edit,
							ignoreStrayEnter: fromKeyboard(event),
						},
					);
		openToast.current?.abort();
		openToast.current = null;
		if (result === "inserted") return;
		const controller = new AbortController();
		openToast.current = controller;
		toast(
			{
				kind: "warning",
				uniqueKey: "goal-edit-blocked",
				signal: controller.signal,
				message: GOAL_PREFILL_REFUSALS[action][result],
			},
		);
	};
	return (
		<div className={GOAL_ACTIONS_CLASS}>
			{edit !== undefined && (
				<Tooltip content="Edit goal">
					<button
						type="button"
						data-size="xs"
						aria-label="Edit goal"
						className={GOAL_ACTION_CLASS}
						onClick={(event) =>
						{
							prefill("edit", event);
						}}
					>
						<Icon name="Edit" size="sm" />
					</button>
				</Tooltip>
			)}
			<Tooltip content="Clear goal">
				<button
					type="button"
					data-size="xs"
					aria-label="Clear goal"
					className={`${GOAL_ACTION_CLASS} -me-1`}
					onClick={(event) =>
					{
						prefill("clear", event);
					}}
				>
					<Icon name="Trash" size="sm" />
				</button>
			</Tooltip>
		</div>
	);
}

/**
 * Upstream `Wt` on the two lines: whether either is cut by its clamp, re-measured as they resize, once fonts load,
 * and whenever their text changes (upstream passes the content as a dependency). Frozen while expanded, so the
 * toggle stays even if the text later shortens.
 */
function useClampCut(frozen: boolean, texts: readonly [string, string])
{
	const lines = useRef<(HTMLElement | null)[]>([]);
	const [cut, setCut] = useState(false);
	const measure = useCallback(() =>
	{
		setCut(lines.current.some((line) => line !== null && line.scrollHeight > line.clientHeight));
	}, []);
	const [condition, status] = texts;
	useLayoutEffect(() =>
	{
		if (!frozen) measure();
	}, [frozen, measure, condition, status]);
	useLayoutEffect(() =>
	{
		if (frozen) return undefined;
		let live = true;
		const fonts = document.fonts as FontFaceSet | undefined;
		fonts?.ready
			.then(() =>
			{
				if (live) measure();
			})
			.catch(() => {});
		if (typeof ResizeObserver === "undefined")
			return () =>
			{
				live = false;
			};
		const observer = new ResizeObserver(measure);
		for (const line of lines.current) if (line !== null) observer.observe(line);
		return () =>
		{
			live = false;
			observer.disconnect();
		};
	}, [frozen, measure]);
	const lineRef = useCallback(
		(index: number) => (element: HTMLElement | null) =>
		{
			lines.current[index] = element;
		},
		[],
	);
	return {
		cut,
		lineRef,
	};
}

/** Upstream `VI`: the condition and status lines, clamped to two lines each, with a Show more toggle when cut. */
export function GoalBody({sessionId, goal}: {sessionId: string; goal: SessionGoal})
{
	const hasComposer = useHasComposer(sessionId);
	const showMore = useShowMore();
	const status = goalStatusLine(goal);
	const {cut, lineRef} = useClampCut(showMore.expanded, [goal.condition, status]);
	const clamp = showMore.expanded ? "" : " line-clamp-2";
	return (
		<>
			<div className="flex items-start gap-xs px-2 py-1">
				<div dir="auto" className="flex min-w-0 flex-1 flex-col gap-0.5 text-body [overflow-wrap:anywhere]">
					<bdi ref={lineRef(0)} className={`text-primary${clamp}`}>
						{goal.condition}
					</bdi>
					<bdi ref={lineRef(1)} className={`text-footnote text-muted-as-secondary${clamp}`}>
						{status}
					</bdi>
				</div>
				{hasComposer && <GoalActions sessionId={sessionId} goal={goal} />}
			</div>
			{(cut || showMore.expanded) && (
				<div>
					<ShowMoreButton state={showMore} />
				</div>
			)}
		</>
	);
}
