import {useEffect} from "react";

import {registerPane} from "./pane-registry";
import {SessionPlanPane} from "./plan-pane";

/** Registers the `plan` pane kind while the session has a linked plan. */
export function useRegisterPlanPane(planFilename: string | undefined): void {
	useEffect(() => {
		if (planFilename === undefined) return undefined;
		return registerPane("plan", {
			title: "Plan",
			render: () => <SessionPlanPane key={planFilename} planFilename={planFilename} />,
		});
	}, [planFilename]);
}
