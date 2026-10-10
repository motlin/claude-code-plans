import {useNavigate} from "@tanstack/react-router";
import {useCallback} from "react";
import {settingsHash, type SettingsTab} from "../../lib/settings-hash";

/** Returns a function that opens Settings over the current page at `tab`. */
export function useOpenSettings(): (tab: SettingsTab, row?: string) => void {
	const navigate = useNavigate();
	return useCallback(
		(tab, row) => {
			void navigate({
				to: ".",
				search: true,
				params: true,
				hash: settingsHash(tab, row),
				resetScroll: false,
				hashScrollIntoView: false,
			});
		},
		[navigate],
	);
}
