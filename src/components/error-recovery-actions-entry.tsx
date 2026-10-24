import {deferredComponent, deferredModule} from "./deferred-component";

// The recovery row shows only on a live session's last API error, so it stays off the session's cold load.
const recoveryActions = deferredModule(async () =>
	import("./error-recovery-actions").then(({ErrorRecoveryActions}) => ({ErrorRecoveryActions})),
);

export const preloadErrorRecoveryActions = recoveryActions.preload;
export const DeferredErrorRecoveryActions = deferredComponent(recoveryActions, "ErrorRecoveryActions");
