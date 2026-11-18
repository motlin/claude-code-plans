import type {ApprovalPresentation} from "../lib/approval-presentation";
import {Skeleton} from "./ui/skeleton";

/* Upstream `Nj`: the approval cards' placeholder height. */
const APPROVAL_SKELETON_HEIGHT = 139;

/**
 * Upstream `Fj`/`Pj`: the approval cards' loading placeholder, a 139px card-radius skeleton that keeps the inline
 * card's 480px column in the "card" presentation.
 */
export function ApprovalCardSkeleton({presentation = "card"}: {presentation?: ApprovalPresentation})
{
	return (
		<Skeleton
			className={presentation === "card" ? "w-full max-w-[480px] rounded-card" : "rounded-card"}
			style={
			{
				height: APPROVAL_SKELETON_HEIGHT,
			}}
		/>
	);
}
