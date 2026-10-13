import {CatchBoundary, useLocation} from "@tanstack/react-router";
import {Suspense, use} from "react";
import {useShortcut} from "../../hooks/use-shortcut";
import {parseCustomizeHash, parseSettingsHash} from "../../lib/settings-hash";
import {useOpenSettings} from "./open-settings";
import {loadSettingsDialog, loadedSettingsDialog} from "./settings-dialog-loader";

/** Suspends only while the module downloads, so once loaded it renders in the same pass, like a static import. */
function SettingsDialogLoader() {
	const Dialog = loadedSettingsDialog() ?? use(loadSettingsDialog()).SettingsDialog;
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
	if (loadedSettingsDialog() === undefined && !open) return null;
	return (
		<CatchBoundary getResetKey={() => String(open)} errorComponent={() => null}>
			<Suspense fallback={null}>
				<SettingsDialogLoader />
			</Suspense>
		</CatchBoundary>
	);
}
