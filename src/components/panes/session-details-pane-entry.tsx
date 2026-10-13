import {useEffect} from "react";

import type {Statusline} from "../../lib/api/statusline";
import {SessionDetails} from "./session-details-pane";
import {registerPane} from "./pane-registry";

/** Registers the `session-details` pane kind (View options ▸ Session details) once the session has a statusline. */
export function useRegisterSessionDetailsPane(statusline: Statusline | null, messageCount: number): void {
	useEffect(() => {
		if (statusline === null) return undefined;
		return registerPane("session-details", {
			title: "Session details",
			render: () => <SessionDetails data={statusline} messageCount={messageCount} />,
		});
	}, [statusline, messageCount]);
}
