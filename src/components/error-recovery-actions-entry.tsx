import {deferredComponent, deferredModule} from "./deferred-component";

// The recovery row shows only on a live session's last API error, so it stays off the session's cold load.
const recoveryActions = deferredModule(async () =>
	import("./error-recovery-actions").then(({ErrorRecoveryActions}) => (
	{
		ErrorRecoveryActions,
	})),
);

export const preloadErrorRecoveryActions = recoveryActions.preload;
// No upstream lazy counterpart was found in the 11-10 crawl, so a failed download stays fail-open (renders nothing).
export const DeferredErrorRecoveryActions = deferredComponent(recoveryActions, "ErrorRecoveryActions");
