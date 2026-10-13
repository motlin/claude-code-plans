type CustomizeDialogPanelModule = typeof import("../customize/customize-dialog-panel");

// Skills, Connectors and Plugins pull in the Customize lists and detail views, so they load on first open.
let customizeDialogPanelModule: Promise<CustomizeDialogPanelModule> | undefined;
let loadedPanel: CustomizeDialogPanelModule["default"] | undefined;

/** Starts loading the Customize panel; the nav calls it on hover/focus so the first open needn't wait. */
// oxlint-disable-next-line typescript/promise-function-async -- returns the one cached download, which use() needs to be stable
export function preloadCustomizeDialogPanel(): Promise<CustomizeDialogPanelModule> {
	customizeDialogPanelModule ??= import("../customize/customize-dialog-panel").then((module) => {
		loadedPanel = module.default;
		return module;
	});
	return customizeDialogPanelModule;
}

/** The Customize panel once its module has loaded, so it renders without suspending. */
export function loadedCustomizeDialogPanel(): CustomizeDialogPanelModule["default"] | undefined {
	return loadedPanel;
}
