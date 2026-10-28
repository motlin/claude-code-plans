import {CatchBoundary} from "@tanstack/react-router";
import {Suspense, use} from "react";
import type {CommandPaletteProps} from "./command-palette";
import {loadCommandPalette, loadedCommandPalette} from "./command-palette-loader";

/**
 * Suspends only while the module downloads, so once loaded it renders in the same pass, like a static import. use()
 * runs on every render: the download tags itself fulfilled, so a loaded module returns synchronously.
 */
export function PaletteLoader(props: CommandPaletteProps) {
	const Palette = use(loadCommandPalette()).CommandPalette;
	return <Palette {...props} />;
}

/** Mounts the palette from its first open on; until then a closed palette renders nothing. */
export function DeferredCommandPalette(props: CommandPaletteProps) {
	if (loadedCommandPalette() === undefined && !props.open) return null;
	return (
		<CatchBoundary getResetKey={() => String(props.open)} errorComponent={() => null}>
			<Suspense fallback={null}>
				<PaletteLoader {...props} />
			</Suspense>
		</CatchBoundary>
	);
}
