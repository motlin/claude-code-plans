type PopoverSheetModule = typeof import("./popover-sheet");

let popoverSheetModule: PopoverSheetModule | null = null;
let popoverSheetLoad: Promise<PopoverSheetModule> | null = null;

/**
 * The sheet presentation (sheet DOM, drag, detents, keyboard inset) is its own chunk, as upstream's
 * `cds_mobile_sheets`. A root whose gate would open a sheet starts the load as it mounts, so by the first
 * tap the module is in hand and the sheet renders synchronously.
 */
export async function preloadPopoverSheet(): Promise<PopoverSheetModule> {
	popoverSheetLoad ??= import("./popover-sheet").then((module) => {
		popoverSheetModule = module;
		return module;
	});
	return popoverSheetLoad;
}

/** The sheet module once its chunk has loaded, so a sheet renders without suspending. */
export function loadedPopoverSheet(): PopoverSheetModule | null {
	return popoverSheetModule;
}
