import {useCallback, useEffect, useRef, useState} from "react";

import {APPROVAL_ARM_GRACE_MS, dockKeyAllowed} from "../lib/dock-keys";
import {
	PLAN_ACCEPT_LABEL,
	PLAN_BACK_LABEL,
	PLAN_FEEDBACK_LABEL,
	PLAN_FEEDBACK_PLACEHOLDER,
	PLAN_REJECT_LABEL,
	PLAN_REVISE_LABEL,
	PLAN_REVISE_OPEN_LABEL,
	planKeyAction,
	planPrimaryAccept,
	type PlanDecision,
	type PlanKeyAction,
	type PlanDialog,
} from "../lib/plan-approval";
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
	"w-full resize-none rounded-r6 bg-alpha-1 px-2 py-1.5 text-body text-primary placeholder:text-tertiary shadow-[inset_0_0_0_1px_var(--color-border)] outline-none focus-visible:shadow-[var(--focus-shadow)] hover:not-focus:shadow-[inset_0_0_0_1px_var(--color-strong)]";

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

type DialogState = {kind: "loading"} | {kind: "ready"; dialog: PlanDialog} | {kind: "unavailable"};

function PlanApprovalActions({
	dialog,
	decide,
}: {
	dialog: PlanDialog;
	decide: (decision: PlanDecision) => Promise<void>;
}) {
	const [revising, setRevising] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const feedback = useRef("");
	const mountedAt = useRef<number | null>(null);
	const primary = planPrimaryAccept(dialog);

	const send = useCallback(
		async (decision: PlanDecision) => {
			setError(null);
			setSubmitting(true);
			try {
				await decide(decision);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to answer the plan");
			} finally {
				setSubmitting(false);
			}
		},
		[decide],
	);

	const closeFeedback = useCallback(() => {
		feedback.current = "";
		setRevising(false);
	}, []);

	useEffect(() => {
		mountedAt.current = performance.now();
	}, []);

	useEffect(() => {
		if (revising || submitting) return undefined;
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
	}, [revising, submitting, dialog, send]);

	const reviseWithFeedback = () => void send({kind: "reject", feedback: feedback.current});

	return (
		<div data-plan-approval className="flex flex-col gap-2 pt-1">
			{revising && (
				<textarea
					// The box opens on the user's own click or Esc, so taking focus is expected.
					// oxlint-disable-next-line jsx-a11y/no-autofocus
					autoFocus
					rows={3}
					aria-label={PLAN_FEEDBACK_LABEL}
					placeholder={PLAN_FEEDBACK_PLACEHOLDER}
					className={FEEDBACK_CLASS}
					onChange={(event) => {
						feedback.current = event.target.value;
					}}
					onKeyDown={(event) => {
						if (event.nativeEvent.isComposing) return;
						if (event.key === "Escape") {
							event.preventDefault();
							closeFeedback();
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
				{revising ? (
					<>
						<ApprovalActionButton variant="secondary" disabled={submitting} onClick={closeFeedback}>
							{PLAN_BACK_LABEL}
						</ApprovalActionButton>
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
	const {answerRoute, loadDialog, decide} = plan;
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
	return <PlanApprovalActions dialog={state.dialog} decide={decide} />;
}
