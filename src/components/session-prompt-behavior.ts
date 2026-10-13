export function getSessionPromptBehavior(
	sessionId: string,
	isActive: boolean,
	herdr: {panes: Array<{sessionId: string}>; writesEnabled: boolean},
): SessionPromptBehavior {
	const hasLivePane = herdr.panes.some((pane) => pane.sessionId === sessionId);

	if (!hasLivePane) {
		return {
			disabled: isActive,
			deliveryHint: "Starts a forked session",
			hasLivePane,
			usesHerdr: false,
		};
	}
	if (!herdr.writesEnabled) {
		return {
			disabled: true,
			deliveryHint: "Live terminal input is disabled",
			hasLivePane,
			usesHerdr: false,
		};
	}
	return {
		disabled: false,
		deliveryHint: "Sends to the live terminal",
		hasLivePane,
		usesHerdr: true,
	};
}

interface SessionPromptBehavior {
	disabled: boolean;
	deliveryHint: string;
	hasLivePane: boolean;
	usesHerdr: boolean;
}
