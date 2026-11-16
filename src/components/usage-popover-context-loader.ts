type UsagePopoverContextModule = typeof import("./usage-popover-context");

let loadedModule: UsagePopoverContextModule | null = null;
let moduleLoad: Promise<UsagePopoverContextModule> | null = null;

/**
 * The ring popover's Context window section (and the breakdown card it draws) is its own chunk, kept out of the
 * composer's cold load. A ring in context mode starts the load as it mounts, so the popover opens without suspending.
 */
export async function preloadUsagePopoverContext(): Promise<UsagePopoverContextModule>
{
	moduleLoad ??= import("./usage-popover-context").then((module) =>
	{
		loadedModule = module;
		return module;
	});
	return moduleLoad;
}

/** The section module once its chunk has loaded, so it renders without suspending. */
export function loadedUsagePopoverContext(): UsagePopoverContextModule | null
{
	return loadedModule;
}
