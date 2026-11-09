import {type ReactNode, useCallback} from "react";

import {FAILURE_MESSAGE} from "../hooks/use-live-launch-options";
import type {HerdrAllowAutoVia} from "../lib/api/herdr";
import {type LaunchPermissionMode, shiftTabCount} from "../lib/launch-options";
import type {ToastOptions} from "./toast-context";
import {usePermissionModeGuard} from "./use-permission-mode-guard";

export interface AllowAndSwitchToAutoInput {
	/** The consent workspace key (`consentWorkspaceKey`). */
	workspace: string;
	/** The session's mode, as the chin reads it. */
	mode: string;
	/** Modes in the CLI's shift+tab cycle for this session. */
	availableModes: readonly LaunchPermissionMode[];
	/** Allows the tool and switches the pane to Auto; `presses` is null when shift+tab can't reach Auto. */
	sendAllowAuto: (presses: number | null) => Promise<HerdrAllowAutoVia>;
	/** A plain allow once. */
	answerAllow: () => Promise<void>;
	/** Shows Auto in the chin until the next hook reports the CLI's mode. */
	expectMode: (mode: LaunchPermissionMode) => void;
	toast: (options: ToastOptions) => void;
}

/**
 * Upstream's `allowAndSwitchToAuto` for the permission card (cc43287c9 `mme`, called by cc32965c2 `$i` without
 * opts, so through the guard): the Auto consent dialog shows only while consent is owed. Confirming (or owing
 * nothing) allows the tool and switches to Auto in the pane; cancelling still allows the tool once. When the pane
 * allowed but couldn't switch, the mode toast says so. The switch is never remembered per folder (`approval_card`).
 */
export function useAllowAndSwitchToAuto({
	workspace,
	mode,
	availableModes,
	sendAllowAuto,
	answerAllow,
	expectMode,
	toast,
}: AllowAndSwitchToAutoInput): {onAllowAndSwitch: () => Promise<void>; gate: ReactNode} {
	const {guard, gate} = usePermissionModeGuard(workspace);
	const onAllowAndSwitch = useCallback(
		async () =>
			new Promise<void>((resolve, reject) => {
				const proceed = () => {
					const presses = shiftTabCount(mode, "auto", availableModes);
					sendAllowAuto(presses === null || presses === 0 ? null : presses).then((via) => {
						if (via === "none") toast({kind: "error", message: FAILURE_MESSAGE.mode});
						else expectMode("auto");
						resolve();
					}, reject);
				};
				const decline = () => {
					answerAllow().then(resolve, reject);
				};
				guard("auto", proceed, decline);
			}),
		[answerAllow, availableModes, expectMode, guard, mode, sendAllowAuto, toast],
	);
	return {onAllowAndSwitch, gate};
}
