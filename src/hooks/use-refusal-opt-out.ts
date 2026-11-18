import {useCallback} from "react";

import {useOpenSettings} from "../components/settings/open-settings";
import {useClaudeCodeSetting} from "../components/settings/use-claude-code-setting";

export type RefusalOptOutView = "hidden" | "offer" | "off";

/**
 * The model-switched card's settings sentence (shared-41 `o2` → `KG`), bound to the CLI's own
 * `switchModelsOnFlag` in ~/.claude/settings.json: `hidden` until the settings load (or when they
 * can't), `off` when the file holds false (upstream then drops the sentence), else `offer`.
 * `openSettings` opens the Claude Code tab only, like upstream `gO` (the row def has no anchor, so no
 * row flash).
 */
export function useRefusalOptOut():
{
	view: RefusalOptOutView;
	openSettings: () => void;
}
{
	const setting = useClaudeCodeSetting("switchModelsOnFlag");
	const open = useOpenSettings();

	let view: RefusalOptOutView = "offer";
	if (setting.loading || setting.unavailable) view = "hidden";
	else if (setting.state?.values.switchModelsOnFlag === false) view = "off";

	const openSettings = useCallback(() =>
	{
		open("claude-code");
	}, [open]);

	return {
		view,
		openSettings,
	};
}
