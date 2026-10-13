type CommandPaletteModule = typeof import("./command-palette");

// The palette, its cmdk list and search views stay off the cold load until the first ⌘K.
let paletteModule: Promise<CommandPaletteModule> | undefined;
let loadedPalette: CommandPaletteModule["CommandPalette"] | undefined;

/** The palette's one module download, shared by its lazy boundary and the idle and intent warm-ups. */
// oxlint-disable-next-line typescript/promise-function-async -- returns the one cached download, which use() needs to be stable
export function loadCommandPalette(): Promise<CommandPaletteModule> {
	paletteModule ??= import("./command-palette")
		.then((module) => {
			loadedPalette = module.CommandPalette;
			return module;
		})
		.catch((error: unknown) => {
			// A failed download is retried on the next open.
			paletteModule = undefined;
			throw error;
		});
	return paletteModule;
}

/** The palette component once its module has downloaded, so it renders without suspending. */
export function loadedCommandPalette(): CommandPaletteModule["CommandPalette"] | undefined {
	return loadedPalette;
}
