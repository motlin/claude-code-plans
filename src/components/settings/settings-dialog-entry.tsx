import {CatchBoundary, useLocation, useNavigate} from "@tanstack/react-router";
import {Suspense, use, useEffect} from "react";
import {useShortcut} from "../../hooks/use-shortcut";
import {parseCustomizeHash, parseSettingsHash} from "../../lib/settings-hash";
import {useOpenSettings} from "./open-settings";
import {loadSettingsDialog, loadedSettingsDialog} from "./settings-dialog-loader";

/**
 * Suspends only while the module downloads, so once loaded it renders in the same pass, like a static import. use()
 * runs on every render: the download tags itself fulfilled, so a loaded module returns synchronously rather than
 * skipping use(), which React flags as conditional use() on the retry after the first open's suspension.
 */
export function SettingsDialogLoader() {
	const {SettingsDialog} = use(loadSettingsDialog());
	return <SettingsDialog />;
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
	// Upstream drops an unparseable `#customize…` hash (an unknown section or view) rather than leave it in the URL.
	const navigate = useNavigate();
	const badCustomize = !open && /^customize(?:\/|$)/.test(hash);
	useEffect(() => {
		if (!badCustomize) return;
		void navigate({
			to: ".",
			search: true,
			params: true,
			replace: true,
			resetScroll: false,
			hashScrollIntoView: false,
		});
	}, [badCustomize, navigate]);
	if (loadedSettingsDialog() === undefined && !open) return null;
	return (
		<CatchBoundary getResetKey={() => String(open)} errorComponent={() => null}>
			<Suspense fallback={null}>
				<SettingsDialogLoader />
			</Suspense>
		</CatchBoundary>
	);
}
