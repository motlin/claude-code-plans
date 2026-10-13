import type {PlanListItem} from "../lib/api/plans";

export function selectPlanFilenames(plans: PlanListItem[]): Set<string> {
	if (plans !== memoSource) {
		memoSource = plans;
		memoSet = new Set(plans.map((plan) => plan.filename));
	}
	return memoSet;
}

// Keep react-query's select result stable and share one filename Set across transcript links.
let memoSource: PlanListItem[] | undefined;

let memoSet = new Set<string>();
