import {deferredComponent, deferredModule, useLoadedModule} from "./deferred-component";

// The composer's on-demand surfaces stay off the cold load; the composer warms them on mount, before a first / or @.
const composerSurfaces = deferredModule(async () =>
	import("./composer-surfaces").then(
		({AttachedContextChips, ComposerDropScrim, FileMentionMenu, QueuedMessageBar, SlashCommandMenu}) => ({
			AttachedContextChips,
			ComposerDropScrim,
			FileMentionMenu,
			QueuedMessageBar,
			SlashCommandMenu,
		}),
	),
);

export const preloadComposerSurfaces = composerSurfaces.preload;

const deferredSurfaces = {
	AttachedContextChips: deferredComponent(composerSurfaces, "AttachedContextChips"),
	ComposerDropScrim: deferredComponent(composerSurfaces, "ComposerDropScrim"),
	FileMentionMenu: deferredComponent(composerSurfaces, "FileMentionMenu"),
	QueuedMessageBar: deferredComponent(composerSurfaces, "QueuedMessageBar"),
	SlashCommandMenu: deferredComponent(composerSurfaces, "SlashCommandMenu"),
};

/**
 * The composer's surfaces: the components themselves once their chunk has arrived (so a keystroke renders no extra
 * boundary), lazy stand-ins that render nothing until then.
 */
export function useComposerSurfaces():
	| NonNullable<ReturnType<typeof composerSurfaces.loaded>>
	| typeof deferredSurfaces {
	return useLoadedModule(composerSurfaces) ?? deferredSurfaces;
}
