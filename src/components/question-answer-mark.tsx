import {Check} from "lucide-react";

/**
 * Upstream cds Checkbox / Radio indicator, sized by --cds-checkbox (20px comfortable, 16px compact) with a
 * --cds-checkbox-radius corner: unchecked, its edge reads --cds-checkbox-edge (hover -hover).
 */
export function QuestionAnswerMark({checked, multi}: {checked: boolean; multi: boolean})
{
	const shape = multi ? "rounded-[var(--cds-checkbox-radius)]" : "rounded-full";
	return (
		<span
			aria-hidden="true"
			{...(checked
				?
					{
						"data-checked": "",
					}
				:
					{
						"data-unchecked": "",
					})}
			className={`mt-[calc((1lh-var(--cds-checkbox,1rem))/2)] flex size-[var(--cds-checkbox)] shrink-0 items-center justify-center ${shape} ${
				checked
					? "bg-fill-accent text-white"
					: "shadow-[inset_0_0_0_1px_var(--color-checkbox-edge)] group-hover:shadow-[inset_0_0_0_1px_var(--color-checkbox-edge-hover)]"
			}`}
		>
			{checked &&
				(multi ? (
					<Check className="size-[calc(var(--cds-checkbox)-0.25rem)]" strokeWidth={3} />
				) : (
					<span className="size-[calc(var(--cds-checkbox)-0.625rem)] rounded-full bg-white" />
				))}
		</span>
	);
}
