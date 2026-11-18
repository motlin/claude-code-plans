import {SelectionCommentCard, type SelectionCommentCardProps} from "../selection-comment-card";

/**
 * Upstream's plan "Comment on selection" popover: the shared selection comment card below the selection,
 * painted with the plan highlight, its draft labelled Plan comment.
 */
export function PlanCommentPopover(
	props: Pick<
		SelectionCommentCardProps,
		| "range"
		| "selectedText"
		| "boundary"
		| "initialValue"
		| "value"
		| "onChange"
		| "onSave"
		| "onDelete"
		| "onClose"
	>,
)
{
	return <SelectionCommentCard {...props} side="below" highlightName="plan-selection" inputLabel="Plan comment" />;
}
