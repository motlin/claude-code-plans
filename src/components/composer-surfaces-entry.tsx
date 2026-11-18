import {deferredComponent, deferredModule, useLoadedModule} from "./deferred-component";
import {SlashMenuFrame, SlashMenuSkeleton} from "./slash-command-menu-frame";

// The composer's on-demand surfaces stay off the cold load; the composer warms them on mount, before a first / or @.
export const composerSurfaces = deferredModule(async () =>
	import("./composer-surfaces").then(
		({
			AttachedContextChips,
			ComposerDropScrim,
			EmojiSuggestionMenu,
			MentionMenu,
			ParkedMessageBar,
			QueuedMessageBar,
			QueuedPromoteStatus,
			SlashCommandMenu,
		}) => (
		{
			AttachedContextChips,
			ComposerDropScrim,
			EmojiSuggestionMenu,
			MentionMenu,
			ParkedMessageBar,
			QueuedMessageBar,
			QueuedPromoteStatus,
			SlashCommandMenu,
		}),
	),
);

export const preloadComposerSurfaces = composerSurfaces.preload;

/*
 * Upstream gives only the "/" popup body a placeholder (`SlashCommandMenuPopupBody`, `loading: Mh`), so a failed
 * download shows its inline ErrorView in the popup. The queued and parked bars are silent there
 * ("placeholder-would-mislead") and the emoji popup is fail-open, so they render nothing on a failure, as do the
 * surfaces with no upstream counterpart found in the 11-10 crawl (the @ menu, context chips, drop scrim, promote
 * status).
 */
const deferredSurfaces =
{
	AttachedContextChips: deferredComponent(composerSurfaces, "AttachedContextChips"),
	ComposerDropScrim: deferredComponent(composerSurfaces, "ComposerDropScrim"),
	EmojiSuggestionMenu: deferredComponent(composerSurfaces, "EmojiSuggestionMenu"),
	MentionMenu: deferredComponent(composerSurfaces, "MentionMenu"),
	ParkedMessageBar: deferredComponent(composerSurfaces, "ParkedMessageBar"),
	QueuedMessageBar: deferredComponent(composerSurfaces, "QueuedMessageBar"),
	QueuedPromoteStatus: deferredComponent(composerSurfaces, "QueuedPromoteStatus"),
	SlashCommandMenu: deferredComponent(
		composerSurfaces,
		"SlashCommandMenu",
		{
			loading: SlashMenuSkeleton,
			frame: SlashMenuFrame,
		},
	),
};

/**
 * The composer's surfaces: the components themselves once their chunk has arrived (so a keystroke renders no extra
 * boundary), lazy stand-ins that render nothing until then.
 */
export function useComposerSurfaces():
	| NonNullable<ReturnType<typeof composerSurfaces.loaded>>
	| typeof deferredSurfaces
{
	return useLoadedModule(composerSurfaces) ?? deferredSurfaces;
}
