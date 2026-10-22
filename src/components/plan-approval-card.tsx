import {useCallback, useEffect, useRef, useState} from "react";

import {dockKeyAllowed} from "../lib/dock-keys";
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
	type PlanDialog,
} from "../lib/plan-approval";
import {ApprovalActionButton} from "./approval-card";
import type {PlanApprovalContextValue} from "./plan-approval-context";
import {ReadOnlyAnswerHint} from "./terminal-writes-tip";
import {Shortcut} from "./ui/shortcut";

const HINT_CLASS = "text-footnote text-secondary";
const FEEDBACK_CLASS =
	"w-full resize-none rounded-r4 border border-strong bg-transparent px-2 py-1.5 text-body text-primary placeholder:text-tertiary focus:outline-none";

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
		if (revising || submitting) return undefined;
		function onKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || !dockKeyAllowed(event.target)) return;
			const action = planKeyAction(event, dialog);
			if (action === null) return;
			event.preventDefault();
			if (action.kind === "revise") setRevising(true);
			else void send(action);
		}
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
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
			{/* Upstream's `epitaxy-approval-actions`: the reject pair at the start, the accepts at the end. */}
			<div className="flex flex-wrap justify-between gap-x-1 gap-y-2">
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
 * Upstream's plan approval actions under a pending ExitPlanMode: [Reject]
 * [Revise… esc] … [Accept ⇧⌘⏎] [Accept and <mode> ⌘⏎], and Revise's "What
 * should change?" box with [Back] [Revise]. Choices type into the CLI's own
 * plan dialog in the session's live pane, offering only what that dialog has
 * on screen; with no writable pane, or no dialog showing, it is read-only.
 */
export function PlanApprovalCard({toolUseId, plan}: {toolUseId: string; plan: PlanApprovalContextValue}) {
	const {answerRoute, loadDialog, decide} = plan;
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
