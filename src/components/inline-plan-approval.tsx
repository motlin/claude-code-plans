import {useCallback, useEffect, useRef, useState} from "react";
import {useReadGate} from "../hooks/use-read-gate";
import {ApprovalCardShell} from "./approval-card";
import {OpenPlanLink} from "./open-plan-link";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import {PlanApprovalCard} from "./plan-approval-card";
import type {PlanApprovalContextValue} from "./plan-approval-context";
import {approvalEnterSeen, markApprovalEnterSeen} from "../lib/approval-enter-seen";
import
{
	PLAN_LEAVE_TITLE,
	PLAN_NOTHING_TO_REVIEW,
	PLAN_PROPOSED_TITLE,
	planSubtitleLine,
	planText,
} from "../lib/exit-plan-mode";
import type {ApprovalPresentation} from "../lib/approval-presentation";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";

/**
 * Upstream's plan approval card (`Gc` in its inline "card" presentation) for the
 * ExitPlanMode the session waits on, whether its record is on disk or only the
 * hooks have reported it: its own card in the transcript's sticky trailing slot,
 * upstream's tinted title band (`d3`) naming the plan by its first line with
 * "Open plan" trailing, then the approve / revise actions typed into the CLI's
 * plan dialog. With a pane host the plan text stays in the Plan pane and the tool row; without one the card draws
 * it in its body, and every accept waits until it has been scrolled to its end (upstream's plan read gate). A
 * call with no plan asks to leave plan mode instead, with nothing to open.
 */
export function InlinePlanApproval({
	toolUseId,
	planText: text,
	plan,
	presentation = "card",
	queueDepth = 0,
}: {
	toolUseId: string;
	/** The ExitPlanMode input's plan, if any. */
	planText: string | undefined;
	plan: PlanApprovalContextValue;
	/** Inline after the transcript, sticky ("card"), or docked above the composer with the dock's keycaps. */
	presentation?: ApprovalPresentation;
	/** Upstream's `queueDepth`: the other requests pending behind this one, drawn as ghosts while docked. */
	queueDepth?: number;
})
{
	const host = useOptionalPaneHost();
	const proposed =
		text === undefined
			? undefined
			: planText(
					{
						plan: text,
					},
				);
	const enterKey = `plan:${plan.sessionId}:${toolUseId}`;
	const [enter] = useState(() => !approvalEnterSeen(enterKey));
	useEffect(() =>
	{
		markApprovalEnterSeen(enterKey);
	}, [enterKey]);
	// Upstream's `je`: the plan is drawn, and so gated, only where it has no Plan pane to open in.
	const drawsPlan = host === null && proposed !== undefined;
	const bodyRef = useRef<HTMLDivElement>(null);
	const [readHeld, setReadHeld] = useState(false);
	const onHeld = useCallback((held: boolean) =>
	{
		setReadHeld(held);
	}, []);
	useReadGate(
		{
			ref: bodyRef,
			watched: drawsPlan,
			text: proposed,
			onHeld,
		},
	);
	const subtitle =
		proposed === undefined ? (
			PLAN_NOTHING_TO_REVIEW
		) : host === null ? null : (
			<span className="line-clamp-2 break-words [unicode-bidi:plaintext]">{planSubtitleLine(proposed)}</span>
		);
	return (
		<div data-inline-plan="" className={presentation === "card" ? INLINE_PLAN_CLASS : undefined}>
			<ApprovalCardShell
				presentation={presentation}
				queueDepth={queueDepth}
				compact
				roam={false}
				enter={enter}
				title={
					<div className="flex min-h-6 shrink-0 items-center gap-1 text-primary">
						<span className="flex min-w-0 flex-1 flex-col gap-[2px]">
							<span className="flex min-w-0 items-start gap-1.5">
								<span data-question-stop-name="" className="min-w-0 break-words text-body">
									{proposed === undefined ? PLAN_LEAVE_TITLE : PLAN_PROPOSED_TITLE}
								</span>
							</span>
							{subtitle !== null && <div className="text-body text-ink-muted">{subtitle}</div>}
						</span>
						{host !== null && proposed !== undefined && (
							<span className="shrink-0 self-center">
								<OpenPlanLink
									onOpen={() =>
									{
										host.openPane("plan");
									}}
								/>
							</span>
						)}
					</div>
				}
				bodyRef={bodyRef}
				body={
					drawsPlan ? (
						<div data-testid="approval-plan-text" className={PLAN_TEXT_CLASS}>
							{proposed}
						</div>
					) : null
				}
				actions={
					<div className="w-full">
						<PlanApprovalCard
							toolUseId={toolUseId}
							plan={plan}
							placement={presentation}
							autoOpenPlan={proposed !== undefined}
							readHeld={drawsPlan && readHeld}
						/>
					</div>
				}
			/>
		</div>
	);
}

/** The inline card's sticky place in the transcript's trailing slot, on the transcript's measure. */
const INLINE_PLAN_CLASS = `${CHAT_COLUMN_CLASS} sticky top-[calc(max(var(--epitaxy-top-fade-height,0px),var(--fade-top,0px),var(--epitaxy-suggested-task-end,0px),var(--epitaxy-sticky-prompt-end,0px))+5px)] z-[1] bg-[var(--epitaxy-transcript-surface,var(--color-surface-1))] pb-4`;

/** Upstream's plan text in the card body (`approval-plan-text`). */
const PLAN_TEXT_CLASS = "whitespace-pre-wrap break-words text-body text-secondary select-text [unicode-bidi:plaintext]";
