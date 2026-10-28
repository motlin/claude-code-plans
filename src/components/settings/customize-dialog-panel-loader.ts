import {type TrackedPromise, trackFulfillment} from "../../lib/tracked-promise";

type CustomizeDialogPanelModule = typeof import("../customize/customize-dialog-panel");

// Skills, Connectors and Plugins pull in the Customize lists and detail views, so they load on first open.
let customizeDialogPanelModule: TrackedPromise<CustomizeDialogPanelModule> | undefined;

/** Starts loading the Customize panel; the nav calls it on hover/focus so the first open needn't wait. */
// oxlint-disable-next-line typescript/promise-function-async -- returns the one cached download, which use() needs to be stable
export function preloadCustomizeDialogPanel(): Promise<CustomizeDialogPanelModule> {
	customizeDialogPanelModule ??= trackFulfillment(import("../customize/customize-dialog-panel"));
	return customizeDialogPanelModule;
}
