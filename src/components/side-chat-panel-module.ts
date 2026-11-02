import {deferredModule} from "./deferred-component";

// The side chat's thread and input stay off the session's cold load; the closed card is invisible until they arrive.
export const sideChatPanel = deferredModule(async () =>
	import("./side-chat-panel").then(({SideChatPanel}) => (
	{
		SideChatPanel,
	})),
);

/** The side chat panel's one download, warmed when the session page goes idle. */
export const preloadSideChatPanel = sideChatPanel.preload;
