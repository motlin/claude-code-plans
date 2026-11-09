import {type ReactNode, useState} from "react";
import type {LaunchPermissionMode} from "../lib/launch-options";
import type {ConsentMode} from "../lib/permission-mode-consent";
import {type GuardRequest, PermissionModeConsentGate} from "./permission-mode-consent-dialog";

function isConsentMode(mode: LaunchPermissionMode): mode is ConsentMode {
	return mode === "auto" || mode === "bypassPermissions";
}

/**
 * Upstream's permission mode guard (ca8b34310 `Xm`): `guard(mode, proceed)` runs `proceed` straight away for a mode
 * that never asks, and otherwise only once the Auto consent or this workspace's Bypass ack is on file or the user
 * confirms the dialog. Cancel, Escape and the backdrop drop the pick. Render `gate` beside the menu.
 */
export function usePermissionModeGuard(workspace: string): {
	guard: (mode: LaunchPermissionMode, proceed: () => void) => void;
	gate: ReactNode;
} {
	const [request, setRequest] = useState<GuardRequest | null>(null);
	const [gateMounted, setGateMounted] = useState(false);
	const guard = (mode: LaunchPermissionMode, proceed: () => void) => {
		if (!isConsentMode(mode)) {
			proceed();
			return;
		}
		setGateMounted(true);
		setRequest({mode, proceed});
	};
	const gate = gateMounted ? (
		<PermissionModeConsentGate
			request={request}
			workspace={workspace}
			onSettled={() => {
				setRequest(null);
			}}
		/>
	) : null;
	return {guard, gate};
}
