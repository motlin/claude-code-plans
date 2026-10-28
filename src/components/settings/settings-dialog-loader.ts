type SettingsDialogModule = typeof import("./settings-dialog");

/** React's thenable tracking fields: a promise tagged `fulfilled` makes `use()` return its value without suspending. */
type TrackedPromise<T> = Promise<T> & {status?: "fulfilled"; value?: T};

// The Settings tabs, their sections and search stay off the cold load until Settings first opens.
let dialogModule: TrackedPromise<SettingsDialogModule> | undefined;
let loadedDialog: SettingsDialogModule["SettingsDialog"] | undefined;

/** The Settings modal's one module download, shared by its lazy boundary and the idle and intent warm-ups. */
// oxlint-disable-next-line typescript/promise-function-async -- returns the one cached download, which use() needs to be stable
export function loadSettingsDialog(): Promise<SettingsDialogModule> {
	if (dialogModule !== undefined) return dialogModule;
	const download: TrackedPromise<SettingsDialogModule> = import("./settings-dialog")
		.then((module) => {
			loadedDialog = module.SettingsDialog;
			// Tagged even when an idle or intent warm-up finished the download, so every later use() is synchronous.
			download.status = "fulfilled";
			download.value = module;
			return module;
		})
		.catch((error: unknown) => {
			// A failed download is retried on the next open.
			dialogModule = undefined;
			throw error;
		});
	dialogModule = download;
	return download;
}

/** The Settings modal once its module has downloaded, so it renders without suspending. */
export function loadedSettingsDialog(): SettingsDialogModule["SettingsDialog"] | undefined {
	return loadedDialog;
}
