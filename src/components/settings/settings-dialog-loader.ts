type SettingsDialogModule = typeof import("./settings-dialog");

// The Settings tabs, their sections and search stay off the cold load until Settings first opens.
let dialogModule: Promise<SettingsDialogModule> | undefined;
let loadedDialog: SettingsDialogModule["SettingsDialog"] | undefined;

/** The Settings modal's one module download, shared by its lazy boundary and the idle and intent warm-ups. */
// oxlint-disable-next-line typescript/promise-function-async -- returns the one cached download, which use() needs to be stable
export function loadSettingsDialog(): Promise<SettingsDialogModule> {
	dialogModule ??= import("./settings-dialog")
		.then((module) => {
			loadedDialog = module.SettingsDialog;
			return module;
		})
		.catch((error: unknown) => {
			// A failed download is retried on the next open.
			dialogModule = undefined;
			throw error;
		});
	return dialogModule;
}

/** The Settings modal once its module has downloaded, so it renders without suspending. */
export function loadedSettingsDialog(): SettingsDialogModule["SettingsDialog"] | undefined {
	return loadedDialog;
}
