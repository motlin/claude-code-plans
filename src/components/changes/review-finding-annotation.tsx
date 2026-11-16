import {scrollToFinding} from "../../lib/changes-review";
import type {ReviewFinding} from "../../lib/review-diff";
import {setCurrentReviewFinding, useCurrentReviewFinding} from "../../lib/review-finding-cursor";
import {FindingCard} from "../finding-card";
import {PANE_HEADER_ICON_BUTTON_CLASS} from "../panes/pane-classes";
import {Icon} from "../ui/icon";
import {Tooltip} from "../ui/tooltip";

export interface FindingActions
{
	onFix: (finding: ReviewFinding) => void;
	onDismiss: (finding: ReviewFinding) => void;
}

const ACTION_BUTTON =
	"h-6 cursor-pointer rounded-r5 px-2 text-footnote text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary";

/**
 * A working-copy review finding under its diff line, with upstream's "Fix this one" and "Dismiss finding". The
 * current finding (upstream c44d00c7f `as`) takes `aria-current` and the accent ring; with other findings open, its
 * Next finding steps on, wrapping to the first (upstream `stepReviewFinding`).
 */
export function ReviewFindingAnnotation({
	finding,
	actions,
	sessionId,
	next = null,
}: {
	finding: ReviewFinding;
	actions: FindingActions;
	sessionId?: string | undefined;
	/** The finding the card's Next finding moves to; null hides it. */
	next?: ReviewFinding | null;
})
{
	const current = useCurrentReviewFinding(sessionId) === finding.id;
	return (
		<div
			data-review-finding={finding.id}
			aria-current={current ? "true" : undefined}
			tabIndex={current ? -1 : undefined}
			className="px-2 py-1 font-sans outline-none"
		>
			<FindingCard
				severity={finding.severity}
				title={finding.title}
				body={finding.body}
				suggestion={finding.suggestion}
				current={current}
			/>
			<div className="flex gap-1 px-1">
				<button
					type="button"
					onClick={() =>
					{
						actions.onFix(finding);
					}}
					className={ACTION_BUTTON}
				>
					Fix this one
				</button>
				<button
					type="button"
					onClick={() =>
					{
						actions.onDismiss(finding);
					}}
					className={ACTION_BUTTON}
				>
					Dismiss finding
				</button>
				{sessionId !== undefined && next !== null && (
					<Tooltip content="Next finding">
						<button
							type="button"
							aria-label={`Next finding after the one on line ${finding.line}`}
							onClick={() =>
							{
								setCurrentReviewFinding(sessionId, next.id);
								scrollToFinding(sessionId, next);
							}}
							className={PANE_HEADER_ICON_BUTTON_CLASS}
						>
							<Icon name="ArrowDown" size="auto" aria-hidden="true" />
						</button>
					</Tooltip>
				)}
			</div>
		</div>
	);
}
