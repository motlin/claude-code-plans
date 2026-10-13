import {CatchBoundary, useLocation} from "@tanstack/react-router";
import {Suspense, use} from "react";
import {useShortcut} from "../../hooks/use-shortcut";
import {parseCustomizeHash, parseSettingsHash} from "../../lib/settings-hash";
import {useOpenSettings} from "./open-settings";

type SettingsDialogModule = typeof import("./settings-dialog");

// The Settings tabs, their sections and search stay off the cold load until Settings first opens.
let dialogModule: Promise<SettingsDialogModule> | undefined;
let LoadedDialog: SettingsDialogModule["SettingsDialog"] | undefined;

/** The Settings modal's one module download, shared by its lazy boundary and the idle and intent warm-ups. */
// oxlint-disable-next-line typescript/promise-function-async -- returns the one cached download, which use() needs to be stable
export function loadSettingsDialog(): Promise<SettingsDialogModule> {
	dialogModule ??= import("./settings-dialog")
		.then((module) => {
			LoadedDialog = module.SettingsDialog;
			return module;
		})
		.catch((error: unknown) => {
			// A failed download is retried on the next open.
			dialogModule = undefined;
			throw error;
		});
	return dialogModule;
}

/** Suspends only while the module downloads, so once loaded it renders in the same pass, like a static import. */
function SettingsDialogLoader() {
	const Dialog = LoadedDialog ?? use(loadSettingsDialog()).SettingsDialog;
	return <Dialog />;
}

/**
 * Binds ⇧⌘, and mounts the Settings modal from the first `#settings/…` or `#customize/…` hash on; until then a
 * closed modal renders nothing.
 */
export function DeferredSettingsDialog() {
	const hash = useLocation({select: (location) => location.hash});
	const openSettings = useOpenSettings();
	useShortcut("settings", () => {
		openSettings("general");
	});
	const open = parseSettingsHash(hash) !== null || parseCustomizeHash(hash) !== null;
	if (LoadedDialog === undefined && !open) return null;
	return (
		<CatchBoundary getResetKey={() => String(open)} errorComponent={() => null}>
			<Suspense fallback={null}>
				<SettingsDialogLoader />
			</Suspense>
		</CatchBoundary>
	);
}
