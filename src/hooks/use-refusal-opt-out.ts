import {useCallback, useState} from "react";

import {useOpenSettings} from "../components/settings/open-settings";
import {useClaudeCodeSetting} from "../components/settings/use-claude-code-setting";
import {useToast} from "../components/toast-context";

/** Upstream `jO`'s failed-write error; local's Settings section is "Claude Code". */
export const REFUSAL_OPT_OUT_FAILED = "Couldn’t update the setting. Change it in Settings → Claude Code.";

export type RefusalOptOutView = "hidden" | "offer" | "off";

/**
 * Upstream's refusal-band opt-out (cf74bc599 `jO`), bound to the CLI's own `switchModelsOnFlag` in
 * ~/.claude/settings.json: `hidden` until the settings load (or when they can't), `off` when the file
 * already holds false or this session just wrote it, else `offer`. `optOut` writes false (upstream's
 * `patch({switchModelsOnFlag:false})`) and stays pending until the write lands; a refused write
 * toasts the error and returns to the offer. `openSettings` opens the matching Settings row.
 */
export function useRefusalOptOut(sessionId: string): {
	view: RefusalOptOutView;
	pending: boolean;
	optOut: () => void;
	openSettings: () => void;
} {
	const setting = useClaudeCodeSetting("switchModelsOnFlag");
	const toast = useToast();
	const open = useOpenSettings();
	const [pending, setPending] = useState(false);
	const [wroteFor, setWroteFor] = useState<string | null>(null);

	// The file's value, not the optimistic one: upstream shows the offer as busy until the write lands.
	const fileValue = setting.state?.values.switchModelsOnFlag;
	let view: RefusalOptOutView = "offer";
	if (setting.loading || setting.unavailable) view = "hidden";
	else if (fileValue === false || wroteFor === sessionId) view = "off";

	const {save} = setting;
	const optOut = () => {
		if (pending) return;
		setPending(true);
		void save(false).then((saved) => {
			setPending(false);
			if (saved) setWroteFor(sessionId);
			else toast({kind: "error", message: REFUSAL_OPT_OUT_FAILED});
		});
	};
	const openSettings = useCallback(() => {
		open("claude-code", "switch-models-local");
	}, [open]);

	return {view, pending, optOut, openSettings};
}
