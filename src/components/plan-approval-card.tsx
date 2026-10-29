import {MessageCircle, X} from "lucide-react";
import {useCallback, useEffect, useRef, useState} from "react";

import {APPROVAL_ARM_GRACE_MS, dockKeyAllowed} from "../lib/dock-keys";
import {
	PLAN_ACCEPT_LABEL,
	PLAN_BACK_LABEL,
	PLAN_DELETE_COMMENT_LABEL,
	PLAN_FEEDBACK_LABEL,
	PLAN_FEEDBACK_PLACEHOLDER,
	PLAN_FEEDBACK_WITH_COMMENTS_PLACEHOLDER,
	PLAN_REJECT_LABEL,
	PLAN_REVISE_LABEL,
	PLAN_REVISE_OPEN_LABEL,
	planCommentCountLabel,
	planKeyAction,
	planPrimaryAccept,
	type PlanDecision,
	type PlanKeyAction,
	type PlanDialog,
} from "../lib/plan-approval";
import {
	clearPlanComments,
	formatPlanFeedback,
	removePlanComment,
	restorePlanComments,
	usePlanComments,
} from "../lib/plan-comments";
import {usePhoneSheet} from "../lib/use-phone-sheet";
import {ApprovalActionButton, STACK_ACTIONS} from "./approval-card";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import type {PlanApprovalContextValue} from "./plan-approval-context";
import {ReadOnlyAnswerHint} from "./terminal-writes-tip";
import {Shortcut} from "./ui/shortcut";

const HINT_CLASS = "text-footnote text-secondary";
/**
 * Upstream's plan `epitaxy-approval-actions` row (`[&>div]:grow` on its two groups). At `@container (width <= 420px)`
 * the row and each group turn to columns and every button takes the full width.
 */
const PLAN_ACTIONS_CLASS = `flex flex-wrap justify-between gap-x-1 gap-y-2 [&>span]:grow ${STACK_ACTIONS} @max-[420px]:[&>span]:flex-col @max-[420px]:[&>span]:items-stretch @max-[420px]:[&_button]:w-full`;

/** Upstream's cds TextArea (`bg-fill-field shadow-field-ring px-md py-sm rounded`): 6px radius, 5% fill, field ring, accent focus shadow. */
const FEEDBACK_CLASS =
	"w-full resize-none rounded-r6 bg-alpha-1 px-2 py-1.5 text-body text-primary placeholder:text-ink-muted shadow-[inset_0_0_0_1px_var(--color-border)] outline-none focus-visible:shadow-[var(--focus-shadow)] hover:not-focus:shadow-[inset_0_0_0_1px_var(--color-strong)]";

/** Where a plan key may act: anywhere a docked card key may, plus ⇧⌘⏎ from a composer holding a draft (upstream lets it through). */
function planKeyAllowed(target: EventTarget | null, action: PlanKeyAction): boolean {
	if (dockKeyAllowed(target)) return true;
	return (
		action.kind === "accept" &&
		action.mode === "default" &&
		target instanceof HTMLTextAreaElement &&
		target.closest('[data-focus-region="composer"]') !== null
	);
}

/** Upstream's cds ghost icon-only Button (24px control) for a comment row's Delete. */
const DELETE_COMMENT_CLASS =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/**
 * Upstream's list of the session's Plan pane comments above the Revise box:
 * each row reopens the Plan pane and has its own Delete, then an sr-only note
 * of how many will be sent.
 */
function PlanCommentList({sessionId}: {sessionId: string}) {
	const comments = usePlanComments(sessionId);
	const host = useOptionalPaneHost();
	return (
		<ul className="-m-2 flex max-h-[176px] scroll-p-2 flex-col gap-1 overflow-y-auto p-2">
			{comments.map((c) => (
				<li key={c.id} className="flex items-center gap-0.5 rounded-r4 bg-alpha-1 pe-1.25 hover:bg-alpha-2">
					<button
						type="button"
						onClick={() => {
							host?.openPane("plan");
						}}
						className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-r4 p-1.25 text-start hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
					>
						<span className="flex items-center gap-0.75 text-caption text-ink-muted">
							<MessageCircle aria-hidden="true" className="size-3 shrink-0" />
							<span className="truncate">{c.selectedText}</span>
						</span>
						<span className="text-body text-primary">{c.comment}</span>
					</button>
					<button
						type="button"
						aria-label={PLAN_DELETE_COMMENT_LABEL}
						className={DELETE_COMMENT_CLASS}
						onClick={() => {
							removePlanComment(sessionId, c.id);
						}}
					>
						<X aria-hidden="true" className="size-4" />
					</button>
				</li>
			))}
			<li className="sr-only">{planCommentCountLabel(comments.length)}</li>
		</ul>
	);
}

type DialogState = {kind: "loading"} | {kind: "ready"; dialog: PlanDialog} | {kind: "unavailable"};

function PlanApprovalActions({
	sessionId,
	dialog,
	decide,
}: {
	sessionId: string;
	dialog: PlanDialog;
	decide: (decision: PlanDecision) => Promise<void>;
}) {
	const [revising, setRevising] = useState(false);
	const hasComments = usePlanComments(sessionId).length > 0;
	// Upstream: any comment holds the card in Revise by itself, without taking focus.
	const showRevise = revising || hasComments;
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const feedback = useRef("");
	const mountedAt = useRef<number | null>(null);
	const primary = planPrimaryAccept(dialog);

	/** Any decision takes the session's comments; a refused answer puts them back. */
	const send = useCallback(
		async (decision: PlanDecision | ((comments: ReturnType<typeof clearPlanComments>) => PlanDecision)) => {
			setError(null);
			setSubmitting(true);
			const comments = clearPlanComments(sessionId);
			try {
				await decide(typeof decision === "function" ? decision(comments) : decision);
			} catch (err) {
				restorePlanComments(sessionId, comments);
				setError(err instanceof Error ? err.message : "Failed to answer the plan");
			} finally {
				setSubmitting(false);
			}
		},
		[decide, sessionId],
	);

	const closeFeedback = useCallback(() => {
		feedback.current = "";
		setRevising(false);
	}, []);

	useEffect(() => {
		mountedAt.current = performance.now();
	}, []);

	useEffect(() => {
		if (showRevise || submitting) return undefined;
		function onKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented) return;
			const action = planKeyAction(event, dialog);
			if (action === null || !planKeyAllowed(event.target, action)) return;
			// Upstream withholds an accept chord that lands within 400ms of the card arriving.
			const armedAt = mountedAt.current ?? performance.now();
			if (action.kind === "accept" && performance.now() - armedAt < APPROVAL_ARM_GRACE_MS) return;
			event.preventDefault();
			event.stopPropagation();
			if (action.kind === "revise") setRevising(true);
			else void send(action);
		}
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [showRevise, submitting, dialog, send]);

	const reviseWithFeedback = () => {
		// Keep the box (and its text) up while the comments are taken, in case the answer is refused.
		setRevising(true);
		void send((comments) => ({kind: "reject", feedback: formatPlanFeedback(comments, feedback.current)}));
	};

	return (
		<div data-plan-approval className="flex flex-col gap-2 pt-1">
			{hasComments && <PlanCommentList sessionId={sessionId} />}
			{showRevise && (
				<textarea
					// Opened by the user's own click or Esc, taking focus is expected; opened by comments, it waits.
					// oxlint-disable-next-line jsx-a11y/no-autofocus
					autoFocus={revising}
					rows={3}
					aria-label={PLAN_FEEDBACK_LABEL}
					placeholder={hasComments ? PLAN_FEEDBACK_WITH_COMMENTS_PLACEHOLDER : PLAN_FEEDBACK_PLACEHOLDER}
					className={FEEDBACK_CLASS}
					onChange={(event) => {
						feedback.current = event.target.value;
					}}
					onKeyDown={(event) => {
						if (event.nativeEvent.isComposing) return;
						if (event.key === "Escape") {
							event.preventDefault();
							if (!hasComments) closeFeedback();
						} else if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							reviseWithFeedback();
						}
					}}
				/>
			)}
			{/* Upstream's `epitaxy-approval-actions`: the reject pair at the start, the accepts at the end; in a
			    ≤420px container both groups stack and every button goes full width. */}
			<div data-plan-actions className={PLAN_ACTIONS_CLASS}>
				{showRevise ? (
					<>
						{hasComments ? (
							<span className="@max-[420px]:hidden" />
						) : (
							<ApprovalActionButton variant="secondary" disabled={submitting} onClick={closeFeedback}>
								{PLAN_BACK_LABEL}
							</ApprovalActionButton>
						)}
						<ApprovalActionButton
							variant="primary"
							busy={submitting}
							disabled={submitting}
							onClick={reviseWithFeedback}
						>
							{PLAN_REVISE_LABEL}
						</ApprovalActionButton>
					</>
				) : (
					<>
						<span className="flex gap-2">
							<ApprovalActionButton
								variant="secondary"
								disabled={submitting}
								onClick={() => void send({kind: "reject", feedback: ""})}
							>
								{PLAN_REJECT_LABEL}
							</ApprovalActionButton>
							<ApprovalActionButton
								variant="secondary"
								disabled={submitting}
								onClick={() => {
									setRevising(true);
								}}
							>
								{PLAN_REVISE_OPEN_LABEL}
								<Shortcut keys="esc" className="pointer-coarse:hidden" />
							</ApprovalActionButton>
						</span>
						<span className="flex flex-wrap justify-end gap-2">
							{primary !== null && primary !== "default" && dialog.manual && (
								<ApprovalActionButton
									variant="secondary"
									disabled={submitting}
									onClick={() => void send({kind: "accept", mode: "default"})}
								>
									{PLAN_ACCEPT_LABEL.default}
									<Shortcut keys="cmd+shift+enter" className="pointer-coarse:hidden" />
								</ApprovalActionButton>
							)}
							{primary !== null && (
								<ApprovalActionButton
									variant="primary"
									busy={submitting}
									disabled={submitting}
									onClick={() => void send({kind: "accept", mode: primary})}
								>
									{PLAN_ACCEPT_LABEL[primary]}
									<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
								</ApprovalActionButton>
							)}
						</span>
					</>
				)}
			</div>
			{error !== null && (
				<p data-plan-error className="text-footnote text-extended-pink">
					{error}
				</p>
			)}
		</div>
	);
}

/**
 * Upstream's plan card effect: open the Plan pane once per mount (so a remount
 * reopens it), only where side panes exist (never on a phone, where upstream
 * passes no `onOpenPlan`) and only while the tab is visible.
 */
function useAutoOpenPlanPane(): void {
	const host = useOptionalPaneHost();
	const phone = usePhoneSheet();
	const opened = useRef(false);
	useEffect(() => {
		if (opened.current || host === null || phone || document.visibilityState !== "visible") return;
		opened.current = true;
		host.openPane("plan");
	}, [host, phone]);
}

/**
 * Upstream's plan approval actions under a pending ExitPlanMode: [Reject]
 * [Revise… esc] … [Accept ⇧⌘⏎] [Accept and <mode> ⌘⏎], and Revise's "What
 * should change?" box with [Back] [Revise]. Choices type into the CLI's own
 * plan dialog in the session's live pane, offering only what that dialog has
 * on screen; with no writable pane, or no dialog showing, it is read-only.
 */
export function PlanApprovalCard({toolUseId, plan}: {toolUseId: string; plan: PlanApprovalContextValue}) {
	const {sessionId, answerRoute, loadDialog, decide} = plan;
	useAutoOpenPlanPane();
	const live = answerRoute === "live-pane";
	const [state, setState] = useState<DialogState>({kind: "loading"});

	useEffect(() => {
		if (!live) return undefined;
		let current = true;
		setState({kind: "loading"});
		loadDialog().then(
			(dialog) => {
				if (current) setState({kind: "ready", dialog});
			},
			() => {
				if (current) setState({kind: "unavailable"});
			},
		);
		return () => {
			current = false;
		};
	}, [live, loadDialog, toolUseId]);

	if (!live || state.kind === "unavailable") return <ReadOnlyAnswerHint className={HINT_CLASS} />;
	if (state.kind === "loading") return null;
	return <PlanApprovalActions sessionId={sessionId} dialog={state.dialog} decide={decide} />;
}
