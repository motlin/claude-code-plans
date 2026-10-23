import {OPEN_PLAN_ACTION_LABEL} from "../lib/exit-plan-mode";

/**
 * Upstream's plan card "Open plan" action: a footnote-sized cds TextLink span
 * with `role="button"`, activated by click, Enter or Space.
 */
export function OpenPlanLink({onOpen}: {onOpen: () => void}) {
	return (
		<span
			role="button"
			tabIndex={0}
			data-cds="TextLink"
			className="text-link inline cursor-pointer text-footnote"
			onClick={onOpen}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				onOpen();
			}}
		>
			{OPEN_PLAN_ACTION_LABEL}
		</span>
	);
}
