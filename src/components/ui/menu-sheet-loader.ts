type MenuSheetModule = typeof import("./menu-sheet");

let menuSheetModule: MenuSheetModule | null = null;
let menuSheetLoad: Promise<MenuSheetModule> | null = null;

/**
 * The sheet presentation (sheet DOM, drag, drill-in) is its own chunk. A root whose gate would open a sheet
 * starts the load as it mounts, so by the first tap the module is in hand and the sheet renders synchronously.
 */
export async function preloadMenuSheet(): Promise<MenuSheetModule> {
	menuSheetLoad ??= import("./menu-sheet").then((module) => {
		menuSheetModule = module;
		return module;
	});
	return menuSheetLoad;
}

/** The sheet module once its chunk has loaded, so a sheet renders without suspending. */
export function loadedMenuSheet(): MenuSheetModule | null {
	return menuSheetModule;
}
